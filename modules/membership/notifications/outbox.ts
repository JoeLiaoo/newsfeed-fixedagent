import { createHash, randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { dueNotificationKinds, offDay } from "../gp/core.ts";
import { getDailyDigest, type DigestItem } from "./digest.ts";

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const flags=(name:string)=>new Set((process.env[name]??"").split(",").map(x=>x.trim()).filter(Boolean));
type User={ id:string; news_enabled:boolean;gp_enabled:boolean;binding_version:number;news_version:number;gp_version:number;bound_at:Date;gp_since:Date|null };
type Binding={ recipient_id:string;channel_account_id:string };
export type OutboxRow={id:string;user_id:string;kind:"news"|"gp";payload:string;attempts:number;binding_version:number;subscription_version:number;local_date:string;part_index:number;sources_tracked:boolean};
export type Candidate={key:string;seenKey:string;text:string};
type SourceSegment={key:string;start:number;end:number};
type MessagePart={payload:string;sources:SourceSegment[]};
type RenderCandidate=Pick<Candidate,"key"|"text">;
const MAX_NOTIFICATION_LENGTH=1600;

function dateInfo(now=new Date()) {
  const day=beijingDate(now);
  const hour=Number(beijingTime(now).slice(0,2));
  return {day,hour};
}

export function splitNotificationParts(headline:string,candidates:readonly RenderCandidate[],emptyText="今日无更新",limit=MAX_NOTIFICATION_LENGTH):MessagePart[]{
  if(headline.length>limit) throw new Error("notification_headline_exceeds_limit");
  if(!candidates.length){
    const payload=[headline,emptyText].join("\n");
    if(payload.length>limit) throw new Error("notification_empty_message_exceeds_limit");
    return [{payload,sources:[]}];
  }
  const parts:MessagePart[]=[];
  let lines=[headline],sources:SourceSegment[]=[];
  let currentLength=headline.length;
  const flush=()=>{
    if(!sources.length) return;
    const payload=lines.join("\n");
    if(payload.length>limit) throw new Error("notification_message_exceeds_limit");
    parts.push({payload,sources});
    lines=[headline];sources=[];currentLength=headline.length;
  };
  for(const candidate of candidates){
    let offset=0;
    while(offset<candidate.text.length){
      let available=limit-currentLength-1;
      if(available<=0){flush();available=limit-currentLength-1;}
      let end=Math.min(candidate.text.length,offset+available);
      // Keep Unicode surrogate pairs intact when a page boundary falls inside an emoji.
      if(end<candidate.text.length&&end>offset){
        const previous=candidate.text.charCodeAt(end-1),next=candidate.text.charCodeAt(end);
        if(previous>=0xd800&&previous<=0xdbff&&next>=0xdc00&&next<=0xdfff) end--;
      }
      if(end<=offset) throw new Error("notification_source_cannot_fit_limit");
      const chunk=candidate.text.slice(offset,end);
      lines.push(chunk);sources.push({key:candidate.key,start:offset,end});
      currentLength+=chunk.length+1;
      offset=end;
      if(offset<candidate.text.length) flush();
    }
  }
  flush();
  return parts;
}

// Each edition records a source cutoff before reading any rows. Items are deduplicated by
// stable fact/relationship keys within the same transaction that creates the outbox.
export async function generateDueNotifications(now=new Date()) {
  if(process.env.P3_NOTIFICATIONS_ENABLED!=="true") return {disabled:true};
  const {day,hour}=dateInfo(now);
  const holiday=offDay(day,[...flags("P3_CN_HOLIDAYS")],[...flags("P3_CN_MAKEUP_WORKDAYS")]);
  const types=dueNotificationKinds(hour,holiday);
  if(!types.length) return {due:false};
  const cutoff=now;
  const users=await sql<User[]>`SELECT u.id,COALESCE(s.news_enabled,true) AS news_enabled,COALESCE(s.gp_enabled,true) AS gp_enabled,
    COALESCE(s.binding_version,1) AS binding_version,COALESCE(s.news_version,1) AS news_version,COALESCE(s.gp_version,1) AS gp_version,b.bound_at,s.gp_since
    FROM member_users u JOIN member_weixin_bindings b ON b.user_id=u.id AND b.status='active'
    LEFT JOIN member_notification_settings s ON s.user_id=u.id
    WHERE u.status='active' AND (s.paused_until IS NULL OR s.paused_until<=now())
    ORDER BY u.id LIMIT 500`;
  let created=0;
  for(const kind of types){
    for(const user of users){
      if(kind==="news"&&!user.news_enabled || kind==="gp"&&!user.gp_enabled) continue;
      let editionCutoff=cutoff;
      let digestPreferenceVersion:number|null=null;
      const subscriptionVersion=kind==="news"?user.news_version:user.gp_version;
      let candidates:Candidate[]=[];
      if(kind==="gp"){
        const [cursor]=await sql<{last_at:Date|null}[]>`SELECT max(window_end_at) AS last_at FROM member_notification_outbox
          WHERE user_id=${user.id} AND kind='gp' AND binding_version=${user.binding_version} AND subscription_version=${subscriptionVersion}`;
        const minimum=new Date(Math.max(user.bound_at.getTime(),user.gp_since?.getTime()??0));
        const since=new Date(Math.max(minimum.getTime(),cursor?.last_at?.getTime()??0));
        // Reread a bounded overlap to cover late commits and delayed publication.
        const overlap=new Date(Math.max(minimum.getTime(),since.getTime()-48*60*60*1000));
        const observations=await sql<{id:string;gp_name:string;investee_name:string;approved_event_date:string;approved_source_url:string;sector_tags:string[]}[]>`SELECT i.id,g.canonical_name AS gp_name,i.investee_name,i.approved_event_date::text,i.approved_source_url,i.sector_tags
          FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
          WHERE i.status='verified' AND g.status='active' AND i.approved_at>=${overlap} AND i.approved_at<${cutoff}
            AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id} AND t.tag=ANY(i.sector_tags))
          ORDER BY i.approved_at,i.id`;
        for(const o of observations) candidates.push({
          key:o.id,seenKey:"gp:"+o.id,text:"• "+o.gp_name+" → "+o.investee_name+"（"+o.approved_event_date+"）\n"+
            o.sector_tags.join("、")+"\n"+o.approved_source_url,
        });
      }else{
        const digest=await getDailyDigest(user.id,day,now);
        if(!digest) continue;
        editionCutoff=digest.cutoff_at;
        digestPreferenceVersion=digest.preference_version;
        for(const item of digest.items as DigestItem[]) candidates.push({
          key:item.source_key,seenKey:item.source_key,text:"• "+item.title+"\n"+(item.summary??"暂无摘要")+"\n"+item.url,
        });
      }
      const headline=(kind==="news"?"个人资讯日报":"GP 新增投资关系")+" "+day;
      // User lock protects both edition creation and per-source reservations from overlapping runs.
      const count=await sql.begin(async tx=>{
        await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
        const existing=await tx`SELECT id FROM member_notification_outbox
          WHERE user_id=${user.id} AND kind=${kind} AND local_date=${day}::date AND binding_version=${user.binding_version} AND subscription_version=${subscriptionVersion} LIMIT 1`;
        if(existing.length) return 0;
        const seenRows=candidates.length?await tx<{source_key:string}[]>`SELECT source_key FROM member_notification_seen
          WHERE user_id=${user.id} AND kind=${kind} AND source_key=ANY(${tx.array(candidates.map(item=>item.seenKey))}::text[])`:[];
        const seenSet=new Set(seenRows.map(row=>row.source_key));
        const available=candidates.filter(item=>!seenSet.has(item.seenKey));
        const currentParts=splitNotificationParts(headline,available);
        for(let index=0;index<currentParts.length;index++){
          const part=currentParts[index]!;
          const id=randomUUID();
          await tx`INSERT INTO member_notification_outbox(id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at,digest_preference_version,sources_tracked)
            VALUES(${id},${user.id},${kind},${day}::date,${user.binding_version},${subscriptionVersion},${index},${part.payload},${sha256(part.payload)},${editionCutoff},${digestPreferenceVersion},true)`;
          for(const [segmentIndex,source] of part.sources.entries()){
            await tx`INSERT INTO member_notification_outbox_sources(outbox_id,segment_index,source_key,source_start,source_end)
              VALUES(${id},${segmentIndex},${source.key},${source.start},${source.end}) ON CONFLICT DO NOTHING`;
            const item=candidates.find(candidate=>candidate.key===source.key);
            if(item) await tx`INSERT INTO member_notification_seen(user_id,kind,source_key,outbox_id)
              VALUES(${user.id},${kind},${item.seenKey},${id}) ON CONFLICT DO NOTHING`;
          }
        }
        return currentParts.length;
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
  // The Hermes gateway runs on the Docker host. host.docker.internal is supplied
  // only to the worker by Compose; the bridge separately checks its bearer token.
  if(!((url.protocol==="https:"&&url.username===""&&url.password==="")||
    (url.protocol==="http:"&&["127.0.0.1","localhost","::1","host.docker.internal"].includes(url.hostname)))) throw new Error("invalid_hermes_bridge_url");
  return {url,token};
}

async function currentSource(key:string,kind:"news"|"gp",userId:string,at:Date):Promise<string|null>{
  if(kind==="news"){
    const [item]=await sql<{title:string;summary:string|null;url:string}[]>`SELECT p.title,p.summary,p.url FROM publications p
      WHERE COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id)=${key}
        AND ${listedCondition(at)}
        AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${userId} AND t.tag=ANY(p.tags))
      ORDER BY p.timeline_at DESC LIMIT 1`;
    return item?"• "+item.title+"\n"+(item.summary??"暂无摘要")+"\n"+item.url:null;
  }
  const [item]=await sql<{gp_name:string;investee_name:string;approved_event_date:string;approved_source_url:string;sector_tags:string[]}[]>`SELECT g.canonical_name AS gp_name,i.investee_name,i.approved_event_date::text,i.approved_source_url,i.sector_tags
    FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
    WHERE i.id=${key} AND i.status='verified' AND g.status='active' AND g.entity_role='gp'
      AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${userId} AND t.tag=ANY(i.sector_tags))`;
  return item?"• "+item.gp_name+" → "+item.investee_name+"（"+item.approved_event_date+"）\n"+item.sector_tags.join("、")+"\n"+item.approved_source_url:null;
}

async function cancelAndRelease(id:string,errorCode:string,db?:Db):Promise<void>{
  if(!db){await sql.begin(async tx=>cancelAndRelease(id,errorCode,tx));return;}
  const cancelled=await db<{id:string}[]>`UPDATE member_notification_outbox SET status='cancelled',lease_expires_at=NULL,error_code=${errorCode}
    WHERE id=${id} AND status IN('pending','failed','sending') RETURNING id`;
  if(cancelled.length) await db`DELETE FROM member_notification_seen WHERE outbox_id=${id}`;
}

export async function revalidatePayload(job:OutboxRow):Promise<string|null>{
  if(!job.sources_tracked){await cancelAndRelease(job.id,"legacy_source_untracked");return null;}
  const sources=await sql<{segment_index:number;source_key:string;source_start:number;source_end:number}[]>`SELECT segment_index,source_key,source_start,source_end
    FROM member_notification_outbox_sources WHERE outbox_id=${job.id} ORDER BY segment_index`;
  if(!sources.length) return job.payload;
  const checkedAt=new Date();
  const lines=[(job.kind==="news"?"个人资讯日报":"GP 新增投资关系")+" "+job.local_date];
  const invalid:number[]=[];
  const invalidKeys=new Set<string>();
  for(const source of sources){
    const text=await currentSource(source.source_key,job.kind,job.user_id,checkedAt);
    const segment=text?.slice(source.source_start,source.source_end)??"";
    if(segment) lines.push(segment);
    else {invalid.push(source.segment_index);invalidKeys.add(source.source_key);}
  }
  if(lines.length===1){await cancelAndRelease(job.id,"source_no_longer_visible");return null;}
  const payload=lines.join("\n");
  if(payload.length>MAX_NOTIFICATION_LENGTH) throw new Error("notification_message_exceeds_limit");
  const refreshed=await sql.begin(async tx=>{
    if(invalid.length){
      await tx`DELETE FROM member_notification_outbox_sources WHERE outbox_id=${job.id} AND segment_index=ANY(${tx.array(invalid)}::int[])`;
      for(const key of invalidKeys){
        const linked=await tx`SELECT 1 FROM member_notification_outbox_sources WHERE outbox_id=${job.id} AND source_key=${key} LIMIT 1`;
        if(!linked.length){
          const seenKey=job.kind==="news"?key:"gp:"+key;
          await tx`DELETE FROM member_notification_seen WHERE outbox_id=${job.id} AND source_key=${seenKey}`;
        }
      }
    }
    const updated=await tx`UPDATE member_notification_outbox SET payload=${payload},payload_sha256=${sha256(payload)} WHERE id=${job.id} AND status='sending' RETURNING id`;
    return updated.length>0;
  });
  if(!refreshed) return null;
  return payload;
}

type DispatchOptions={revalidate?:(job:OutboxRow)=>Promise<string|null>;post?:typeof fetch};
export async function dispatchOutbox({revalidate=revalidatePayload,post=fetch}:DispatchOptions={}) {
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
        WHERE id=${id} RETURNING id,user_id,kind,payload,attempts,binding_version,subscription_version,local_date::text AS local_date,part_index,sources_tracked`;
      if(row) claimed.push(row);
    }
    return claimed;
  });
  let accepted=0;
  for(const job of jobs){
    const payload=await revalidate(job);
    if(!payload) continue;
    const delivered=await sql.begin(async tx=>{
      // Mutating notification settings and bindings takes this same lock. Holding it through the
      // bridge request gives the final authorization check and delivery a single ordering point.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${job.user_id}))`;
      const [recipient]=await tx<(Binding & {binding_version:number;subscription_version:number;enabled:boolean;outbox_status:string;outbox_binding_version:number;outbox_subscription_version:number})[]>`SELECT b.recipient_id,b.channel_account_id,
        COALESCE(s.binding_version,1) AS binding_version,
        CASE WHEN ${job.kind}='news' THEN COALESCE(s.news_version,1) ELSE COALESCE(s.gp_version,1) END AS subscription_version,
        COALESCE(u.status='active' AND b.status='active' AND (s.paused_until IS NULL OR s.paused_until<=now())
          AND CASE WHEN ${job.kind}='news' THEN COALESCE(s.news_enabled,true) ELSE COALESCE(s.gp_enabled,true) END,false) AS enabled,
        o.status AS outbox_status,o.binding_version AS outbox_binding_version,o.subscription_version AS outbox_subscription_version
        FROM member_notification_outbox o JOIN member_users u ON u.id=o.user_id
        LEFT JOIN member_weixin_bindings b ON b.user_id=u.id LEFT JOIN member_notification_settings s ON s.user_id=u.id
        WHERE o.id=${job.id} FOR UPDATE OF o`;
      if(!recipient||recipient.outbox_status!=="sending"||!recipient.enabled||
        recipient.binding_version!==job.binding_version||recipient.subscription_version!==job.subscription_version||
        recipient.outbox_binding_version!==job.binding_version||recipient.outbox_subscription_version!==job.subscription_version){
        await cancelAndRelease(job.id,"subscription_changed",tx);
        return false;
      }
      try{
        const response=await post(config.url,{
          method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
          headers:{"content-type":"application/json",authorization:"Bearer "+config.token,"x-idempotency-key":job.id},
          body:JSON.stringify({recipientId:recipient.recipient_id,channelAccountId:recipient.channel_account_id,text:payload,idempotencyKey:job.id}),
        });
        if(response.status===410){
          await tx`UPDATE member_weixin_bindings SET status='requires_rebind' WHERE user_id=${job.user_id}`;
          await tx`UPDATE member_notification_outbox SET status='requires_rebind',lease_expires_at=NULL,error_code='channel_expired' WHERE id=${job.id}`;
          await tx`DELETE FROM member_notification_seen WHERE outbox_id=${job.id}`;
        }else if(response.status===429){
          await tx`UPDATE member_notification_outbox SET status='failed',lease_expires_at=NULL,next_attempt_at=now()+interval '15 minutes',error_code='channel_rate_limited' WHERE id=${job.id}`;
        }else if(response.ok){
          const result=await response.json() as {accepted?:boolean;messageId?:string};
          if(result.accepted!==true) throw new Error("ambiguous_bridge_receipt");
          await tx`UPDATE member_notification_outbox SET status='accepted',lease_expires_at=NULL,accepted_at=now(),channel_message_id=${result.messageId??null},error_code=NULL WHERE id=${job.id}`;
          return true;
        }else {
          // A 5xx may happen after the channel accepted the message. Do not auto-retry.
          await tx`UPDATE member_notification_outbox SET status='unknown',lease_expires_at=NULL,error_code='ambiguous_bridge_failure' WHERE id=${job.id}`;
        }
      }catch{
        await tx`UPDATE member_notification_outbox SET status='unknown',lease_expires_at=NULL,error_code='channel_outcome_unknown' WHERE id=${job.id}`;
      }
      return false;
    });
    if(delivered) accepted++;
  }
  return {attempted:jobs.length,accepted};
}

export async function cleanupP3Data() {
  await sql`DELETE FROM member_bridge_nonces WHERE created_at<now()-interval '1 day'`;
  await sql`DELETE FROM member_weixin_challenges WHERE expires_at<now()-interval '1 day'`;
  return {p3BridgeNoncesPruned:true};
}
