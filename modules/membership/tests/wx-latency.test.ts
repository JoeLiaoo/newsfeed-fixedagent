import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {pollMemberIlinkInboxes} from "../notifications/inbox.ts";
import {encryptSecret} from "../notifications/ilink.ts";
import {dispatchReadingReply} from "../conversation/replies.ts";

test("iLink timing uses response boundary and never marks failed or unknown sends accepted",async t=>{
  const names=["P3_ILINK_BINDING_ENABLED","P3_ILINK_CREDENTIAL_KEY","P3_ILINK_READING_REPLIES_ENABLED",
    "P3_DELIVERY_ENABLED","P3_ILINK_LATENCY_METRICS_ENABLED"] as const;
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const oldFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=oldFetch;
    for(const [name,value] of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;
    await stopBossNow();await closeDb();});
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="a".repeat(64);
  process.env.P3_ILINK_READING_REPLIES_ENABLED="true";
  process.env.P3_DELIVERY_ENABLED="true";
  process.env.P3_ILINK_LATENCY_METRICS_ENABLED="false";
  const user=randomUUID(),bot=`bot-${user}`,recipient=`recipient-${user}`;
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status)
    VALUES(${user},${`latency-${user}`},'合成员工','fixture','active')`;
  await sql`INSERT INTO member_notification_settings(user_id) VALUES(${user})`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id) VALUES(${user},${recipient},${bot})`;
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
    VALUES(${user},${recipient},${bot},${encryptSecret("fixture-token")},'https://ilinkai.weixin.qq.com')`;
  let responseAt=new Date(0),sendResult:"accepted"|"failed"|"unknown"="accepted";
  globalThis.fetch=async input=>{
    if(String(input).endsWith("/getupdates")){
      await new Promise(resolve=>setTimeout(resolve,30));
      responseAt=new Date();
      return new Response(JSON.stringify({ret:0,get_updates_buf:"cursor",msgs:[{
        message_id:"delayed",seq:"1",from_user_id:recipient,to_user_id:bot,
        message_type:1,message_state:2,context_token:"context",item_list:[{type:1,text_item:{text:"帮助"}}],
      }]}),{status:200});
    }
    assert.match(String(input),/sendmessage/);
    if(sendResult==="unknown")throw new Error("network timeout");
    return new Response(JSON.stringify(sendResult==="accepted"?{ret:0}:{ret:-2,errmsg:"rate limited"}),{status:200});
  };
  await pollMemberIlinkInboxes();
  const [inbound]=await sql<{id:string;received_at:Date;created_at:Date}[]>`
    SELECT id,received_at,created_at FROM member_ilink_inbound_messages WHERE user_id=${user} AND upstream_id='delayed'`;
  assert(inbound?.received_at);
  assert(inbound.received_at.getTime()>=responseAt.getTime(),"receive time follows delayed response");
  const reply=async(label:string,result:typeof sendResult)=>{
    sendResult=result;
    const id=randomUUID();
    // An old writer omits all new timestamp columns; nullable migrations keep this insert valid.
    await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
      VALUES(${id},${user},1,${bot},${label},'fixture')`;
    await sql`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
      VALUES(${id},${id},${user},1,'fixture response')`;
    await dispatchReadingReply(id);
    const [row]=await sql<{status:string;send_started_at:Date|null;accepted_at:Date|null}[]>`
      SELECT status,send_started_at,accepted_at FROM member_ilink_reply_outbox WHERE id=${id}`;
    assert(row?.send_started_at);
    return row;
  };
  const accepted=await reply("accepted","accepted");
  assert.equal(accepted.status,"accepted");
  assert(accepted.accepted_at);
  assert(accepted.accepted_at.getTime()>=accepted.send_started_at!.getTime());
  const failed=await reply("failed","failed");
  assert.equal(failed.status,"failed");assert.equal(failed.accepted_at,null);
  const unknown=await reply("unknown","unknown");
  assert.equal(unknown.status,"unknown");assert.equal(unknown.accepted_at,null);
  const [historic]=await sql<{received_at:Date|null}[]>`SELECT received_at FROM member_ilink_inbound_messages WHERE upstream_id='accepted' AND user_id=${user}`;
  assert.equal(historic?.received_at,null);
});
