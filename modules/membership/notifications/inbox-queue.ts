import {sql} from "@aihot/backend/db";
import type {Db} from "@aihot/backend/db";
import {enqueueOn,ensureQueue,shutdownSignal} from "@aihot/backend/jobs/queue";
import type {ModuleQueue} from "@aihot/backend/modules";
import {ilinkConfigured,ilinkErrorKind} from "./ilink.ts";
import {pollOneMemberIlinkInbox} from "./inbox.ts";

type FastJob={userId:string;emptyStreak:number;errorStreak:number};
const GROUP={id:"ilink-fast-poll"};
const MAX_CONCURRENCY=20;

/** An explicit server-side UUID allowlist keeps the global flag safe for a small canary. */
export function fastPollEnabledFor(userId:string):boolean{
  return process.env.P3_ILINK_FAST_POLL_ENABLED==="true" &&
    (process.env.P3_ILINK_FAST_POLL_USER_IDS??"").split(",").some(id=>id.trim()===userId);
}

export function nextFastPollDelay(result:{pollDurationMs:number;messages:unknown[];hadInbound:boolean}|undefined,
  error:unknown,emptyStreak:number,errorStreak:number,random=Math.random):{delayMs:number;emptyStreak:number;errorStreak:number;stop:boolean}{
  if(error!==undefined){
    if(ilinkErrorKind(error)==="requires_rebind")return {delayMs:0,emptyStreak:0,errorStreak:0,stop:true};
    const streak=Math.min(8,errorStreak+1);
    const ceiling=Math.min(60_000,2_000*2**(streak-1));
    return {delayMs:Math.round(ceiling*(0.5+random()*0.5)),emptyStreak:0,errorStreak:streak,stop:false};
  }
  if(result?.hadInbound||result?.messages.length)return {delayMs:0,emptyStreak:0,errorStreak:0,stop:false};
  // An upstream that returns immediately must not turn a Bot into a tight request loop.
  if((result?.pollDurationMs??0)>=5_000)return {delayMs:0,emptyStreak:0,errorStreak:0,stop:false};
  const streak=Math.min(6,emptyStreak+1);
  return {delayMs:Math.min(30_000,1_000*2**(streak-1)),emptyStreak:streak,errorStreak:0,stop:false};
}

async function enqueueFastPoll(job:FastJob,delayMs:number,tx:Db){
  await enqueueOn(FAST_POLL_QUEUE,job,{group:GROUP,singletonKey:job.userId,
    startAfter:new Date(Date.now()+delayMs)},tx);
}

export const FAST_POLL_QUEUE:ModuleQueue<FastJob>={
  name:"membership.ilink-fast-poll",
  options:{policy:"short",retryLimit:0,expireInSeconds:90},
  worker:{batchSize:1,localConcurrency:MAX_CONCURRENCY,groupConcurrency:MAX_CONCURRENCY,pollingIntervalSeconds:1},
  run:async jobs=>{
    for(const job of jobs){
      if(shutdownSignal.signal.aborted||!fastPollEnabledFor(job.userId))continue;
      await pollOneMemberIlinkInbox(job.userId,async(tx,result,error)=>{
        if(shutdownSignal.signal.aborted||!fastPollEnabledFor(job.userId))return;
        const next=nextFastPollDelay(result,error,job.emptyStreak,job.errorStreak);
        if(!next.stop)await enqueueFastPoll({userId:job.userId,emptyStreak:next.emptyStreak,
          errorStreak:next.errorStreak},next.delayMs,tx);
      },true);
    }
  },
};

/** Minute recovery discovers bindings and fills only missing jobs; it never runs network I/O. */
export async function fillFastPollGaps():Promise<{queued:number}>{
  if(!ilinkConfigured()||shutdownSignal.signal.aborted)return {queued:0};
  await ensureQueue(FAST_POLL_QUEUE.name,FAST_POLL_QUEUE.options);
  const accounts=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
      AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    WHERE a.channel_state<>'requires_rebind' ORDER BY a.last_polled_at NULLS FIRST,a.user_id`;
  let queued=0;
  for(const account of accounts){
    if(!fastPollEnabledFor(account.user_id))continue;
    const added=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${account.user_id}))`;
      const [current]=await tx`SELECT 1 FROM member_ilink_accounts a
        JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
          AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
        JOIN member_users u ON u.id=a.user_id AND u.status='active'
        WHERE a.user_id=${account.user_id} AND a.channel_state<>'requires_rebind'
          AND (a.poll_lease_expires_at IS NULL OR a.poll_lease_expires_at<=clock_timestamp())
        FOR UPDATE OF a`;
      if(!current)return false;
      const [existing]=await tx`SELECT 1 FROM pgboss.job
        WHERE name=${FAST_POLL_QUEUE.name} AND singleton_key=${account.user_id}
          AND state IN ('created','retry','active') LIMIT 1`;
      if(existing)return false;
      await enqueueFastPoll({userId:account.user_id,emptyStreak:0,errorStreak:0},0,tx);
      return true;
    });
    if(added)queued++;
  }
  return {queued};
}
