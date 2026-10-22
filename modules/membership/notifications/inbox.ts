// One bounded inbound poll per iLink bot. PgBoss runs this as a singleton; row locks
// additionally serialize polls with unbind and prevent two workers consuming one cursor.
import {sql} from "@aihot/backend/db";
import {decryptSecret,encryptSecret,ilinkConfigured,ilinkErrorKind,pollIlinkInbox} from "./ilink.ts";

type AccountRow={
  user_id:string;recipient_id:string;channel_account_id:string;token_ciphertext:string;
  api_url:string;cursor_ciphertext:string|null;
};
export async function pollMemberIlinkInboxes() {
  if(!ilinkConfigured())return {disabled:true};
  const accounts=await sql<{user_id:string}[]>`SELECT a.user_id FROM member_ilink_accounts a
    JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
    JOIN member_users u ON u.id=a.user_id AND u.status='active'
    ORDER BY a.updated_at LIMIT 20`;
  let checked=0,recovered=0;
  for(const account of accounts){
    await sql.begin(async tx=>{
      const [row]=await tx<AccountRow[]>`SELECT a.user_id,a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,a.cursor_ciphertext
        FROM member_ilink_accounts a WHERE a.user_id=${account.user_id} FOR UPDATE SKIP LOCKED`;
      if(!row)return;
      checked++;
      try{
        const result=await pollIlinkInbox({
          botId:row.channel_account_id,recipientId:row.recipient_id,token:decryptSecret(row.token_ciphertext),
          base:row.api_url,cursor:row.cursor_ciphertext?decryptSecret(row.cursor_ciphertext):null,
        });
        if(result.hadInbound){
          recovered++;
          await tx`UPDATE member_ilink_accounts SET
            cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
            context_ciphertext=${result.contextToken?encryptSecret(result.contextToken):null},
            channel_state='active',last_inbound_at=now(),updated_at=now()
            WHERE user_id=${row.user_id}`;
          // Only formerly blocked, recent messages are eligible; outbox expiry is enforced by dispatcher.
          await tx`UPDATE member_notification_outbox SET status='failed',next_attempt_at=now(),error_code=NULL
            WHERE user_id=${row.user_id} AND status='failed' AND error_code='needs_interaction'`;
        }else{
          await tx`UPDATE member_ilink_accounts SET cursor_ciphertext=${result.cursor?encryptSecret(result.cursor):null},
            updated_at=now() WHERE user_id=${row.user_id}`;
        }
      }catch(error){
        if(ilinkErrorKind(error)==="requires_rebind")
          await tx`UPDATE member_ilink_accounts SET channel_state='requires_rebind',updated_at=now() WHERE user_id=${row.user_id}`;
        // No raw API response or account credentials in logs.
      }
    });
  }
  return {checked,recovered};
}
