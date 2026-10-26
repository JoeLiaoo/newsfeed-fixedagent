// One bounded inbound poll per iLink bot. PgBoss runs this as a singleton; row locks
// additionally serialize polls with unbind and prevent two workers consuming one cursor.
import {createHash} from "node:crypto";
import {sql,type Tx} from "@aihot/backend/db";
import {decryptSecret,encryptSecret,ilinkConfigured,ilinkErrorKind,pollIlinkInbox,sendIlinkText} from "./ilink.ts";

const GREETING_TEXT="已连接，之后会在这里推送。";
const KEEPALIVE_TEXT="【News Feed】推送通道即将失效。请随便回一句（例如「在」），否则可能收不到之后的资讯/GP。";
type AccountRow={
  user_id:string;recipient_id:string;channel_account_id:string;token_ciphertext:string;
  api_url:string;cursor_ciphertext:string|null;greeted_at:Date|null;
};
/** One confirmation per account; the same key makes a retry after a failed send the same message. */
const greetingId=(userId:string)=>"ilink-greet-"+createHash("sha256").update(userId).digest("hex").slice(0,32);
export function ilinkKeepaliveThresholdHours(value=process.env.P3_ILINK_KEEPALIVE_AFTER_HOURS):number{
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=1&&parsed<=23?parsed:20;
}
export function keepaliveNudgeEligible(input:{channelState:string;hasContext:boolean;lastInboundAt:Date|null;nudgedAt:Date|null;now?:Date;thresholdHours?:number;deliveryEnabled?:boolean}):boolean{
  if(input.deliveryEnabled===false||input.channelState!=="active"||!input.hasContext||!input.lastInboundAt)return false;
  if(input.nudgedAt&&input.nudgedAt.getTime()>input.lastInboundAt.getTime())return false;
  return (input.now??new Date()).getTime()-input.lastInboundAt.getTime()>=
    (input.thresholdHours??ilinkKeepaliveThresholdHours())*60*60*1000;
}
export function keepaliveNudgeId(userId:string,lastInboundAt:Date):string{
  return "ilink-keepalive-"+createHash("sha256").update(userId+"\0"+lastInboundAt.toISOString()).digest("hex").slice(0,40);
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
    ORDER BY a.updated_at LIMIT 20`;
  let checked=0,recovered=0,greeted=0;
  for(let start=0;start<accounts.length;start+=5){
    await Promise.all(accounts.slice(start,start+5).map(async account=>sql.begin(async tx=>{
      const [row]=await tx<AccountRow[]>`SELECT a.user_id,a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,a.cursor_ciphertext,a.greeted_at
        FROM member_ilink_accounts a WHERE a.user_id=${account.user_id} FOR UPDATE SKIP LOCKED`;
      if(!row)return;
      checked++;
      try{
        const result=await pollIlinkInbox({
          botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
          base:row.api_url,cursor:row.cursor_ciphertext?decryptSecret(row.cursor_ciphertext):null,
        });
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
          if(await confirmConnection(tx,row,result.contextToken))greeted++;
        }else{
          await tx`UPDATE member_ilink_accounts SET cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
            updated_at=now() WHERE user_id=${row.user_id}`;
        }
      }catch(error){
        if(ilinkErrorKind(error)==="requires_rebind")
          await tx`UPDATE member_ilink_accounts SET channel_state='requires_rebind',updated_at=now() WHERE user_id=${row.user_id}`;
        // No raw API response or account credentials in logs.
      }
    })));
  }
  const nudged=await nudgeNearExpiryIlinkChannels();
  return {checked,recovered,greeted,nudged};
}

/** Send one idempotent reminder per inbound window, while the context is still usable. */
export async function nudgeNearExpiryIlinkChannels(now=new Date()){
  if(process.env.P3_DELIVERY_ENABLED!=="true"||!ilinkConfigured())return {disabled:true};
  const thresholdHours=ilinkKeepaliveThresholdHours();
  const due=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    WHERE a.channel_state='active' AND a.context_ciphertext IS NOT NULL AND a.last_inbound_at IS NOT NULL
      AND a.last_inbound_at<=${now}::timestamptz - make_interval(hours => ${thresholdHours})
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
      try{
        await sendIlinkText({botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
          base:row.api_url,contextToken:decryptSecret(row.context_ciphertext)},KEEPALIVE_TEXT,
          keepaliveNudgeId(row.user_id,row.last_inbound_at));
      }catch{return false;}
      const updated=await tx`UPDATE member_ilink_accounts SET keepalive_nudged_at=now(),updated_at=now()
        WHERE user_id=${row.user_id} AND channel_state='active' AND last_inbound_at=${row.last_inbound_at}
          AND (keepalive_nudged_at IS NULL OR keepalive_nudged_at<=last_inbound_at) RETURNING user_id`;
      return updated.length>0;
    });
    if(sent)nudged++;
  }
  return {nudged};
}
