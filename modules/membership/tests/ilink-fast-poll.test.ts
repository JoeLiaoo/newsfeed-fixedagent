import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {ensureQueue,getBoss,stopBossNow} from "@aihot/backend/jobs/queue";
import {decryptSecret,encryptSecret} from "../notifications/ilink.ts";
import {FAST_POLL_QUEUE,fillFastPollGaps} from "../notifications/inbox-queue.ts";
import {pollOneMemberIlinkInbox,pollMemberIlinkInboxes} from "../notifications/inbox.ts";

const wait=async(check:()=>boolean|Promise<boolean>)=>{
  for(let n=0;n<250;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.fail("timed out waiting for fast poll");
};
const reply=(cursor:string,msgs:object[]=[])=>new Response(JSON.stringify({ret:0,get_updates_buf:cursor,msgs}),{status:200});

test("21 Bot jobs are fair, one active Bot continues past blocked peers, and legacy resumes its cursor",async t=>{
  const keys=["P3_ILINK_CREDENTIAL_KEY","P3_ILINK_BINDING_ENABLED","P3_ILINK_FAST_POLL_ENABLED","P3_ILINK_FAST_POLL_USER_IDS",
    "P3_ILINK_READING_REPLIES_ENABLED","P3_DELIVERY_ENABLED"];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const oldFetch=globalThis.fetch;
  const prefix=randomUUID().slice(0,8);
  const ids=Array.from({length:21},(_,n)=>`00000000-0000-4000-8000-${String(n+1).padStart(12,"0")}`);
  process.env.P3_ILINK_CREDENTIAL_KEY="a".repeat(64);
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_FAST_POLL_ENABLED="true";
  process.env.P3_ILINK_FAST_POLL_USER_IDS=ids.join(",");
  process.env.P3_ILINK_READING_REPLIES_ENABLED="false";
  process.env.P3_DELIVERY_ENABLED="false";
  const blocked=new Map<number,Array<(value:Response)=>void>>();
  const calls=new Map<number,string[]>();
  let releaseActive!:(value:Response)=>void;
  const activeFirst=new Promise<Response>(resolve=>{releaseActive=resolve;});
  let legacy=false;
  globalThis.fetch=(async(_input,init)=>{
    const headers=init?.headers as Record<string,string>;
    const index=Number(headers.Authorization?.replace("Bearer fixture-",""));
    const cursor=(JSON.parse(String(init?.body)) as {get_updates_buf:string}).get_updates_buf;
    calls.set(index,[...(calls.get(index)??[]),cursor]);
    if(legacy)return reply("legacy-cursor");
    if(index===20&&(calls.get(index)?.length??0)===1)return activeFirst;
    return new Promise<Response>(resolve=>blocked.set(index,[...(blocked.get(index)??[]),resolve]));
  }) as typeof fetch;
  t.after(async()=>{
    process.env.P3_ILINK_FAST_POLL_ENABLED="false";
    for(const resolvers of blocked.values())for(const resolve of resolvers)resolve(reply("drain-cursor"));
    await stopBossNow();await closeDb();globalThis.fetch=oldFetch;
    for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;
  });
  for(let n=0;n<ids.length;n++){
    const userId=ids[n]!,recipient=`recipient-${n+1}`,bot=`bot-${n+1}`;
    await sql`INSERT INTO member_users(id,username,real_name,password_hash,status)
      VALUES(${userId},${`fast-${prefix}-${n}`},'合成员工','fixture','active')`;
    await sql`INSERT INTO member_notification_settings(user_id) VALUES(${userId})`;
    await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
      VALUES(${userId},${recipient},${bot})`;
    await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
      VALUES(${userId},${recipient},${bot},${encryptSecret(`fixture-${n+1}`)},'https://ilinkai.weixin.qq.com')`;
  }
  assert.equal((await fillFastPollGaps()).queued,21);
  assert.equal((await fillFastPollGaps()).queued,0,"gap-fill cannot duplicate queued jobs");
  await pollMemberIlinkInboxes();
  assert.equal(calls.size,0,"minute cron does not directly poll fast accounts");
  const boss=await getBoss();await ensureQueue(FAST_POLL_QUEUE.name,FAST_POLL_QUEUE.options);
  await boss.work<{userId:string;emptyStreak:number;errorStreak:number}>(FAST_POLL_QUEUE.name,
    {...FAST_POLL_QUEUE.worker,pollingIntervalSeconds:0.5},async jobs=>FAST_POLL_QUEUE.run(jobs.map(job=>job.data)));
  await wait(()=>Array.from({length:20},(_,n)=>calls.has(n+1)).every(Boolean));
  assert.equal(calls.has(21),false,"initially only 20 network requests are in flight");
  releaseActive(reply("active-cursor",[{
    message_id:"active-msg",seq:"1",from_user_id:"recipient-20",to_user_id:"bot-20",
    message_type:1,message_state:2,context_token:"active-context",item_list:[{type:1,text_item:{text:"帮助"}}],
  }]));
  await wait(()=>calls.has(21));
  assert.equal((calls.get(20)??[]).length,1,"older 21st job gets the freed slot first");
  blocked.get(1)?.shift()?.(reply("peer-cursor"));
  await wait(()=>(calls.get(20)?.length??0)>=2);
  assert.equal(calls.get(20)?.[1],"active-cursor","active Bot reconnects while other peers remain blocked");
  const [saved]=await sql<{cursor_ciphertext:string}[]>`SELECT cursor_ciphertext FROM member_ilink_accounts WHERE user_id=${ids[19]!}`;
  assert.equal(decryptSecret(saved!.cursor_ciphertext),"active-cursor");
  process.env.P3_ILINK_FAST_POLL_ENABLED="false";
  for(const resolvers of blocked.values())for(const resolve of resolvers)resolve(reply("drain-cursor"));
  await wait(async()=>{
    const [row]=await sql<{live:boolean}[]>`SELECT poll_lease_owner IS NOT NULL AS live FROM member_ilink_accounts WHERE user_id=${ids[19]!}`;
    return !row?.live;
  });
  legacy=true;
  await pollOneMemberIlinkInbox(ids[19]!);
  assert.equal(calls.get(20)?.at(-1),"drain-cursor","legacy mode starts from the latest committed cursor");
  const beforeRebind=calls.get(20)!.length;
  await sql`UPDATE member_ilink_accounts SET channel_state='requires_rebind' WHERE user_id=${ids[19]!}`;
  process.env.P3_ILINK_FAST_POLL_ENABLED="true";
  await FAST_POLL_QUEUE.run([{userId:ids[19]!,emptyStreak:0,errorStreak:0}]);
  assert.equal(calls.get(20)!.length,beforeRebind,"requires_rebind stops a previously queued fast job");
  process.env.P3_ILINK_FAST_POLL_ENABLED="false";
  await pollMemberIlinkInboxes();
  assert.equal((await fillFastPollGaps()).queued,0,"flag off stops new fast jobs");
  await sql`UPDATE member_ilink_accounts SET channel_state='active' WHERE user_id=${ids[19]!}`;
  await wait(async()=>{
    const [row]=await sql<{count:number}[]>`SELECT count(*)::int AS count FROM pgboss.job
      WHERE name=${FAST_POLL_QUEUE.name} AND singleton_key=${ids[19]!} AND state IN ('created','retry','active')`;
    return row!.count===0;
  });
  await boss.offWork(FAST_POLL_QUEUE.name);
  process.env.P3_ILINK_FAST_POLL_USER_IDS=ids[19]!;
  process.env.P3_ILINK_FAST_POLL_ENABLED="true";
  const beforeRestart=calls.get(20)!.length;
  assert.equal((await fillFastPollGaps()).queued,1,"a stopped worker leaves a durable job for restart");
  assert.equal(calls.get(20)!.length,beforeRestart,"no network call while the worker is stopped");
  await boss.work<{userId:string;emptyStreak:number;errorStreak:number}>(FAST_POLL_QUEUE.name,
    {...FAST_POLL_QUEUE.worker,pollingIntervalSeconds:0.5},async jobs=>FAST_POLL_QUEUE.run(jobs.map(job=>job.data)));
  await wait(()=>(calls.get(20)?.length??0)>beforeRestart);
  assert.equal(calls.get(20)?.at(-1),"legacy-cursor","restarted worker uses the latest committed cursor");
  await wait(async()=>{
    const [job]=await sql`SELECT 1 FROM pgboss.job WHERE name=${FAST_POLL_QUEUE.name}
      AND singleton_key=${ids[19]!} AND state='created' AND start_after>created_on+interval '900 milliseconds'`;
    return !!job;
  });
  process.env.P3_ILINK_FAST_POLL_ENABLED="false";
});
