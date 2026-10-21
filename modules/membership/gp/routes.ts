import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { GP_QUEUE } from "./queue.ts";
import { GP_TAGS, validSectorTags } from "./core.ts";
import type { MemberSession } from "../server.ts";

type Auth = (req:FastifyRequest)=>Promise<MemberSession|null>;
const body=(req:FastifyRequest)=>req.body && typeof req.body==="object" ? req.body as Record<string,unknown> : {};
const safeOrigin=(req:FastifyRequest)=>{
  if(!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host===req.headers.host; } catch { return false; }
};

export function registerGpRoutes(app:FastifyInstance,authenticate:Auth) {
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
    const aliases=Array.isArray(input.aliases)&&input.aliases.length<=20&&input.aliases.every(v=>typeof v==="string"&&v.length<=180) ? input.aliases as string[] : [];
    if(name.length<3||name.length>180||source.length<8||source.length>1000) return reply.code(400).send({error:"invalid_gp_candidate"});
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
    const aliases=Array.isArray(input.aliases)&&input.aliases.length<=20&&input.aliases.every(v=>typeof v==="string"&&v.length<=180)?[...new Set(input.aliases as string[])]:null;
    if(!aliases) return reply.code(400).send({error:"invalid_aliases"});
    if(!["candidate","active","paused"].includes(String(status))||!["manager","gp","fund"].includes(String(role))||
       entityId.length>128||creditCode.length>32||source.length<8||source.length>1000||
       (status==="active"&&(role!=="gp"||!entityId)))
      return reply.code(400).send({error:"gp_identity_verification_required"});
    const id=(req.params as {id:string}).id;
    const changed=await sql`UPDATE member_gp_watchlist SET status=${status as string},entity_role=${role as string},entity_id=${entityId||null},credit_code=${creditCode||null},aliases=${aliases},
      source_ref=${source},reviewed_by=${user.id},reviewed_at=now() WHERE id=${id} RETURNING id`;
    return changed.length?{ok:true}:reply.code(404).send({error:"not_found"});
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
    const observations=await sql`SELECT i.id,i.gp_id,g.canonical_name AS gp_name,i.investee_name,i.first_seen_at,i.investment_date,i.data_date,
      i.status,i.sector_tags,i.sector_reason,i.classification_state,i.approved_event_date,i.approved_source_url
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id ORDER BY i.first_seen_at DESC LIMIT 300`;
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
    const changed=await sql.begin(async tx=>{
      const changed=await tx`UPDATE member_gp_investments SET status=${status as string},sector_tags=${tags},sector_reason=${reason},
        classification_state='reviewed',approved_event_date=${status==="verified"?date:null}::date,
        approved_source_url=${status==="verified"?source:null},approved_by=${user.id},approved_at=now(),revision=revision+1
        WHERE id=${id} RETURNING id`;
      if(changed.length) await tx`INSERT INTO member_gp_review_audit(investment_id,actor_id,tags,reason) VALUES(${id},${user.id},${tags},${reason})`;
      return changed.length;
    });
    return changed?{ok:true}:reply.code(404).send({error:"not_found"});
  });
}
