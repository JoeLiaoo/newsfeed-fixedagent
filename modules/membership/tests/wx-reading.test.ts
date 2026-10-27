import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {installModules} from "@aihot/backend/modules";
import {closeDb,sql} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {beijingAt,beijingDate} from "@aihot/contracts/time";
import {buildApp} from "../../../apps/api/src/app.ts";
import {SERVER_MODULES} from "../../../site/modules/server.ts";
import {tag} from "../../../tests/setup.ts";
import {dispatchOutbox,generateDueNotifications,revalidatePayload,type OutboxRow} from "../notifications/outbox.ts";
import {processReadingInbound} from "../conversation/replies.ts";
import {pollMemberIlinkInboxes} from "../notifications/inbox.ts";
import {decryptSecret,encryptSecret} from "../notifications/ilink.ts";

test("WX-A compact edition stays short through revalidation and replies use the accepted edition",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  t.after(async()=>{await app.close();await stopBossNow();await closeDb();});
  const previous=Object.fromEntries(["P3_NOTIFICATIONS_ENABLED","P3_NEWS_COMPACT_ENABLED","P3_ILINK_READING_REPLIES_ENABLED",
    "P3_DELIVERY_ENABLED","P3_HERMES_BRIDGE_URL","P3_HERMES_BRIDGE_TOKEN",
    "P3_ILINK_BINDING_ENABLED","P3_ILINK_CREDENTIAL_KEY"].map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  process.env.P3_NOTIFICATIONS_ENABLED="true";
  process.env.P3_NEWS_COMPACT_ENABLED="true";
  process.env.P3_ILINK_READING_REPLIES_ENABLED="true";
  const suffix=tag();
  const username=`wx-reading-${suffix}`;
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,
    payload:{username,realName:"阅读测试",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,
    payload:{username,password:"long-test-password-123"}});
  const cookieHeader=login.headers["set-cookie"];
  const cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(";",1)[0]!;
  const [user]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${username}`;
  const userId=user!.id;
  assert.equal((await app.inject({method:"PUT",url:"/api/v1/membership/interests",headers:{...origin,cookie},
    payload:{tags:["光伏"]}})).statusCode,200);
  await sql`INSERT INTO member_notification_settings(user_id,gp_enabled) VALUES(${userId},false) ON CONFLICT(user_id) DO UPDATE SET gp_enabled=false`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${userId},${"recipient-"+suffix},${"bot-"+suffix})`;
  // A synthetic account makes the reading reply eligible; delivery stays off until after the bridge fixture.
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
    VALUES(${userId},${"recipient-"+suffix},${"bot-"+suffix},'fixture','https://ilinkai.weixin.qq.com')`;
  const sourceId=`wx-source-${suffix}`;
  await sql`INSERT INTO sources(id,name,kind,config) VALUES(${sourceId},'合成源','rss',${sql.json({feedUrl:"https://example.test/feed.xml"})})`;
  const at=new Date(Date.now()-60_000);
  for(let i=0;i<100;i++){
    const id=`wx-${suffix}-${i}`;
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
      VALUES(${id},${sourceId},${id},${"https://example.test/"+id},${"新闻 "+i},${at},${at})`;
    await sql`INSERT INTO publications(article_id,eligible,title,summary,tags,source_id,channel,url,discovered_at,timeline_at,sort_at)
      VALUES(${id},true,${"新闻 "+i},${"长摘要".repeat(800)},ARRAY['光伏']::text[],${sourceId},'news',
        ${"https://example.test/"+id},${at},${at},${at})`;
  }
  const day=beijingDate(new Date());
  await generateDueNotifications(beijingAt(day,"23:00"));
  const [digestCount]=await sql<{count:number}[]>`SELECT jsonb_array_length(items) AS count FROM member_daily_digests WHERE user_id=${userId} AND local_date=${day}::date`;
  assert.equal(digestCount!.count,100,"the website keeps the full digest snapshot");
  const jobs=await sql<OutboxRow[]>`SELECT id,user_id,kind,payload,attempts,binding_version,subscription_version,
    local_date::text AS local_date,part_index,sources_tracked FROM member_notification_outbox
    WHERE user_id=${userId} AND kind='news'`;
  assert.equal(jobs.length,1);
  assert(jobs[0]!.payload.length<=700);
  const [edition]=await sql<{displayed_items:Array<{key:string;title:string}>}[]>`SELECT displayed_items FROM member_news_compact_editions WHERE outbox_id=${jobs[0]!.id}`;
  assert.equal(edition!.displayed_items.length,3);
  await sql`UPDATE member_notification_outbox SET status='sending' WHERE id=${jobs[0]!.id}`;
  const refreshed=await revalidatePayload(jobs[0]!);
  assert(refreshed&&refreshed.length<=700&&!refreshed.includes("长摘要".repeat(100)));
  await sql`UPDATE member_notification_outbox SET status='pending' WHERE id=${jobs[0]!.id}`;
  // Use the existing bridge fixture path to mark the short edition accepted and bind its numbering.
  await sql`DELETE FROM member_ilink_accounts WHERE user_id=${userId}`;
  process.env.P3_DELIVERY_ENABLED="true";
  process.env.P3_HERMES_BRIDGE_URL="https://bridge.example.test/deliver";
  process.env.P3_HERMES_BRIDGE_TOKEN="fixture";
  const delivered:string[]=[];
  await dispatchOutbox({post:async(_url,init)=>{
    delivered.push((JSON.parse(String(init?.body)) as {text:string}).text);
    return new Response(JSON.stringify({accepted:true,messageId:"fixture"}),{status:200});
  }});
  assert.equal(delivered.length,1);
  assert(delivered[0]!.length<=700);
  process.env.P3_DELIVERY_ENABLED="false";
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
    VALUES(${userId},${"recipient-"+suffix},${"bot-"+suffix},'fixture','https://ilinkai.weixin.qq.com')`;
  const inboundId=randomUUID();
  await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
    VALUES(${inboundId},${userId},1,${"bot-"+suffix},'message-1','深读 2')`;
  await processReadingInbound(inboundId);
  await processReadingInbound(inboundId);
  const replies=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE inbound_id=${inboundId}`;
  assert.equal(replies.length,1);
  assert.match(replies[0]!.body,new RegExp(edition!.displayed_items[1]!.title));
  const depthId=randomUUID();
  await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
    VALUES(${depthId},${userId},1,${"bot-"+suffix},'message-depth','深度1')`;
  await processReadingInbound(depthId);
  const depthReplies=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE inbound_id=${depthId}`;
  assert.equal(depthReplies.length,1);
  assert.match(depthReplies[0]!.body,new RegExp(edition!.displayed_items[0]!.title));
  await sql`UPDATE member_notification_settings SET binding_version=2 WHERE user_id=${userId}`;
  const staleId=randomUUID();
  await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
    VALUES(${staleId},${userId},1,${"bot-"+suffix},'message-2','深读 1')`;
  await processReadingInbound(staleId);
  assert.equal((await sql`SELECT id FROM member_ilink_reply_outbox WHERE inbound_id=${staleId}`).length,0);
  const secondName=`wx-second-${suffix}`;
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,
    payload:{username:secondName,realName:"第二员工",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${secondName}`;
  const [second]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${secondName}`;
  await sql`INSERT INTO member_notification_settings(user_id) VALUES(${second!.id})`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${second!.id},${"recipient-second-"+suffix},${"bot-second-"+suffix})`;
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
    VALUES(${second!.id},${"recipient-second-"+suffix},${"bot-second-"+suffix},'fixture','https://ilinkai.weixin.qq.com')`;
  const secondInbound=randomUUID();
  await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body)
    VALUES(${secondInbound},${second!.id},1,${"bot-second-"+suffix},'message-1','深读 2')`;
  await processReadingInbound(secondInbound);
  const [secondReply]=await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE inbound_id=${secondInbound}`;
  assert.match(secondReply!.body,/暂无可展开/);
  assert(!secondReply!.body.includes(edition!.displayed_items[1]!.title));
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="a".repeat(64);
  await sql`UPDATE member_ilink_accounts SET token_ciphertext=${encryptSecret("fixture-token")}`;
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(input)=>{
    assert.match(String(input),/getupdates/);
    return new Response(JSON.stringify({ret:0,get_updates_buf:"cursor-next",msgs:[
      {message_id:"batch-1",seq:"1",from_user_id:"recipient-"+suffix,to_user_id:"bot-"+suffix,
        message_type:1,message_state:2,context_token:"ctx",item_list:[{type:1,text_item:{text:"其他"}}]},
      {message_id:"batch-2",seq:"2",from_user_id:"recipient-"+suffix,to_user_id:"bot-"+suffix,
        message_type:1,message_state:2,context_token:"ctx",item_list:[{type:1,text_item:{text:"全部"}}]},
      {message_id:"echo",from_user_id:"bot-"+suffix,to_user_id:"recipient-"+suffix,
        message_type:2,message_state:2,item_list:[{type:1,text_item:{text:"忽略"}}]},
    ]}),{status:200});
  };
  await pollMemberIlinkInboxes();
  await pollMemberIlinkInboxes();
  const batch=await sql<{upstream_id:string}[]>`SELECT upstream_id FROM member_ilink_inbound_messages
    WHERE user_id=${userId} AND upstream_id LIKE 'batch-%' ORDER BY upstream_id`;
  assert.deepEqual(batch.map(row=>row.upstream_id),["batch-1","batch-2"]);
  const [account]=await sql<{cursor_ciphertext:string}[]>`SELECT cursor_ciphertext FROM member_ilink_accounts WHERE user_id=${userId}`;
  assert.equal(decryptSecret(account!.cursor_ciphertext),"cursor-next");
});
