import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { GP_QUEUE } from "./queue.ts";
import { GP_TAGS, canReviewInvestment, normalizeAliases, validSectorTags } from "./core.ts";
import type { MemberSession } from "../server.ts";

type Auth = (req:FastifyRequest)=>Promise<MemberSession|null>;
const body=(req:FastifyRequest)=>req.body && typeof req.body==="object" ? req.body as Record<string,unknown> : {};
const safeOrigin=(req:FastifyRequest)=>{
  if(!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host===req.headers.host; } catch { return false; }
};

export function registerGpRoutes(app:FastifyInstance,authenticate:Auth) {
  app.get("/api/v1/membership/gp-projects",async(req,reply)=>{
    reply.header("Cache-Control","private, no-store").header("Vary","Cookie");
    const user=await authenticate(req);
    if(!user) return reply.code(401).send({error:"login_required"});
    const query=req.query as {limit?:unknown;offset?:unknown;matched?:unknown};
    const validInteger=(value:unknown)=>value===undefined || (typeof value==="string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
    if(!validInteger(query.limit)||!validInteger(query.offset)||!(query.matched===undefined||query.matched==="0"||query.matched==="1"))
      return reply.code(400).send({error:"invalid_query"});
    const matched=query.matched==="1";
    const requestedLimit=Number(query.limit??50),requestedOffset=Number(query.offset??0);
    const limit=Math.min(100,Math.max(1,requestedLimit));
    const offset=Math.min(100_000,Math.max(0,requestedOffset));
    const interests=matched?await sql<{tag:string}[]>`SELECT tag FROM member_interest_tags WHERE user_id=${user.id} ORDER BY tag`:[];
    const interestTags=interests.map(row=>row.tag);
    const rows=await sql`SELECT i.id,g.canonical_name AS gp_name,i.investee_name,i.sector_tags,
      i.approved_event_date::text AS event_date,'verified'::text AS status,i.approved_source_url AS source_url
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      WHERE i.status='verified' AND g.status='active' AND g.entity_role='gp'
        AND (NOT ${matched} OR (
          EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id}
            AND t.tag=ANY(i.sector_tags) AND t.tag<>'战略配售')
        ))
      ORDER BY i.approved_event_date DESC NULLS LAST,i.approved_at DESC NULLS LAST,i.id
      LIMIT ${limit+1} OFFSET ${offset}`;
    const hasMore=rows.length>limit;
    return {investments:rows.slice(0,limit),pagination:{limit,offset,nextOffset:hasMore?offset+limit:null},...(matched?{interest_tags:interestTags}: {})};
  });

  async function admin(req:FastifyRequest,reply:FastifyReply) {
    reply.header("Cache-Control","private, no-store").header("Vary","Cookie");
    const user=await authenticate(req);
    if(!user || user.role!=="admin"){reply.code(403).send({error:"admin_required"});return null;}
    if(req.method!=="GET"&&!safeOrigin(req)){reply.code(403).send({error:"invalid_origin"});return null;}
    return user;
  }
  app.get("/api/v1/membership/admin/gps",async(req,reply)=>{
    if(!await admin(req,reply)) return;
    const gps=await sql`SELECT id,canonical_name,aliases,entity_id,credit_code,entity_role,status,source_ref,reviewed_at,last_synced_at,last_error FROM member_gp_watchlist ORDER BY created_at,id`;
    return {gps};
  });
  app.post("/api/v1/membership/admin/gps",async(req,reply)=>{
    if(!await admin(req,reply)) return;
    const input=body(req);
    const name=typeof input.name==="string" ? input.name.trim() : "";
    const source=typeof input.sourceRef==="string" ? input.sourceRef.trim() : "";
    const aliases=normalizeAliases(input.aliases ?? []);
    if(name.length<3||name.length>180||source.length<8||source.length>1000) return reply.code(400).send({error:"invalid_gp_candidate"});
    if(!aliases) return reply.code(400).send({error:"invalid_aliases"});
    const inserted=await sql`INSERT INTO member_gp_watchlist(id,canonical_name,aliases,source_ref) VALUES(${randomUUID()},${name},${aliases},${source}) ON CONFLICT(canonical_name) DO NOTHING RETURNING id`;
    return inserted.length ? {id:inserted[0].id} : reply.code(409).send({error:"duplicate_gp"});
  });
  app.patch("/api/v1/membership/admin/gps/:id",async(req,reply)=>{
    const user=await admin(req,reply);if(!user) return;
    const input=body(req);
    const status=input.status,role=input.role;
    const entityId=typeof input.entityId==="string"?input.entityId.trim():"";
    const creditCode=typeof input.creditCode==="string"?input.creditCode.trim():"";
    const source=typeof input.sourceRef==="string"?input.sourceRef.trim():"";
    const aliases=normalizeAliases(input.aliases);
    if(!aliases) return reply.code(400).send({error:"invalid_aliases"});
    if(!["candidate","active","paused"].includes(String(status))||!["manager","gp","fund"].includes(String(role))||
       entityId.length>128||creditCode.length>32||source.length<8||source.length>1000||
       (status==="active"&&(role!=="gp"||!entityId)))
      return reply.code(400).send({error:"gp_identity_verification_required"});
    const id=(req.params as {id:string}).id;
    const changed=await sql`UPDATE member_gp_watchlist SET status=${status as string},entity_role=${role as string},entity_id=${entityId||null},credit_code=${creditCode||null},aliases=${aliases},
      source_ref=${source},reviewed_by=${user.id},reviewed_at=now() WHERE id=${id}
      AND (NOT EXISTS(SELECT 1 FROM member_gp_snapshots WHERE gp_id=${id})
           OR (entity_id IS NOT DISTINCT FROM ${entityId||null} AND entity_role=${role as string}))
      RETURNING id`;
    if(changed.length) return {ok:true};
    const [existing]=await sql`SELECT id FROM member_gp_watchlist WHERE id=${id}`;
    return reply.code(existing?409:404).send({error:existing?"gp_identity_locked_after_baseline":"not_found"});
  });
  app.post("/api/v1/membership/admin/gps/:id/sync",async(req,reply)=>{
    if(!await admin(req,reply)) return;
    if(process.env.P3_GP_SYNC_ENABLED!=="true") return reply.code(409).send({error:"provider_sync_disabled"});
    const id=(req.params as {id:string}).id;
    const rows=await sql`SELECT id FROM member_gp_watchlist WHERE id=${id} AND status='active' AND entity_role='gp'`;
    if(!rows.length) return reply.code(409).send({error:"gp_not_active"});
    await enqueueOn(GP_QUEUE,{gpId:id},{singletonKey:id});
    return reply.code(202).send({queued:true});
  });
  app.get("/api/v1/membership/admin/gp-observations",async(req,reply)=>{
    if(!await admin(req,reply)) return;
    const observations=await sql`SELECT i.id,i.gp_id,g.canonical_name AS gp_name,i.investee_name,i.first_seen_at,i.investment_date,i.provider_updated_at,i.data_date,s.captured_at AS snapshot_captured_at,
      i.status,i.sector_tags,i.sector_reason,i.classification_state,i.approved_event_date,i.approved_source_url
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      LEFT JOIN member_gp_snapshots s ON s.id=i.source_snapshot_id ORDER BY i.first_seen_at DESC LIMIT 300`;
    return {observations,allowedTags:GP_TAGS};
  });
  app.patch("/api/v1/membership/admin/gp-observations/:id",async(req,reply)=>{
    const user=await admin(req,reply);if(!user) return;
    const input=body(req);
    const tags=validSectorTags(input.tags);
    const status=input.status;
    const date=typeof input.eventDate==="string"?input.eventDate:"";
    const source=typeof input.sourceUrl==="string"?input.sourceUrl.trim():"";
    const reason=typeof input.reason==="string"?input.reason.slice(0,1000):"";
    if(!tags||!["baseline","observed","verified","retracted"].includes(String(status))) return reply.code(400).send({error:"invalid_review"});
    // A new-investment assertion requires separately checked evidence; snapshots alone never qualify.
    if(status==="verified"&&(!tags.length||!/^20\d\d-\d\d-\d\d$/.test(date)||!/^https:\/\//.test(source)))
       return reply.code(400).send({error:"event_evidence_required"});
    const id=(req.params as {id:string}).id;
    const outcome=await sql.begin(async tx=>{
      const [old]=await tx<{
        status:string; sector_tags:string[]; sector_reason:string|null;
        approved_event_date:string|null; approved_source_url:string|null; approved_by:string|null;
        approved_at:Date|null; revision:number; source_snapshot_id:string|null;
      }[]>`SELECT status,sector_tags,sector_reason,approved_event_date::text,approved_source_url,approved_by,
        approved_at,revision,source_snapshot_id FROM member_gp_investments WHERE id=${id} FOR UPDATE`;
      if(!old) return "not_found";
      if(!canReviewInvestment(old.status,String(status))) return "invalid_transition";
      const firstApproval=old.status==="observed" && status==="verified";
      const approvedAt=firstApproval ? new Date() : old.approved_at;
      const approvedBy=firstApproval ? user.id : old.approved_by;
      const eventDate=status==="verified" ? date : null;
      const evidenceUrl=status==="verified" ? source : null;
      const [updated]=await tx`UPDATE member_gp_investments SET status=${status as string},
        sector_tags=${tags},sector_reason=${reason},classification_state='reviewed',
        approved_event_date=${eventDate}::date,approved_source_url=${evidenceUrl},
        approved_by=${approvedBy},approved_at=${approvedAt},revision=revision+1
        WHERE id=${id} RETURNING id,revision`;
      const before={...old};
      const after={...old,status,sector_tags:tags,sector_reason:reason,approved_event_date:eventDate,
        approved_source_url:evidenceUrl,approved_by:approvedBy,approved_at:approvedAt,revision:updated.revision};
      await tx`INSERT INTO member_gp_review_audit(investment_id,actor_id,tags,reason,before_state,after_state)
        VALUES(${id},${user.id},${tags},${reason},${tx.json(before as never)},${tx.json(after as never)})`;
      return "ok";
    });
    return outcome==="ok"?{ok:true}:reply.code(outcome==="not_found"?404:409).send({error:outcome});
  });
}
