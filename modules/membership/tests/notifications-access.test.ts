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
import { generateDueNotifications, revalidatePayload, type OutboxRow } from "../notifications/outbox.ts";

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
  const storyId=randomUUID();
  const publishedAt=new Date(Date.now()-5_000);
  await sql`INSERT INTO sources(id,name,kind,config) VALUES(${sourceId},'Notification test source','rss',${sql.json({feedUrl:"https://example.test/feed.xml"})})`;
  const [story]=await sql<{id:number}[]>`INSERT INTO stories(public_id,title) VALUES(${storyId},'Notification story') RETURNING id`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES(${articleId},${sourceId},${"identity-"+articleId},${"https://example.test/"+articleId},'可见新闻',${publishedAt},${publishedAt})`;
  await sql`INSERT INTO publications(article_id,eligible,title,summary,tags,source_id,channel,url,discovered_at,timeline_at,sort_at,story_id)
    VALUES(${articleId},true,'可见新闻','新闻摘要',ARRAY['光伏']::text[],${sourceId},'news',${"https://example.test/"+articleId},${publishedAt},${publishedAt},${publishedAt},${story!.id})`;
  const date=beijingDate(new Date());
  const digestResponse=await app.inject({method:"GET",url:"/api/v1/membership/digest",headers:{cookie}});
  assert.equal(digestResponse.statusCode,200);
  const digest=await digestResponse.json() as {date:string;preferenceVersion:number;window:{cutoff:string};items:Array<{source_key:string;title:string}>};
  assert.equal(digest.date,date);
  assert.equal(digest.items.length,1);
  assert.equal(digest.items[0]?.title,"可见新闻");

  const enabled=process.env.P3_NOTIFICATIONS_ENABLED;
  process.env.P3_NOTIFICATIONS_ENABLED="true";
  try { await generateDueNotifications(beijingAt(date,"23:00")); }
  finally { if(enabled===undefined)delete process.env.P3_NOTIFICATIONS_ENABLED;else process.env.P3_NOTIFICATIONS_ENABLED=enabled; }
  const edition=await sql<{id:string;payload:string;window_end_at:Date;digest_preference_version:number;binding_version:number;subscription_version:number}[]>`SELECT id,payload,window_end_at,digest_preference_version,binding_version,subscription_version
    FROM member_notification_outbox WHERE user_id=${userId} AND kind='news' AND local_date=${date}::date`;
  assert.equal(edition.length,1);
  assert.equal(edition[0]?.digest_preference_version,digest.preferenceVersion);
  assert.equal(edition[0]?.window_end_at.toISOString(),new Date(digest.window.cutoff).toISOString());
  assert.match(edition[0]!.payload,/可见新闻/);
  const editionSources=await sql<{source_key:string}[]>`SELECT source_key FROM member_notification_outbox_sources WHERE outbox_id=${edition[0]!.id}`;
  assert.deepEqual(editionSources.map(row=>row.source_key),digest.items.map(item=>item.source_key));

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
  const statuses=await sql<{id:string;status:string}[]>`SELECT id,status FROM member_notification_outbox WHERE id IN (${edition[0]!.id},${gpPending})`;
  assert.equal(statuses.find(row=>row.id===edition[0]!.id)?.status,"cancelled");
  assert.equal(statuses.find(row=>row.id===gpPending)?.status,"pending","changing news settings must not cancel GP messages");
  const released=await sql`SELECT source_key FROM member_notification_seen WHERE outbox_id=${edition[0]!.id}`;
  assert.equal(released.length,0);

  const revokedNewsId=randomUUID();
  await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at)
    VALUES(${revokedNewsId},${userId},'news',${date}::date,1,2,0,'old news','old',now())`;
  await sql`INSERT INTO member_notification_outbox_sources(outbox_id,source_key) VALUES(${revokedNewsId},${digest.items[0]!.source_key})`;
  await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'news',${digest.items[0]!.source_key},${revokedNewsId})`;
  await sql`UPDATE publications SET eligible=false WHERE article_id=${articleId}`;
  const newsJob:OutboxRow={id:revokedNewsId,user_id:userId,kind:"news",payload:"old news",attempts:1,binding_version:1,subscription_version:2,local_date:date,part_index:0,sources_tracked:true};
  assert.equal(await revalidatePayload(newsJob),null,"a withdrawn publication must be dropped before delivery");

  const gpId=randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${gpId},${"GP-"+suffix},${"entity-"+suffix},'gp','active','https://example.test/gp',${userId})`;
  const investmentIds=[randomUUID(),randomUUID()];
  for(const [index,id] of investmentIds.entries()) await sql`INSERT INTO member_gp_investments
    (id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${id},${gpId},${"key-"+index},${"被投企业"+index},${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-20','https://example.test/source',${userId},now())`;
  for(const [index,id] of investmentIds.entries()){
    const outboxId=randomUUID();
    await sql`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at)
      VALUES(${outboxId},${userId},'gp',${date}::date,1,1,${index+1},'old gp','old',now())`;
    await sql`INSERT INTO member_notification_outbox_sources(outbox_id,source_key) VALUES(${outboxId},${id})`;
    await sql`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id) VALUES(${userId},'gp',${"gp:"+id},${outboxId})`;
    await sql`UPDATE member_notification_outbox SET status='sending' WHERE id=${outboxId}`;
    if(index===0) await sql`UPDATE member_gp_investments SET status='retracted' WHERE id=${id}`;
    else await sql`UPDATE member_gp_watchlist SET status='paused' WHERE id=${gpId}`;
    const gpJob:OutboxRow={id:outboxId,user_id:userId,kind:"gp",payload:"old gp",attempts:1,binding_version:1,subscription_version:1,local_date:date,part_index:index+1,sources_tracked:true};
    assert.equal(await revalidatePayload(gpJob),null,index===0?"retracted GP items must be dropped":"paused GP watchlists must be dropped");
  }
});
