// One bounded inbound poll per iLink bot. PgBoss runs this as a singleton; row locks
// additionally serialize polls with unbind and prevent two workers consuming one cursor.
import {createHash,randomUUID} from "node:crypto";
import {sql,type Tx} from "@aihot/backend/db";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {READING_QUEUE} from "../conversation/queue.ts";
import {decryptSecret,encryptSecret,ilinkConfigured,ilinkErrorKind,pollIlinkInbox,sendIlinkText} from "./ilink.ts";

const GREETING_TEXT="已连接，之后会在这里推送。";
const KEEPALIVE_TEXT="【News Feed】推送通道即将失效。请随便回一句（例如「在」），否则可能收不到之后的资讯/GP。";
type AccountRow={
  user_id:string;recipient_id:string;channel_account_id:string;token_ciphertext:string;
  api_url:string;cursor_ciphertext:string|null;greeted_at:Date|null;
  binding_version:number;
};
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
async function confirmConnection(tx:Tx,row:AccountRow,contextToken:string){
  if(process.env.P3_DELIVERY_ENABLED!=="true"||row.greeted_at)return false;
  try{
    await sendIlinkText({
      botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
      base:row.api_url,contextToken,
    },GREETING_TEXT,greetingId(row.user_id));
  }catch{
    // The confirmation is retried with the next inbound message; nothing else is sent.
    return false;
  }
  await tx`UPDATE member_ilink_accounts SET greeted_at=now() WHERE user_id=${row.user_id}`;
  return true;
}

export async function pollMemberIlinkInboxes() {
  if(!ilinkConfigured())return {disabled:true};
  const accounts=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    ORDER BY a.last_polled_at NULLS FIRST,a.user_id LIMIT 20`;
  let checked=0,recovered=0,greeted=0;
  for(let start=0;start<accounts.length;start+=20){
    await Promise.all(accounts.slice(start,start+20).map(async account=>sql.begin(async tx=>{
      const [row]=await tx<AccountRow[]>`SELECT a.user_id,a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,a.cursor_ciphertext,a.greeted_at,
        COALESCE(s.binding_version,1) AS binding_version
        FROM member_ilink_accounts a LEFT JOIN member_notification_settings s ON s.user_id=a.user_id
        WHERE a.user_id=${account.user_id} FOR UPDATE OF a SKIP LOCKED`;
      if(!row)return;
      checked++;
      try{
        const result=await pollIlinkInbox({
          botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
          base:row.api_url,cursor:row.cursor_ciphertext?decryptSecret(row.cursor_ciphertext):null,
        });
        for(const message of result.messages){
          const readingEnabled=process.env.P3_ILINK_READING_REPLIES_ENABLED==="true";
          const [inserted]=await tx<{id:string}[]>`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,seq,body,status)
            VALUES(${randomUUID()},${row.user_id},${row.binding_version},${row.channel_account_id},${message.id},${message.seq},${message.text.slice(0,4096)},${readingEnabled?'pending':'ignored'})
            ON CONFLICT(bot_id,upstream_id) DO NOTHING RETURNING id`;
          if(inserted&&readingEnabled)await enqueueOn(READING_QUEUE,{inboundId:inserted.id},{singletonKey:inserted.id},tx);
        }
        if(result.hadInbound && result.contextToken){
          recovered++;
          await tx`UPDATE member_ilink_accounts SET
            cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
            context_ciphertext=${encryptSecret(result.contextToken)},
            channel_state='active',last_inbound_at=now(),updated_at=now()
            WHERE user_id=${row.user_id}`;
          // Only formerly blocked, recent messages are eligible; outbox expiry is enforced by dispatcher.
          await tx`UPDATE member_notification_outbox SET status='failed',next_attempt_at=now(),error_code=NULL
            WHERE user_id=${row.user_id} AND status='failed' AND error_code='needs_interaction'`;
          if(process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true"&&await confirmConnection(tx,row,result.contextToken))greeted++;
        }else{
          await tx`UPDATE member_ilink_accounts SET cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
            updated_at=now() WHERE user_id=${row.user_id}`;
        }
      }catch(error){
        if(ilinkErrorKind(error)==="requires_rebind")
          await tx`UPDATE member_ilink_accounts SET channel_state='requires_rebind',updated_at=now() WHERE user_id=${row.user_id}`;
        // No raw API response or account credentials in logs.
      }finally{
        await tx`UPDATE member_ilink_accounts SET last_polled_at=now() WHERE user_id=${row.user_id}`;
      }
    })));
  }
  // A failing reminder must not stop the inbound poll; the next minute tries again.
  let nudged=0;
  try{nudged=(await nudgeNearExpiryIlinkChannels()).nudged;}
  catch{
    // The reminder is retried with the next run; the inbound messages above are already recorded.
  }
  return {checked,recovered,greeted,nudged};
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
