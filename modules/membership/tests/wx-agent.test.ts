import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {unlink} from "node:fs/promises";
import {test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {processReadingInbound} from "../conversation/replies.ts";
import {processAgentRun} from "../conversation/agent-worker.ts";

test("WX-B keeps two employees separate, deduplicates inbound and stops revoked replies",async t=>{
  const previous=Object.fromEntries(["P3_ILINK_AGENT_ENABLED","P3_ILINK_READING_REPLIES_ENABLED","P3_DELIVERY_ENABLED","MODEL_CALLS_ENABLED","P3_HERMES_RUNNER_SOCKET"].map(k=>[k,process.env[k]]));
  t.after(async()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await stopBossNow();await closeDb();});
  process.env.P3_ILINK_AGENT_ENABLED="true";
  process.env.P3_ILINK_READING_REPLIES_ENABLED="true";
  process.env.P3_DELIVERY_ENABLED="true";
  process.env.MODEL_CALLS_ENABLED="true";
  const path=`/tmp/wxb-${randomUUID().slice(0,12)}.sock`;
  process.env.P3_HERMES_RUNNER_SOCKET=path;
  const prompts:string[]=[];
  let release:()=>void=()=>{};
  let hold=false;
  const server=createServer(socket=>{
    let input="";
    socket.on("data",chunk=>{input+=chunk.toString();if(!input.includes("\n"))return;
      const request=JSON.parse(input.slice(0,input.indexOf("\n"))) as {prompt:string};
      prompts.push(request.prompt);
      const respond=()=>socket.end(JSON.stringify({ok:true,answer:`答复${prompts.length}`,usage:{cost_status:"unknown",
        total_including_auxiliary:{api_calls:2,total_tokens:32}}})+"\n");
      if(hold)new Promise<void>(resolve=>{release=resolve;}).then(respond);else respond();
    });
  });
  await new Promise<void>(resolve=>server.listen(path,resolve));
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await unlink(path).catch(()=>{});});
  const users=[randomUUID(),randomUUID()];
  for(const [n,userId] of users.entries()){
    await sql`INSERT INTO member_users(id,username,real_name,password_hash,status)
      VALUES(${userId},${`wx-agent-${userId}`},${`员工${n}`},'fixture','active')`;
    await sql`INSERT INTO member_notification_settings(user_id) VALUES(${userId})`;
    await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
      VALUES(${userId},${`recipient-${userId}`},${`bot-${userId}`})`;
    await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
      VALUES(${userId},${`recipient-${userId}`},${`bot-${userId}`},'fixture','https://example.test')`;
    await sql`INSERT INTO member_agent_grants(user_id) VALUES(${userId})`;
  }
  async function inbound(userId:string,body:string){
    const id=randomUUID();
    await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
      VALUES(${id},${userId},1,${`bot-${userId}`},${id},${body})`;
    await processReadingInbound(id);await processReadingInbound(id);
    return id;
  }
  process.env.P3_ILINK_AGENT_ENABLED="false";
  const disabled=await inbound(users[0]!,"开关关闭时的自由问题");
  assert.equal((await sql`SELECT 1 FROM member_agent_runs WHERE id=${disabled}`).length,0);
  const [oldReply]=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${disabled}`;
  assert.match(oldReply?.body??"",/展开 1/);
  process.env.P3_ILINK_AGENT_ENABLED="true";
  const first=await inbound(users[0]!,"用户甲的秘密问题");
  const second=await inbound(users[1]!,"用户乙的不同问题");
  assert.equal((await sql`SELECT 1 FROM member_agent_runs WHERE inbound_id=${first}`).length,1);
  await processAgentRun(first);
  await processAgentRun(second);
  assert.match(prompts[0]!,/用户甲的秘密问题/);
  assert.doesNotMatch(prompts[0]!,/用户乙的不同问题/);
  assert.match(prompts[1]!,/用户乙的不同问题/);
  assert.doesNotMatch(prompts[1]!,/用户甲的秘密问题/);
  const [reply]=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${second}`;
  assert.equal(reply?.body,"答复2");
  hold=true;
  const third=await inbound(users[0]!,"再次询问");
  const running=processAgentRun(third);
  while(prompts.length<3)await new Promise(resolve=>setTimeout(resolve,5));
  await sql`DELETE FROM member_agent_grants WHERE user_id=${users[0]!}`;
  release();await running;
  assert.equal((await sql`SELECT 1 FROM member_ilink_reply_outbox WHERE id=${third}`).length,0);
  const [revoked]=await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=${third}`;
  assert.equal(revoked?.status,"cancelled");
  process.env.P3_HERMES_RUNNER_SOCKET="/tmp/nonexistent-wx-b-runner.sock";
  const fourth=await inbound(users[1]!,"runner 故障时仍须回复降级文案");
  await processAgentRun(fourth);
  const [failed]=await sql<{status:string;body:string}[]>`SELECT r.status,o.body FROM member_agent_runs r
    JOIN member_ilink_reply_outbox o ON o.agent_run_id=r.id WHERE r.id=${fourth}`;
  assert.equal(failed?.status,"failed");
  assert.match(failed?.body??"",/对话服务暂时不可用/);
  await sql`UPDATE member_agent_runs SET api_calls=29 WHERE id=${second}`;
  const fifth=await inbound(users[1]!,"预算耗尽的问题");
  assert.equal((await sql`SELECT 1 FROM member_agent_runs WHERE id=${fifth}`).length,0);
  const [budgetReply]=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${fifth}`;
  assert.match(budgetReply?.body??"",/对话服务暂时不可用/);
});
