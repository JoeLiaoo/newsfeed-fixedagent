// Each bot has one database-fenced poll lease. Network I/O never holds a database transaction.
import {createHash,randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {sql} from "@aihot/backend/db";
import type {Db} from "@aihot/backend/db";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {shutdownSignal} from "@aihot/backend/jobs/queue";
import {READING_QUEUE} from "../conversation/queue.ts";
import {latencyEvent} from "../conversation/latency.ts";
import {decryptSecret,encryptSecret,ilinkConfigured,ilinkErrorKind,pollIlinkInbox,sendIlinkText} from "./ilink.ts";

const GREETING_TEXT="已连接，之后会在这里推送。";
const KEEPALIVE_TEXT="【News Feed】推送通道即将失效。请随便回一句（例如「在」），否则可能收不到之后的资讯/GP。";
type AccountRow={
  user_id:string;recipient_id:string;channel_account_id:string;token_ciphertext:string;
  api_url:string;cursor_ciphertext:string|null;greeted_at:Date|null;
  binding_version:number;
  poll_lease_generation:number;
};
type PollLease={row:AccountRow;owner:string;generation:number};
type PollResult=Awaited<ReturnType<typeof pollIlinkInbox>>;
const POLL_LEASE_SECONDS=60; // 39s client timeout plus 21s for response parsing and commit.
/** One confirmation per account; the same key makes a retry after a failed send the same message. */
const greetingId=(userId:string)=>"ilink-greet-"+createHash("sha256").update(userId).digest("hex").slice(0,32);
/** Postgres hands a timestamptz over as a Date; a text column or a JSON round-trip may bring a string. */
function toDate(value:Date|string|number|null|undefined):Date|null{
  if(value===null||value===undefined)return null;
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?null:date;
}
/** Whole hours between 1 and 23; anything else keeps the 20-hour default. */
export function ilinkKeepaliveThresholdHours(value=process.env.P3_ILINK_KEEPALIVE_AFTER_HOURS):number{
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=1&&parsed<=23?parsed:20;
}
export function keepaliveNudgeEligible(input:{channelState:string;hasContext:boolean;lastInboundAt:Date|string|null;nudgedAt:Date|string|null;now?:Date;thresholdHours?:number;deliveryEnabled?:boolean}):boolean{
  if(input.deliveryEnabled===false||input.channelState!=="active"||!input.hasContext)return false;
  const inboundAt=toDate(input.lastInboundAt);
  if(!inboundAt)return false;
  const nudgedAt=toDate(input.nudgedAt);
  if(nudgedAt&&nudgedAt.getTime()>inboundAt.getTime())return false;
  return (toDate(input.now)??new Date()).getTime()-inboundAt.getTime()>=
    (input.thresholdHours??ilinkKeepaliveThresholdHours())*60*60*1000;
}
/** The same inbound window always produces the same send id, so a retry is the same message. */
export function keepaliveNudgeId(userId:string,lastInboundAt:Date|string):string{
  const inboundAt=toDate(lastInboundAt);
  if(!inboundAt)throw new Error("invalid_keepalive_inbound_at");
  return "ilink-keepalive-"+createHash("sha256").update(userId+"\0"+inboundAt.toISOString()).digest("hex").slice(0,40);
}

/**
 * Answers the first inbound message of an account: the employee learns that the connection works
 * without the bot having to hold a conversation. Only the connection is confirmed; no other
 * message is answered, and the delivery switch governs every send to the channel.
 */
async function confirmConnection(row:AccountRow,contextToken:string){
  if(process.env.P3_DELIVERY_ENABLED!=="true"||row.greeted_at)return false;
  const [valid]=await sql`SELECT 1 FROM member_ilink_accounts a
    JOIN member_notification_settings s ON s.user_id=a.user_id
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    WHERE a.user_id=${row.user_id} AND s.binding_version=${row.binding_version}
      AND a.channel_account_id=${row.channel_account_id} AND a.recipient_id=${row.recipient_id}
      AND b.channel_account_id=a.channel_account_id AND b.recipient_id=a.recipient_id
      AND a.greeted_at IS NULL`;
  if(!valid)return false;
  try{
    await sendIlinkText({
      botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
      base:row.api_url,contextToken,
    },GREETING_TEXT,greetingId(row.user_id));
  }catch{
    // The confirmation is retried with the next inbound message; nothing else is sent.
    return false;
  }
  const updated=await sql`UPDATE member_ilink_accounts a SET greeted_at=clock_timestamp()
    FROM member_notification_settings s,member_weixin_bindings b
    WHERE a.user_id=${row.user_id} AND s.user_id=a.user_id AND b.user_id=a.user_id
      AND s.binding_version=${row.binding_version} AND b.status='active'
      AND b.channel_account_id=${row.channel_account_id} AND b.recipient_id=${row.recipient_id}
      AND a.channel_account_id=${row.channel_account_id} AND a.recipient_id=${row.recipient_id}
      AND a.greeted_at IS NULL RETURNING a.user_id`;
  return updated.length>0;
}

/** Binding writers take the same advisory lock before changing settings/account rows. */
export async function claimIlinkPoll(userId:string,stopOnRebind=false):Promise<PollLease|null>{
  if(shutdownSignal.signal.aborted)return null;
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx`INSERT INTO member_notification_settings(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    const [settings]=await tx<{binding_version:number}[]>`SELECT binding_version FROM member_notification_settings WHERE user_id=${userId} FOR UPDATE`;
    const [row]=await tx<(AccountRow&{lease_live:boolean})[]>`
      SELECT a.user_id,a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,
        a.cursor_ciphertext,a.greeted_at,a.poll_lease_generation,
        (a.poll_lease_expires_at>clock_timestamp()) AS lease_live,
        COALESCE(${settings?.binding_version??1},1)::integer AS binding_version
      FROM member_ilink_accounts a
      JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
        AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
      JOIN member_users u ON u.id=a.user_id AND u.status='active'
      WHERE a.user_id=${userId} AND (${!stopOnRebind} OR a.channel_state<>'requires_rebind') FOR UPDATE OF a`;
    if(!row||row.lease_live)return null;
    const owner=randomUUID();
    const [claimed]=await tx<{poll_lease_generation:number}[]>`UPDATE member_ilink_accounts
      SET poll_lease_owner=${owner}::uuid,poll_lease_generation=poll_lease_generation+1,
        poll_lease_expires_at=clock_timestamp()+${POLL_LEASE_SECONDS}*interval '1 second'
      WHERE user_id=${userId} RETURNING poll_lease_generation`;
    return {row,owner,generation:claimed!.poll_lease_generation};
  });
}

/** A stale response changes nothing, including the cursor and business queue. */
export async function settleIlinkPoll(lease:PollLease,result?:PollResult,error?:unknown,
  afterSettle?: (tx:Db)=>Promise<void>):Promise<{recovered:boolean;greeting:string|null;committed:boolean}>{
  const {row,owner,generation}=lease;
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${row.user_id}))`;
    const [settings]=await tx<{binding_version:number}[]>`SELECT binding_version FROM member_notification_settings WHERE user_id=${row.user_id} FOR UPDATE`;
    const [current]=await tx<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
      JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
        AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
      JOIN member_users u ON u.id=a.user_id AND u.status='active'
      WHERE a.user_id=${row.user_id} AND a.channel_account_id=${row.channel_account_id}
        AND a.recipient_id=${row.recipient_id} AND a.poll_lease_owner=${owner}::uuid
        AND a.poll_lease_generation=${generation} AND a.poll_lease_expires_at>clock_timestamp()
      FOR UPDATE OF a`;
    if(!current||settings?.binding_version!==row.binding_version)return {recovered:false,greeting:null,committed:false};
    let greeting:string|null=null;
    if(result){
      for(const [pollPosition,message] of result.messages.entries()){
        const readingEnabled=process.env.P3_ILINK_READING_REPLIES_ENABLED==="true";
        const [inserted]=await tx<{id:string}[]>`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,seq,body,status,received_at,poll_position)
          VALUES(${randomUUID()},${row.user_id},${row.binding_version},${row.channel_account_id},${message.id},${message.seq},${message.text.slice(0,4096)},${readingEnabled?'pending':'ignored'},${result.receivedAt},${pollPosition})
          ON CONFLICT(bot_id,upstream_id) DO NOTHING RETURNING id`;
        if(inserted&&readingEnabled)await enqueueOn(READING_QUEUE,{inboundId:inserted.id},{singletonKey:inserted.id},tx);
      }
      if(result.hadInbound&&result.contextToken){
        await tx`UPDATE member_ilink_accounts SET
          cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
          context_ciphertext=${encryptSecret(result.contextToken)},channel_state='active',
          last_inbound_at=${result.receivedAt},updated_at=clock_timestamp()
          WHERE user_id=${row.user_id}`;
        await tx`UPDATE member_notification_outbox SET status='failed',next_attempt_at=now(),error_code=NULL
          WHERE user_id=${row.user_id} AND status='failed' AND error_code='needs_interaction'`;
        if(process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true"&&!row.greeted_at)greeting=result.contextToken;
      }else{
        await tx`UPDATE member_ilink_accounts SET cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
          updated_at=clock_timestamp() WHERE user_id=${row.user_id}`;
      }
    }else if(ilinkErrorKind(error)==="requires_rebind"){
      await tx`UPDATE member_ilink_accounts SET channel_state='requires_rebind',updated_at=clock_timestamp()
        WHERE user_id=${row.user_id}`;
    }
    const released=await tx`UPDATE member_ilink_accounts SET last_polled_at=clock_timestamp(),
      poll_lease_owner=NULL,poll_lease_expires_at=NULL
      WHERE user_id=${row.user_id} AND poll_lease_owner=${owner}::uuid
        AND poll_lease_generation=${generation} AND poll_lease_expires_at>clock_timestamp()
      RETURNING user_id`;
    if(!released.length)throw new Error("ilink_poll_lease_expired_before_commit");
    // A continuous poll's successor commits with its cursor and lease release.
    if(afterSettle)await afterSettle(tx);
    return {recovered:!!result?.hadInbound&&!!result.contextToken,greeting,committed:true};
  });
}

export async function pollOneMemberIlinkInbox(userId:string,afterSettle?: (tx:Db,result:PollResult|undefined,error:unknown)=>Promise<void>,stopOnRebind=false) {
  if(!ilinkConfigured()||shutdownSignal.signal.aborted)return {checked:0,recovered:0,greeted:0,committed:false};
  const lease=await claimIlinkPoll(userId,stopOnRebind);
  if(!lease)return {checked:0,recovered:0,greeted:0,committed:false};
  const {row}=lease;
  const pollId=randomUUID();
  const pollStarted=performance.now();
  try{
    const result=await pollIlinkInbox({
      botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
      base:row.api_url,cursor:row.cursor_ciphertext?decryptSecret(row.cursor_ciphertext):null,
    },undefined,shutdownSignal.signal);
    latencyEvent({correlationId:pollId,stage:"poll",route:"inbox",status:"returned",durationMs:result.pollDurationMs});
    const settled=await settleIlinkPoll(lease,result,undefined,afterSettle?tx=>afterSettle(tx,result,undefined):undefined);
    const greeted=settled.greeting&&await confirmConnection(row,settled.greeting)?1:0;
    return {checked:1,recovered:Number(settled.recovered),greeted,committed:settled.committed,result};
  }catch(error){
    latencyEvent({correlationId:pollId,stage:"poll",route:"inbox",status:"failed",durationMs:performance.now()-pollStarted});
    // A failed commit retains the cursor. An expired lease is recovered by the minute gap-fill.
    const settled=await settleIlinkPoll(lease,undefined,error,afterSettle?tx=>afterSettle(tx,undefined,error):undefined).catch(()=>null);
    return {checked:1,recovered:0,greeted:0,committed:!!settled?.committed,error};
  }
}

export async function pollMemberIlinkInboxes() {
  if(!ilinkConfigured()||shutdownSignal.signal.aborted)return {disabled:true};
  // The fast queue owns its canary Bots exclusively; this minute task remains their gap-fill.
  const {fastPollEnabledFor}=await import("./inbox-queue.ts");
  if(process.env.P3_ILINK_FAST_POLL_ENABLED==="true"){
    const {fillFastPollGaps}=await import("./inbox-queue.ts");
    await fillFastPollGaps();
  }
  const accounts=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    ORDER BY a.last_polled_at NULLS FIRST,a.user_id`;
  let checked=0,recovered=0,greeted=0;
  const legacy=accounts.filter(account=>!fastPollEnabledFor(account.user_id)).slice(0,20);
  await Promise.all(legacy.map(async account=>{
    const result=await pollOneMemberIlinkInbox(account.user_id);
    checked+=result.checked;recovered+=result.recovered;greeted+=result.greeted;
  }));
  return {checked,recovered,greeted};
}

/** Send one idempotent reminder per inbound window, while the context is still usable. */
export async function nudgeNearExpiryIlinkChannels(now=new Date()):Promise<{nudged:number;disabled?:boolean}>{
  if(process.env.P3_DELIVERY_ENABLED!=="true"||!ilinkConfigured())return {nudged:0,disabled:true};
  const thresholdHours=ilinkKeepaliveThresholdHours();
  // The cutoff is computed here, so the query and the eligibility rule below share one instant.
  const cutoff=new Date(now.getTime()-thresholdHours*60*60*1000);
  const due=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    WHERE a.channel_state='active' AND a.context_ciphertext IS NOT NULL AND a.last_inbound_at IS NOT NULL
      AND a.last_inbound_at<=${cutoff}
      AND (a.keepalive_nudged_at IS NULL OR a.keepalive_nudged_at<=a.last_inbound_at)
    ORDER BY a.last_inbound_at LIMIT 100`;
  let nudged=0;
  for(const account of due){
    const sent=await sql.begin(async tx=>{
      const [row]=await tx<{user_id:string;recipient_id:string;channel_account_id:string;token_ciphertext:string;api_url:string;context_ciphertext:string;channel_state:string;last_inbound_at:Date;keepalive_nudged_at:Date|null}[]>`SELECT a.user_id,a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,
          a.context_ciphertext,a.channel_state,a.last_inbound_at,a.keepalive_nudged_at
        FROM member_ilink_accounts a JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
          JOIN member_users u ON u.id=a.user_id AND u.status='active'
        WHERE a.user_id=${account.user_id} FOR UPDATE OF a SKIP LOCKED`;
      if(!row||!keepaliveNudgeEligible({channelState:row.channel_state,hasContext:!!row.context_ciphertext,
        lastInboundAt:row.last_inbound_at,nudgedAt:row.keepalive_nudged_at,now,thresholdHours,
        deliveryEnabled:process.env.P3_DELIVERY_ENABLED==="true"}))return false;
      if(process.env.P3_NEWS_COMPACT_ENABLED==="true"){
        const [paused]=await tx`SELECT 1 FROM member_notification_settings
          WHERE user_id=${row.user_id} AND paused_until>now()`;
        if(paused)return false;
        const [recent]=await tx`SELECT 1 FROM member_notification_outbox o
          JOIN member_news_compact_editions e ON e.outbox_id=o.id
          WHERE o.user_id=${row.user_id} AND o.status='accepted' AND o.accepted_at>${new Date(now.getTime()-30*60*1000)} LIMIT 1`;
        if(recent)return false;
      }
      try{
        await sendIlinkText({botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
          base:row.api_url,contextToken:decryptSecret(row.context_ciphertext)},KEEPALIVE_TEXT,
          keepaliveNudgeId(row.user_id,row.last_inbound_at));
      }catch(error){
        // A dead session must not be retried every minute: the state keeps it out of the next query.
        const kind=ilinkErrorKind(error);
        if(kind==="requires_rebind"||kind==="needs_interaction")
          await tx`UPDATE member_ilink_accounts SET channel_state=${kind},updated_at=now() WHERE user_id=${row.user_id}`;
        return false;
      }
      // The row lock holds this window still while the message is sent. The timestamp is not
      // compared again: Postgres keeps microseconds and a Date does not, so equality never matches.
      const updated=await tx`UPDATE member_ilink_accounts SET keepalive_nudged_at=now(),updated_at=now()
        WHERE user_id=${row.user_id} AND channel_state='active'
          AND (keepalive_nudged_at IS NULL OR keepalive_nudged_at<=last_inbound_at) RETURNING user_id`;
      return updated.length>0;
    });
    if(sent)nudged++;
  }
  return {nudged};
}
