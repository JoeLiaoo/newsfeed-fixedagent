import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { beijingAt, beijingDate } from "@aihot/contracts/time";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { dispatchOutbox, generateDueNotifications, revalidatePayload, type OutboxRow } from "../notifications/outbox.ts";

test("notification editions share the web digest and revalidate subscriptions and sources",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  t.after(async()=>{await app.close();await stopBossNow();await closeDb();});
  const suffix=tag();
  const username=`notify-${suffix}`;
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,payload:{username,realName:"通知测试",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,payload:{username,password:"long-test-password-123"}});
  assert.equal(login.statusCode,200);
  const cookieHeader=login.headers["set-cookie"];
  const cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(";",1)[0]!;
  const [account]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${username}`;
  const userId=account!.id;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${userId},${"recipient-"+suffix},${"channel-"+suffix})`;
  assert.equal((await app.inject({method:"PUT",url:"/api/v1/membership/interests",headers:{...origin,cookie},payload:{tags:["光伏"]}})).statusCode,200);
  await app.inject({method:"GET",url:"/api/v1/membership/notifications",headers:{...origin,cookie}});
  await sql`UPDATE member_notification_settings SET gp_enabled=false WHERE user_id=${userId}`;

  const sourceId=`notify-source-${suffix}`;
  const articleId=`notify-article-${suffix}`;
  const shortArticleId=`notify-short-${suffix}`;
  const storyId=randomUUID();
  const publishedAt=new Date(Date.now()-5_000);
  const longSummary="长摘要".repeat(1800);
  await sql`INSERT INTO sources(id,name,kind,config) VALUES(${sourceId},'Notification test source','rss',${sql.json({feedUrl:"https://example.test/feed.xml"})})`;
  const [story]=await sql<{id:number}[]>`INSERT INTO stories(public_id,title) VALUES(${storyId},'Notification story') RETURNING id`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES(${articleId},${sourceId},${"identity-"+articleId},${"https://example.test/"+articleId},'可见新闻',${publishedAt},${publishedAt})`;
  await sql`INSERT INTO publications(article_id,eligible,title,summary,tags,source_id,channel,url,discovered_at,timeline_at,sort_at,story_id)
    VALUES(${articleId},true,'可见新闻',${longSummary},ARRAY['光伏']::text[],${sourceId},'news',${"https://example.test/"+articleId},${publishedAt},${publishedAt},${publishedAt},${story!.id})`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES(${shortArticleId},${sourceId},${"identity-"+shortArticleId},${"https://example.test/"+shortArticleId},'短新闻',${publishedAt},${publishedAt})`;
  await sql`INSERT INTO publications(article_id,eligible,title,summary,tags,source_id,channel,url,discovered_at,timeline_at,sort_at)
    VALUES(${shortArticleId},true,'短新闻','简短摘要',ARRAY['光伏']::text[],${sourceId},'news',${"https://example.test/"+shortArticleId},${publishedAt},${publishedAt},${publishedAt})`;
  const date=beijingDate(new Date());
  const digestResponse=await app.inject({method:"GET",url:"/api/v1/membership/digest",headers:{cookie}});
  assert.equal(digestResponse.statusCode,200);
  const digest=await digestResponse.json() as {date:string;preferenceVersion:number;window:{cutoff:string};items:Array<{source_key:string;title:string}>};
  assert.equal(digest.date,date);
  assert.equal(digest.items.length,2);
  assert(digest.items.some(item=>item.title==="可见新闻"));
  assert(digest.items.some(item=>item.title==="短新闻"));

  const enabled=process.env.P3_NOTIFICATIONS_ENABLED;
  process.env.P3_NOTIFICATIONS_ENABLED="true";
  try { await generateDueNotifications(beijingAt(date,"23:00")); }
  finally { if(enabled===undefined)delete process.env.P3_NOTIFICATIONS_ENABLED;else process.env.P3_NOTIFICATIONS_ENABLED=enabled; }
  const edition=await sql<{id:string;part_index:number;payload:string;window_end_at:Date;digest_preference_version:number;binding_version:number;subscription_version:number}[]>`SELECT id,part_index,payload,window_end_at,digest_preference_version,binding_version,subscription_version
    FROM member_notification_outbox WHERE user_id=${userId} AND kind='news' AND local_date=${date}::date ORDER BY part_index`;
  assert(edition.length>=3,"an oversized source must be split into bounded outbox parts");
  assert(edition.every(part=>part.digest_preference_version===digest.preferenceVersion));
  assert(edition.every(part=>part.window_end_at.toISOString()===new Date(digest.window.cutoff).toISOString()));
  assert(edition.every(part=>part.payload.length<=1600));
  assert(edition.some(part=>part.payload.includes("可见新闻")));
  const editionIds=edition.map(part=>part.id);
  const editionSources=await sql<{outbox_id:string;segment_index:number;source_key:string;source_start:number;source_end:number}[]>`SELECT outbox_id,segment_index,source_key,source_start,source_end
    FROM member_notification_outbox_sources WHERE outbox_id=ANY(${sql.array(editionIds)}::text[]) ORDER BY outbox_id,segment_index`;
  assert.deepEqual(new Set(editionSources.map(row=>row.source_key)),new Set(digest.items.map(item=>item.source_key)));
  const longSourceKey=digest.items.find(item=>item.title==="可见新闻")!.source_key;
  const longSourceText="• 可见新闻\n"+longSummary+"\nhttps://example.test/"+articleId;
  const longSegments=edition.flatMap(part=>editionSources.filter(source=>source.outbox_id===part.id&&source.source_key===longSourceKey));
  assert.equal(longSegments.map(segment=>longSourceText.slice(segment.source_start,segment.source_end)).join(""),longSourceText);

  const sameSettings=await app.inject({method:"PUT",url:"/api/v1/membership/notifications",headers:{...origin,cookie},payload:{newsEnabled:true,gpEnabled:false,paused:false}});
  assert.equal(sameSettings.statusCode,200);
  const unchanged=await sql<{status:string}[]>`SELECT status FROM member_notification_outbox WHERE id=${edition[0]!.id}`;
  assert.equal(unchanged[0]?.status,"pending","saving unchanged settings must leave a pending message intact");

  const gpPending=randomUUID();
  await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at)
    VALUES(${gpPending},${userId},'gp',${date}::date,1,1,0,'GP fixture','fixture',now())`;
  await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'gp',${"gp:fixture"},${gpPending})`;
  const changedNews=await app.inject({method:"PUT",url:"/api/v1/membership/notifications",headers:{...origin,cookie},payload:{newsEnabled:false,gpEnabled:false,paused:false}});
  assert.equal(changedNews.statusCode,200);
  const versions=await sql<{binding_version:number;news_version:number;gp_version:number}[]>`SELECT binding_version,news_version,gp_version FROM member_notification_settings WHERE user_id=${userId}`;
  assert.equal(versions[0]?.binding_version,1);
  assert.equal(versions[0]?.news_version,2);
  assert.equal(versions[0]?.gp_version,1);
  const statuses=await sql<{id:string;status:string}[]>`SELECT id,status FROM member_notification_outbox WHERE id=ANY(${sql.array([...editionIds,gpPending])}::text[])`;
  assert(editionIds.every(id=>statuses.find(row=>row.id===id)?.status==="cancelled"));
  assert.equal(statuses.find(row=>row.id===gpPending)?.status,"pending","changing news settings must not cancel GP messages");
  const released=await sql`SELECT source_key FROM member_notification_seen WHERE outbox_id=ANY(${sql.array(editionIds)}::text[])`;
  assert.equal(released.length,0);

  // Generate a fresh edition under the new subscription version and exercise real
  // generate -> revalidate -> dispatch with a bounded mock Hermes response.
  const reenabled=await app.inject({method:"PUT",url:"/api/v1/membership/notifications",headers:{...origin,cookie},payload:{newsEnabled:true,gpEnabled:false,paused:false}});
  assert.equal(reenabled.statusCode,200);
  const deliveryFlag=process.env.P3_DELIVERY_ENABLED;
  const notificationsFlag=process.env.P3_NOTIFICATIONS_ENABLED;
  const bridgeUrl=process.env.P3_HERMES_BRIDGE_URL;
  const bridgeToken=process.env.P3_HERMES_BRIDGE_TOKEN;
  process.env.P3_DELIVERY_ENABLED="true";
  process.env.P3_NOTIFICATIONS_ENABLED="true";
  process.env.P3_HERMES_BRIDGE_URL="https://bridge.example.test/deliver";
  process.env.P3_HERMES_BRIDGE_TOKEN="test-bridge-token";
  const deliveredBodies:Array<{text:string;recipientId:string;channelAccountId:string}> = [];
  try {
    await generateDueNotifications(beijingAt(date,"23:00"));
    const result=await dispatchOutbox({post:async(_url,init)=>{
      const body=JSON.parse(String(init?.body)) as {text:string;recipientId:string;channelAccountId:string};
      deliveredBodies.push(body);
      return new Response(JSON.stringify({accepted:true,messageId:`message-${deliveredBodies.length}`}),{status:200,headers:{"content-type":"application/json"}});
    }});
    assert.equal(result.accepted,deliveredBodies.length);
    assert(deliveredBodies.length>=3);
    assert(deliveredBodies.every(body=>body.text.length<=1600&&!body.text.includes(longSummary)));
    assert(deliveredBodies.some(body=>body.text.includes("短新闻")));
    assert(deliveredBodies.some(body=>body.text.includes("可见新闻")));
  } finally {
    if(deliveryFlag===undefined)delete process.env.P3_DELIVERY_ENABLED;else process.env.P3_DELIVERY_ENABLED=deliveryFlag;
    if(notificationsFlag===undefined)delete process.env.P3_NOTIFICATIONS_ENABLED;else process.env.P3_NOTIFICATIONS_ENABLED=notificationsFlag;
    if(bridgeUrl===undefined)delete process.env.P3_HERMES_BRIDGE_URL;else process.env.P3_HERMES_BRIDGE_URL=bridgeUrl;
    if(bridgeToken===undefined)delete process.env.P3_HERMES_BRIDGE_TOKEN;else process.env.P3_HERMES_BRIDGE_TOKEN=bridgeToken;
  }

  const revokedNewsId=randomUUID();
  const revokedSourceKey=digest.items.find(item=>item.title==="可见新闻")!.source_key;
  await sql`DELETE FROM member_notification_seen WHERE user_id=${userId} AND kind='news' AND source_key=${revokedSourceKey}`;
  await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at)
    VALUES(${revokedNewsId},${userId},'news',${date}::date,1,2,0,'old news','old',now())`;
  await sql`INSERT INTO member_notification_outbox_sources(outbox_id,segment_index,source_key,source_start,source_end)
    VALUES(${revokedNewsId},0,${revokedSourceKey},0,1)`;
  await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'news',${revokedSourceKey},${revokedNewsId})`;
  await sql`UPDATE publications SET eligible=false WHERE article_id=${articleId}`;
  const newsJob:OutboxRow={id:revokedNewsId,user_id:userId,kind:"news",payload:"old news",attempts:1,binding_version:1,subscription_version:2,local_date:date,part_index:0,sources_tracked:true};
  assert.equal(await revalidatePayload(newsJob),null,"a withdrawn publication must be dropped before delivery");

  const gpId=randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${gpId},${"GP-"+suffix},${"entity-"+suffix},'gp','active','https://example.test/gp',${userId})`;
  await sql`UPDATE member_weixin_bindings SET bound_at=now()-interval '2 days' WHERE user_id=${userId}`;
  const investmentIds=[randomUUID(),randomUUID()];
  for(const [index,id] of investmentIds.entries()) await sql`INSERT INTO member_gp_investments
    (id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${id},${gpId},${"key-"+index},${"被投企业"+index},${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-20',${index===0?'https://example.org/demo':'https://example.test/source'},${userId},now()-interval '1 hour')`;
  await sql`UPDATE member_notification_settings SET gp_enabled=true,gp_version=gp_version+1 WHERE user_id=${userId}`;
  const gpFlag=process.env.P3_NOTIFICATIONS_ENABLED;
  process.env.P3_NOTIFICATIONS_ENABLED="true";
  try { await generateDueNotifications(beijingAt(date,"23:59")); }
  finally { if(gpFlag===undefined)delete process.env.P3_NOTIFICATIONS_ENABLED;else process.env.P3_NOTIFICATIONS_ENABLED=gpFlag; }
  const gpParts=await sql<{id:string;payload:string;part_index:number;subscription_version:number}[]>`SELECT id,payload,part_index,subscription_version
    FROM member_notification_outbox WHERE user_id=${userId} AND kind='gp' AND subscription_version=2 ORDER BY part_index`;
  assert(gpParts.some(part=>part.payload.includes("演示/导入占位 · 无可核对来源")));
  assert(gpParts.some(part=>part.payload.includes("https://example.test/source")));
  assert(gpParts.every(part=>!part.payload.includes("example.org")));
  const placeholderPart=gpParts.find(part=>part.payload.includes("演示/导入占位 · 无可核对来源"))!;
  await sql`UPDATE member_notification_outbox SET status='sending' WHERE id=${placeholderPart.id}`;
  const refreshed=await revalidatePayload({id:placeholderPart.id,user_id:userId,kind:"gp",payload:placeholderPart.payload,attempts:1,binding_version:1,subscription_version:2,local_date:date,part_index:placeholderPart.part_index,sources_tracked:true});
  assert(refreshed?.includes("演示/导入占位 · 无可核对来源"));
  assert(!refreshed?.includes("example.org"));
  await sql`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${sql.array(gpParts.map(part=>part.id))}::text[])`;
  await sql`DELETE FROM member_notification_outbox WHERE id=ANY(${sql.array(gpParts.map(part=>part.id))}::text[])`;
  await sql`UPDATE member_notification_settings SET gp_enabled=false WHERE user_id=${userId}`;
  for(const [index,id] of investmentIds.entries()){
    const outboxId=randomUUID();
    await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at)
      VALUES(${outboxId},${userId},'gp',${date}::date,1,1,${index+1},'old gp','old',now())`;
    await sql`INSERT INTO member_notification_outbox_sources(outbox_id,segment_index,source_key,source_start,source_end) VALUES(${outboxId},0,${id},0,1)`;
    await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'gp',${"gp:"+id},${outboxId})`;
    await sql`UPDATE member_notification_outbox SET status='sending' WHERE id=${outboxId}`;
    if(index===0) await sql`UPDATE member_gp_investments SET status='retracted' WHERE id=${id}`;
    else await sql`UPDATE member_gp_watchlist SET status='paused' WHERE id=${gpId}`;
    const gpJob:OutboxRow={id:outboxId,user_id:userId,kind:"gp",payload:"old gp",attempts:1,binding_version:1,subscription_version:1,local_date:date,part_index:index+1,sources_tracked:true};
    assert.equal(await revalidatePayload(gpJob),null,index===0?"retracted GP items must be dropped":"paused GP watchlists must be dropped");
  }

  // Hold revalidation open separately for opt-out and unbind so each mutation is
  // proven to invalidate a job already claimed as `sending`.
  const raceDeliveryFlag=process.env.P3_DELIVERY_ENABLED;
  const raceBridgeUrl=process.env.P3_HERMES_BRIDGE_URL;
  const raceBridgeToken=process.env.P3_HERMES_BRIDGE_TOKEN;
  process.env.P3_DELIVERY_ENABLED="true";
  process.env.P3_HERMES_BRIDGE_URL="https://bridge.example.test/deliver";
  process.env.P3_HERMES_BRIDGE_TOKEN="test-bridge-token";
  try {
    const sendAfterBlockedRevalidation=async(id:string,mutate:()=>Promise<{statusCode:number}>)=>{
      let entered!:()=>void;
      let release!:()=>void;
      const revalidationStarted=new Promise<void>(resolve=>{entered=resolve;});
      const revalidationGate=new Promise<void>(resolve=>{release=resolve;});
      let posted=0;
      const pendingDispatch=dispatchOutbox({
        revalidate:async job=>{assert.equal(job.id,id);entered();await revalidationGate;return job.payload;},
        post:async()=>{posted++;return new Response(JSON.stringify({accepted:true}),{status:200,headers:{"content-type":"application/json"}});},
      });
      try {
        await revalidationStarted;
        assert.equal((await mutate()).statusCode,200);
      } finally {
        release();
        await pendingDispatch;
      }
      assert.equal(posted,0,"a notification invalidated during revalidation must not be posted");
      const row=await sql<{status:string;error_code:string|null}[]>`SELECT status,error_code FROM member_notification_outbox WHERE id=${id}`;
      assert.equal(row[0]?.status,"cancelled");
      const seen=await sql`SELECT source_key FROM member_notification_seen WHERE outbox_id=${id}`;
      assert.equal(seen.length,0);
      return row[0]?.error_code;
    };

    const optOutId=randomUUID();
    await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at,sources_tracked)
      VALUES(${optOutId},${userId},'news',${date}::date,1,3,99,'opt-out race','fixture',now(),true)`;
    await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'news','opt-out-race:fixture',${optOutId})`;
    assert.equal(await sendAfterBlockedRevalidation(optOutId,()=>app.inject({method:"PUT",url:"/api/v1/membership/notifications",headers:{...origin,cookie},payload:{newsEnabled:false,gpEnabled:false,paused:false}})),"subscription_changed");

    const reenabledForUnbind=await app.inject({method:"PUT",url:"/api/v1/membership/notifications",headers:{...origin,cookie},payload:{newsEnabled:true,gpEnabled:false,paused:false}});
    assert.equal(reenabledForUnbind.statusCode,200);
    const unbindId=randomUUID();
    await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at,sources_tracked)
      VALUES(${unbindId},${userId},'news',${date}::date,1,5,100,'unbind race','fixture',now(),true)`;
    await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'news','unbind-race:fixture',${unbindId})`;
    assert.equal(await sendAfterBlockedRevalidation(unbindId,()=>app.inject({method:"POST",url:"/api/v1/membership/weixin/unbind",headers:{...origin,cookie}})),"unbound");
  } finally {
    if(raceDeliveryFlag===undefined)delete process.env.P3_DELIVERY_ENABLED;else process.env.P3_DELIVERY_ENABLED=raceDeliveryFlag;
    if(raceBridgeUrl===undefined)delete process.env.P3_HERMES_BRIDGE_URL;else process.env.P3_HERMES_BRIDGE_URL=raceBridgeUrl;
    if(raceBridgeToken===undefined)delete process.env.P3_HERMES_BRIDGE_TOKEN;else process.env.P3_HERMES_BRIDGE_TOKEN=raceBridgeToken;
  }
});
