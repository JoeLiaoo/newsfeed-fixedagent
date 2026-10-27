// One writer for a bound iLink identity. The page poll and the worker's own scan confirmation
// both come here, so one scan can never leave two bindings or a half-written account behind.
import { sql } from "@aihot/backend/db";
import { encryptSecret } from "./ilink.ts";

export type IlinkIdentity={recipientId:string;channelAccountId:string;botToken:string;base:string};
export type BindingOutcome="bound"|"already_bound"|"invalid_session"|"identity_already_bound";

/**
 * Writes the confirmed identity of one scan session. The scan row is consumed in the same
 * transaction, so a second confirmation of the same scan reports the existing binding instead of
 * creating a second one. The web session that started the scan must still be valid.
 */
export async function completeIlinkBinding(userId:string,sessionHash:string,scanSecret:string,identity:IlinkIdentity):Promise<BindingOutcome>{
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const [still]=await tx`SELECT user_id FROM member_sessions WHERE token_hash=${sessionHash} AND user_id=${userId} AND expires_at>now()`;
    const [active]=await tx`SELECT id FROM member_users WHERE id=${userId} AND status='active'`;
    const [current]=await tx<{session_hash:string;qr_secret:string;expires_at:Date}[]>`SELECT session_hash,qr_secret,expires_at FROM member_ilink_logins WHERE user_id=${userId} FOR UPDATE`;
    if(!current){
      // The scan row is gone: a concurrent confirmation may already have consumed it.
      const [bound]=await tx<{recipient_id:string;channel_account_id:string}[]>`SELECT recipient_id,channel_account_id FROM member_weixin_bindings WHERE user_id=${userId}`;
      if(bound&&bound.recipient_id===identity.recipientId&&bound.channel_account_id===identity.channelAccountId)return "already_bound";
      return "invalid_session";
    }
    // AES-GCM gives each QR a fresh ciphertext. The same web session may replace a failed QR,
    // so session_hash alone cannot identify the scan whose channel response just arrived.
    if(current.session_hash!==sessionHash||current.qr_secret!==scanSecret||new Date(current.expires_at).getTime()<=Date.now())return "invalid_session";
    if(!still||!active)return "invalid_session";
    // One iLink user and one bot belong to one platform account; a second owner is never overwritten.
    const collision=await tx`SELECT user_id FROM member_weixin_bindings
        WHERE (recipient_id=${identity.recipientId} OR channel_account_id=${identity.channelAccountId}) AND user_id<>${userId}
      UNION SELECT user_id FROM member_ilink_accounts WHERE channel_account_id=${identity.channelAccountId} AND user_id<>${userId}`;
    if(collision.length)return "identity_already_bound";
    await tx`INSERT INTO member_notification_settings(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${userId}`;
    await tx`DELETE FROM member_ilink_conversations WHERE user_id=${userId}`;
    await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='binding_changed'
      WHERE user_id=${userId} AND status IN('pending','failed')`;
    await tx`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url,channel_state)
      VALUES(${userId},${identity.recipientId},${identity.channelAccountId},${encryptSecret(identity.botToken)},${identity.base},'needs_interaction')
      ON CONFLICT(user_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,channel_account_id=EXCLUDED.channel_account_id,
      token_ciphertext=EXCLUDED.token_ciphertext,api_url=EXCLUDED.api_url,channel_state='needs_interaction',
      context_ciphertext=NULL,cursor_ciphertext=NULL,greeted_at=NULL,last_inbound_at=NULL,
      poll_lease_owner=NULL,poll_lease_expires_at=NULL,updated_at=now()`;
    await tx`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
      VALUES(${userId},${identity.recipientId},${identity.channelAccountId})
      ON CONFLICT(user_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,channel_account_id=EXCLUDED.channel_account_id,status='active',bound_at=now()`;
    const cancelled=await tx<{id:string}[]>`UPDATE member_notification_outbox
      SET status='cancelled',error_code='binding_changed',lease_expires_at=NULL
      WHERE user_id=${userId} AND status IN('pending','failed','sending') RETURNING id`;
    if(cancelled.length)await tx`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${tx.array(cancelled.map(x=>x.id))}::text[])`;
    await tx`DELETE FROM member_ilink_logins WHERE user_id=${userId}`;
    return "bound";
  });
}
