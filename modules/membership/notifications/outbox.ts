import { createHash, randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { matchInterests, offDay, splitMessageLines } from "../gp/core.ts";

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const flags=(name:string)=>new Set((process.env[name]??"").split(",").map(x=>x.trim()).filter(Boolean));
type User={ id:string; news_enabled:boolean;gp_enabled:boolean;binding_version:number;bound_at:Date;news_since:Date|null;gp_since:Date|null };
type Binding={ recipient_id:string;channel_account_id:string };
type OutboxRow={id:string;user_id:string;kind:"news"|"gp";payload:string;attempts:number;binding_version:number};

function dateInfo() {
  const now=new Date();
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value??"";
  const day=get("year")+"-"+get("month")+"-"+get("day");
  const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",hour:"2-digit",hourCycle:"h23"}).format(now));
  return {day,hour};
}

export async function generateDueNotifications() {
  if(process.env.P3_NOTIFICATIONS_ENABLED!=="true") return {disabled:true};
  const {day,hour}=dateInfo();
  const holiday=offDay(day,[...flags("P3_CN_HOLIDAYS")],[...flags("P3_CN_MAKEUP_WORKDAYS")]);
  const types:("news"|"gp")[]=[];
  if(hour===(holiday?11:9)) types.push("news");
  if(hour===(holiday?12:10)) types.push("gp");
  if(!types.length) return {due:false};
  const users=await sql<User[]>`SELECT u.id,COALESCE(s.news_enabled,true) AS news_enabled,COALESCE(s.gp_enabled,true) AS gp_enabled,
    COALESCE(s.binding_version,1) AS binding_version,b.bound_at,s.news_since,s.gp_since
    FROM member_users u JOIN member_weixin_bindings b ON b.user_id=u.id AND b.status='active'
    LEFT JOIN member_notification_settings s ON s.user_id=u.id
    WHERE u.status='active' AND (s.paused_until IS NULL OR s.paused_until<=now())
    ORDER BY u.id LIMIT 500`;
  let created=0;
  for(const kind of types){
    for(const user of users){
      if(kind==="news"&&!user.news_enabled || kind==="gp"&&!user.gp_enabled) continue;
      // Latest outbox creation is the delivery window cursor, including empty-day messages.
      const [cursor]=await sql<{last_at:Date|null}[]>`SELECT max(created_at) AS last_at FROM member_notification_outbox
        WHERE user_id=${user.id} AND kind=${kind} AND binding_version=${user.binding_version}`;
      const start=kind==="news"?user.news_since:user.gp_since;
      const since=cursor?.last_at??(start&&start>user.bound_at?start:user.bound_at);
      let lines:string[]=[];
      if(kind==="gp"){
        const observations=await sql<{id:string;gp_name:string;investee_name:string;approved_event_date:string;approved_source_url:string;sector_tags:string[]}[]>`SELECT i.id,g.canonical_name AS gp_name,i.investee_name,i.approved_event_date::text,i.approved_source_url,i.sector_tags
          FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
          WHERE i.status='verified' AND g.status='active' AND i.approved_at>${since} AND i.approved_at<=now()
            AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id} AND t.tag=ANY(i.sector_tags))
          ORDER BY i.approved_at,i.id`;
        lines=observations.map(o=>"• "+o.gp_name+" → "+o.investee_name+"（"+o.approved_event_date+"）\n"+o.sector_tags.join("、")+"\n"+o.approved_source_url);
      }else{
        const cutoff=new Date();
        const items=await sql<{title:string;summary:string|null;url:string}[]>`SELECT DISTINCT ON (COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id))
          p.title,p.summary,p.url FROM publications p
          WHERE ${listedCondition(cutoff)} AND p.timeline_at>=${since} AND p.timeline_at<${cutoff}
            AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id} AND t.tag=ANY(p.tags))
          ORDER BY COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id),p.timeline_at DESC`;
        lines=items.map(item=>"• "+item.title+"\n"+(item.summary??"暂无摘要")+"\n"+item.url);
      }
      const headline=kind==="news"?"个人资讯日报":"GP 新增投资动向";
      const parts=splitMessageLines(lines.length?[headline+" "+day,...lines]:[headline+" "+day,"\n今日无更新"]);
      // Generate all chunks atomically so retries never create a partial edition.
      const count=await sql.begin(async tx=>{
        const ids=[];
        for(let index=0;index<parts.length;index++){
          const content=parts[index]!;
          const inserted=await tx`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,part_index,payload,payload_sha256)
            VALUES(${randomUUID()},${user.id},${kind},${day}::date,${user.binding_version},${index},${content},${sha256(content)})
            ON CONFLICT (user_id,kind,local_date,binding_version,part_index) DO NOTHING RETURNING id`;
          if(inserted.length) ids.push(inserted[0]!.id);
        }
        return ids.length;
      });
      created+=count;
    }
  }
  return {created,types,holiday};
}

function bridgeConfig() {
  const token=process.env.P3_HERMES_BRIDGE_TOKEN;
  const raw=process.env.P3_HERMES_BRIDGE_URL;
  if(!raw||!token) return null;
  const url=new URL(raw);
  // Allow a TLS bridge or a loopback sidecar only. Never accept URLs from request payloads.
  if(!((url.protocol==="https:"&&url.username===""&&url.password==="")||
    (url.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(url.hostname)))) throw new Error("invalid_hermes_bridge_url");
  return {url,token};
}

export async function dispatchOutbox() {
  if(process.env.P3_DELIVERY_ENABLED!=="true") return {disabled:true};
  const config=bridgeConfig();
  if(!config) return {disabled:true,reason:"bridge_not_configured"};
  // Old unsent digests must not suddenly flood a recovered channel.
  await sql`UPDATE member_notification_outbox SET status='cancelled',error_code='stale_outbox' WHERE status IN ('pending','failed') AND created_at<now()-interval '2 days'`;
  // A crashed 'sending' row is ambiguous. Never blindly replay it.
  await sql`UPDATE member_notification_outbox SET status='unknown',error_code='send_lease_expired',lease_expires_at=NULL
    WHERE status='sending' AND lease_expires_at<now()`;
  const jobs=await sql.begin(async tx=>{
    const ids=await tx<{id:string}[]>`SELECT id FROM member_notification_outbox
      WHERE status IN ('pending','failed') AND next_attempt_at<=now() AND attempts<3
      ORDER BY created_at,part_index FOR UPDATE SKIP LOCKED LIMIT 10`;
    if(!ids.length) return [];
    const claimed:OutboxRow[]=[];
    for(const {id} of ids){
      const [row]=await tx<OutboxRow[]>`UPDATE member_notification_outbox SET status='sending',attempts=attempts+1,lease_expires_at=now()+interval '2 minutes'
        WHERE id=${id} RETURNING id,user_id,kind,payload,attempts,binding_version`;
      if(row) claimed.push(row);
    }
    return claimed;
  });
  let accepted=0;
  for(const job of jobs){
    const [recipient]=await sql<(Binding & {binding_version:number;enabled:boolean})[]>`SELECT b.recipient_id,b.channel_account_id,
      COALESCE(s.binding_version,1) AS binding_version,
      (u.status='active' AND b.status='active' AND (s.paused_until IS NULL OR s.paused_until<=now())
       AND CASE WHEN ${job.kind}='news' THEN COALESCE(s.news_enabled,true) ELSE COALESCE(s.gp_enabled,true) END) AS enabled
      FROM member_weixin_bindings b JOIN member_users u ON u.id=b.user_id
      LEFT JOIN member_notification_settings s ON s.user_id=b.user_id WHERE b.user_id=${job.user_id}`;
    if(!recipient||!recipient.enabled||recipient.binding_version!==job.binding_version){
      await sql`UPDATE member_notification_outbox SET status='cancelled',lease_expires_at=NULL,error_code='subscription_changed' WHERE id=${job.id}`;
      continue;
    }
    try{
      const response=await fetch(config.url,{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
        headers:{"content-type":"application/json",authorization:"Bearer "+config.token,"x-idempotency-key":job.id},
        body:JSON.stringify({recipientId:recipient.recipient_id,channelAccountId:recipient.channel_account_id,text:job.payload,idempotencyKey:job.id}),
      });
      if(response.status===410){
        await sql.begin(async tx=>{
          await tx`UPDATE member_weixin_bindings SET status='requires_rebind' WHERE user_id=${job.user_id}`;
          await tx`UPDATE member_notification_outbox SET status='requires_rebind',lease_expires_at=NULL,error_code='channel_expired' WHERE id=${job.id}`;
        });
      }else if(response.status===429){
        await sql`UPDATE member_notification_outbox SET status='failed',lease_expires_at=NULL,next_attempt_at=now()+interval '15 minutes',error_code='channel_rate_limited' WHERE id=${job.id}`;
      }else if(response.ok){
        const result=await response.json() as {accepted?:boolean;messageId?:string};
        if(result.accepted!==true) throw new Error("ambiguous_bridge_receipt");
        await sql`UPDATE member_notification_outbox SET status='accepted',lease_expires_at=NULL,accepted_at=now(),channel_message_id=${result.messageId??null},error_code=NULL WHERE id=${job.id}`;
        accepted++;
      }else {
        // A 5xx may happen after the channel accepted the message. Do not auto-retry.
        await sql`UPDATE member_notification_outbox SET status='unknown',lease_expires_at=NULL,error_code='ambiguous_bridge_failure' WHERE id=${job.id}`;
      }
    }catch{
      await sql`UPDATE member_notification_outbox SET status='unknown',lease_expires_at=NULL,error_code='channel_outcome_unknown' WHERE id=${job.id}`;
    }
  }
  return {attempted:jobs.length,accepted};
}

export async function cleanupP3Data() {
  await sql`DELETE FROM member_bridge_nonces WHERE created_at<now()-interval '1 day'`;
  await sql`DELETE FROM member_weixin_challenges WHERE expires_at<now()-interval '1 day'`;
  return {p3BridgeNoncesPruned:true};
}
