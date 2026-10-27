import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer,type Socket} from "node:net";
import {unlink} from "node:fs/promises";
import {test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {enqueueOn,getBoss,stopBossNow} from "@aihot/backend/jobs/queue";
import {AGENT_QUEUE} from "../conversation/agent-queue.ts";
import {processAgentRun,recoverAgentRuns} from "../conversation/agent-worker.ts";

type Request={prompt:string;answer:(ok?:boolean)=>void};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){
  for(let n=0;n<300;n++){if(check())return;await delay(10);}
  assert.fail("timed out waiting for the runner or queue");
}

test("P1-A wakes ordered successors and other members without replaying paid calls",async t=>{
  const keys=["P3_ILINK_AGENT_ENABLED","P3_ILINK_AGENT_WAKE_ENABLED","P3_ILINK_READING_REPLIES_ENABLED",
    "P3_DELIVERY_ENABLED","MODEL_CALLS_ENABLED","P3_HERMES_RUNNER_SOCKET"];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys.slice(0,5))process.env[key]="true";
  const path=`/tmp/wx-p1a-${randomUUID().slice(0,12)}.sock`;
  process.env.P3_HERMES_RUNNER_SOCKET=path;
  const requests:Request[]=[];
  const server=createServer((socket:Socket)=>{
    let buffer="";
    socket.on("data",chunk=>{
      buffer+=chunk.toString();
      const end=buffer.indexOf("\n");
      if(end<0)return;
      const {prompt}=JSON.parse(buffer.slice(0,end)) as {prompt:string};
      requests.push({prompt,answer:(ok=true)=>socket.end(JSON.stringify(ok?
        {ok:true,answer:`答复${requests.length}`,usage:{total_including_auxiliary:{api_calls:2,total_tokens:30}}}:
        {ok:false})+"\n")});
      buffer="";
    });
  });
  await new Promise<void>(resolve=>server.listen(path,resolve));
  t.after(async()=>{
    for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await stopBossNow();await closeDb();
    await new Promise<void>(resolve=>server.close(()=>resolve()));await unlink(path).catch(()=>{});
  });
  const boss=await getBoss();
  const prefix=randomUUID().slice(0,8);
  async function member(label:string){
    const userId=randomUUID(),bot=`bot-${label}-${prefix}`;
    await sql`INSERT INTO member_users(id,username,real_name,password_hash,status)
      VALUES(${userId},${`wake-${label}-${prefix}`},${label},'fixture','active')`;
    await sql`INSERT INTO member_notification_settings(user_id) VALUES(${userId})`;
    await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
      VALUES(${userId},${`recipient-${userId}`},${bot})`;
    await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
      VALUES(${userId},${`recipient-${userId}`},${bot},'fixture','https://example.test')`;
    const [grant]=await sql<{grant_id:string}[]>`INSERT INTO member_agent_grants(user_id) VALUES(${userId}) RETURNING grant_id`;
    return {userId,bot,grantId:grant!.grant_id};
  }
  type Member=Awaited<ReturnType<typeof member>>;
  async function run(m:Member,label:string,position:number,receivedAt=new Date(),expiresAt?:Date){
    // Reversed IDs prove that UUID/lexical order cannot determine the claim order.
    const id=`wake-${prefix}-${label}-${String(9-position)}`;
    await sql.begin(async tx=>{
      await tx`INSERT INTO member_ilink_inbound_messages
        (id,user_id,binding_version,bot_id,upstream_id,body,received_at,poll_position)
        VALUES(${id},${m.userId},1,${m.bot},${id},${label},${receivedAt},${position})`;
      await tx`INSERT INTO member_agent_runs(id,inbound_id,user_id,binding_version,grant_id,status,expires_at)
        VALUES(${id},${id},${m.userId},1,${m.grantId}::uuid,'pending',${expiresAt??new Date(Date.now()+600_000)})`;
      await enqueueOn(AGENT_QUEUE,{runId:id},{singletonKey:id},tx);
    });
    return id;
  }
  async function fetch(count:number){
    const jobs=await boss.fetch<{runId:string}>(AGENT_QUEUE.name,{batchSize:count});
    assert.equal(jobs.length,count);
    return jobs;
  }
  async function finish(job:{id:string;data:{runId:string}},ok=true){
    const pending=processAgentRun(job.data.runId);
    await until(()=>requests.length>answered);
    requests[answered]!.answer(ok);answered++;
    await pending;
    await boss.complete(AGENT_QUEUE.name,job.id);
  }
  let answered=0;

  // One active call and three waiting messages from the same getupdates batch.
  const a=await member("A"),same=new Date();
  const ids=[];
  for(let i=0;i<4;i++)ids.push(await run(a,`顺序${i}`,i,same));
  const initial=await fetch(4);
  const first=processAgentRun(initial[3]!.data.runId);
  await until(()=>requests.length===1);
  assert.match(requests[0]!.prompt,/顺序0/);
  for(const job of initial.slice(0,3)){
    await processAgentRun(job.data.runId);
    await boss.complete(AGENT_QUEUE.name,job.id);
  }
  assert.equal(requests.length,1);
  requests[0]!.answer();answered=1;await first;
  for(let i=1;i<4;i++){
    const [wake]=await fetch(1);
    assert.match((await sql<{singleton_key:string}[]>`SELECT singleton_key FROM pgboss.job WHERE id=${wake!.id}`)[0]!.singleton_key,/^wake:/);
    await finish(wake!);
    assert.match(requests[i]!.prompt,new RegExp(`顺序${i}`));
  }
  await boss.complete(AGENT_QUEUE.name,initial[3]!.id);
  assert.deepEqual((await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=ANY(${ids})`).map(r=>r.status),
    ["succeeded","succeeded","succeeded","succeeded"]);
  await processAgentRun(ids[0]!); // Duplicate wake is harmless.
  assert.equal(requests.length,4);

  // Two occupied global slots; a third member's consumed job is resumed by a finish.
  const b=await member("B"),c=await member("C"),d=await member("D");
  const [bi,ci,di]=await Promise.all([run(b,"成员B",0),run(c,"成员C",0),run(d,"成员D",0)]);
  const globalJobs=await fetch(3);
  const byRun=new Map(globalJobs.map(job=>[job.data.runId,job]));
  const activeB=processAgentRun(bi!),activeC=processAgentRun(ci!);
  await until(()=>requests.length===6);
  await processAgentRun(di!);await boss.complete(AGENT_QUEUE.name,byRun.get(di!)!.id);
  assert.equal(requests.length,6);
  requests[4]!.answer();answered=5;await activeB;
  const [crossWake]=await fetch(1);
  assert.equal(crossWake!.data.runId,di);
  const third=processAgentRun(crossWake!.data.runId);
  await until(()=>requests.length===7);
  requests[6]!.answer();answered=7;await third;
  await boss.complete(AGENT_QUEUE.name,crossWake!.id);
  requests[5]!.answer();await activeC;
  await boss.complete(AGENT_QUEUE.name,byRun.get(bi!)!.id);
  await boss.complete(AGENT_QUEUE.name,byRun.get(ci!)!.id);
  assert.equal(requests.length,7);

  // A failed model call still commits the wake for its valid successor.
  const e=await member("E"),e0=await run(e,"失败首条",0),e1=await run(e,"失败后继",1);
  const failJobs=await fetch(2);
  const failed=processAgentRun(e0);
  await until(()=>requests.length===8);
  await processAgentRun(e1);await boss.complete(AGENT_QUEUE.name,failJobs.find(j=>j.data.runId===e1)!.id);
  requests[7]!.answer(false);answered=8;await failed;
  const [afterFailure]=await fetch(1);
  assert.equal(afterFailure!.data.runId,e1);
  await finish(afterFailure!);
  await boss.complete(AGENT_QUEUE.name,failJobs.find(j=>j.data.runId===e0)!.id);
  assert.equal((await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=${e0}`)[0]!.status,"failed");

  // Revoked and expired pending rows are never turned into paid calls by wake jobs.
  const f=await member("F"),g=await member("G");
  const f0=await run(f,"撤权首条",0),f1=await run(f,"撤权后继",1);
  const g0=await run(g,"过期首条",0),g1=await run(g,"过期后继",1,new Date(),new Date(Date.now()-1000));
  await sql`DELETE FROM member_agent_grants WHERE user_id=${f.userId}`;
  const before=requests.length;
  for(const id of [f0,f1])await processAgentRun(id);
  assert.equal(requests.length,before);
  const gJob=processAgentRun(g0);
  await until(()=>requests.length===before+1);
  requests[before]!.answer();await gJob;
  await processAgentRun(g1);
  assert.equal(requests.length,before+1);
  assert.equal((await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=${g1}`)[0]!.status,"expired");

  // Force the durable wake insert to fail after the paid response. The finish
  // rolls back with it; recovery marks the unknown outcome and never pays twice.
  const h=await member("H"),h0=await run(h,"崩溃首条",0),h1=await run(h,"崩溃后继",1);
  const interrupted=processAgentRun(h0);
  await until(()=>requests.length===before+2);
  await processAgentRun(h1);
  await sql.unsafe(`CREATE FUNCTION test_reject_agent_wake() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.singleton_key LIKE 'wake:%' THEN RAISE EXCEPTION 'wake insert interrupted'; END IF;
    RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER test_reject_agent_wake BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION test_reject_agent_wake()");
  requests[before+1]!.answer();
  await assert.rejects(interrupted,/wake insert interrupted/);
  assert.equal((await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=${h0}`)[0]!.status,"running");
  assert.equal((await sql`SELECT 1 FROM member_ilink_reply_outbox WHERE agent_run_id=${h0}`).length,0);
  await sql.unsafe("DROP TRIGGER test_reject_agent_wake ON pgboss.job");
  await sql.unsafe("DROP FUNCTION test_reject_agent_wake()");
  await sql`UPDATE member_agent_runs SET lease_expires_at=now()-interval '1 second' WHERE id=${h0}`;
  await recoverAgentRuns();
  assert.equal((await sql<{status:string}[]>`SELECT status FROM member_agent_runs WHERE id=${h0}`)[0]!.status,"unknown");
  await processAgentRun(h0);
  assert.equal(requests.length,before+2);
  const recovered=processAgentRun(h1);
  await until(()=>requests.length===before+3);
  requests[before+2]!.answer();await recovered;
  assert.equal(requests.length,before+3);
});
