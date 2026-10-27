import {sql,type Tx} from "@aihot/backend/db";

export function agentEnabled():boolean{
  return process.env.P3_ILINK_AGENT_ENABLED==="true"&&process.env.P3_DELIVERY_ENABLED==="true"&&process.env.MODEL_CALLS_ENABLED==="true";
}

export async function authorized(tx:Tx,userId:string,bindingVersion:number,grantId?:string):Promise<boolean>{
  if(!agentEnabled())return false;
  const [row]=await tx`SELECT 1 FROM member_agent_grants g
    JOIN member_users u ON u.id=g.user_id AND u.status='active'
    JOIN member_weixin_bindings b ON b.user_id=g.user_id AND b.status='active'
    JOIN member_ilink_accounts a ON a.user_id=g.user_id AND a.recipient_id=b.recipient_id
      AND a.channel_account_id=b.channel_account_id
    JOIN member_notification_settings s ON s.user_id=g.user_id AND s.binding_version=${bindingVersion}
    WHERE g.user_id=${userId} AND (${grantId??null}::uuid IS NULL OR g.grant_id=${grantId??null}::uuid)
    FOR SHARE OF g`;
  return !!row;
}
