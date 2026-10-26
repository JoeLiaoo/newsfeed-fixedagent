import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { GP_QUEUE } from "./queue.ts";
import { GP_TAGS, canReviewInvestment, normalizeAliases, validSectorTags } from "./core.ts";
import type { MemberSession } from "../server.ts";
import { employeeSource } from "./source.ts";
import { withXinhua } from "../experts/xinhua.ts";
import { querySelectedCompanyProfile } from "../experts/data.ts";
import { provinceFromAddress } from "./province.ts";

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
    const query=req.query as {limit?:unknown;offset?:unknown;matched?:unknown;group?:unknown;motherFund?:unknown;subfund?:unknown;sector?:unknown;province?:unknown};
    const validInteger=(value:unknown)=>value===undefined || (typeof value==="string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
    if(!validInteger(query.limit)||!validInteger(query.offset)||!(query.matched===undefined||query.matched==="0"||query.matched==="1")||!validProjectGroup(query.group)||
       !validFilterValue(query.motherFund)||!validFilterValue(query.subfund)||!validFilterValue(query.sector)||!validFilterValue(query.province))
      return reply.code(400).send({error:"invalid_query"});
    const matched=query.matched==="1";
    const requestedLimit=Number(query.limit??50),requestedOffset=Number(query.offset??0);
    const limit=Math.min(100,Math.max(1,requestedLimit));
    const offset=Math.min(100_000,Math.max(0,requestedOffset));
    const motherFund=typeof query.motherFund==="string"?query.motherFund:null;
    const subfund=typeof query.subfund==="string"?query.subfund:null;
    const sector=typeof query.sector==="string"?query.sector:null;
    const province=typeof query.province==="string"?query.province:null;
    const interests=matched?await sql<{tag:string}[]>`SELECT tag FROM member_interest_tags WHERE user_id=${user.id} ORDER BY tag`:[];
    const interestTags=interests.map(row=>row.tag);
    const [filterOptions]=await sql<{mother_funds:string[];subfunds:string[];sectors:string[];provinces:string[];unknown_mother:boolean;unknown_subfund:boolean;unknown_province:boolean}[]>`SELECT
      COALESCE(array_agg(DISTINCT i.mother_fund_name) FILTER(WHERE i.mother_fund_name IS NOT NULL),'{}') AS mother_funds,
      COALESCE(array_agg(DISTINCT i.subfund_name) FILTER(WHERE i.subfund_name IS NOT NULL),'{}') AS subfunds,
      COALESCE(array_agg(DISTINCT tag) FILTER(WHERE tag IS NOT NULL),'{}') AS sectors,
      COALESCE(array_agg(DISTINCT i.project_province) FILTER(WHERE i.project_province IS NOT NULL),'{}') AS provinces,
      COALESCE(bool_or(i.mother_fund_name IS NULL),false) AS unknown_mother,
      COALESCE(bool_or(i.subfund_name IS NULL),false) AS unknown_subfund,
      COALESCE(bool_or(i.project_province IS NULL),false) AS unknown_province
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      LEFT JOIN LATERAL unnest(i.sector_tags) AS sector(tag) ON true
      WHERE i.status='verified' AND g.status='active' AND g.entity_role='gp'
        AND (${query.group??null}::text IS NULL OR ${query.group??null}::text=ANY(g.project_groups))
        AND (NOT ${matched} OR EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id} AND t.tag=ANY(i.sector_tags) AND t.tag<>'战略配售'))`;
    const rows=await sql<{id:string;gp_name:string;investee_name:string;sector_tags:string[];event_date:string|null;status:string;source_url:string|null;mother_fund_name:string|null;subfund_name:string|null;project_province:string|null;province_checked_at:Date|null}[]>`SELECT i.id,g.canonical_name AS gp_name,i.investee_name,i.sector_tags,
      i.mother_fund_name,i.subfund_name,i.project_province,i.province_checked_at,
      i.approved_event_date::text AS event_date,'verified'::text AS status,i.approved_source_url AS source_url
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      WHERE i.status='verified' AND g.status='active' AND g.entity_role='gp'
        AND (${query.group??null}::text IS NULL OR ${query.group??null}::text=ANY(g.project_groups))
        AND (NOT ${matched} OR (
          EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${user.id}
            AND t.tag=ANY(i.sector_tags) AND t.tag<>'战略配售')
        ))
        AND (${motherFund}::text IS NULL OR (${motherFund}::text='未知' AND i.mother_fund_name IS NULL) OR i.mother_fund_name=${motherFund})
        AND (${subfund}::text IS NULL OR (${subfund}::text='未知' AND i.subfund_name IS NULL) OR i.subfund_name=${subfund})
        AND (${sector}::text IS NULL OR ${sector}=ANY(i.sector_tags))
        AND (${province}::text IS NULL OR (${province}::text='未知' AND i.project_province IS NULL) OR i.project_province=${province})
      ORDER BY i.approved_event_date DESC NULLS LAST,i.approved_at DESC NULLS LAST,i.id
      LIMIT ${limit+1} OFFSET ${offset}`;
    const hasMore=rows.length>limit;
    return {investments:rows.slice(0,limit).map(row => {
      const source = employeeSource(row.source_url);
      return { ...row, project_province: row.project_province ?? "未知", province_verified: row.province_checked_at !== null,
        source_url: source.url, source_placeholder: source.placeholder };
    }),pagination:{limit,offset,nextOffset:hasMore?offset+limit:null},
      filter_options:{mother_funds:[...filterOptions!.mother_funds,...(filterOptions!.unknown_mother?["未知"]:[])].sort(),
        subfunds:[...filterOptions!.subfunds,...(filterOptions!.unknown_subfund?["未知"]:[])].sort(),sectors:filterOptions!.sectors.sort(),
        provinces:[...filterOptions!.provinces,...(filterOptions!.unknown_province?["未知"]:[])].sort()},
      ...(matched?{interest_tags:interestTags}: {})};
  });

  app.get("/api/v1/membership/gp-projects/:id",async(req,reply)=>{
    reply.header("Cache-Control","private, no-store").header("Vary","Cookie");
    const user=await authenticate(req);
    if(!user) return reply.code(401).send({error:"login_required"});
    const group=(req.query as {group?:unknown}).group;
    if(!validProjectGroup(group)) return reply.code(400).send({error:"invalid_query"});
    const id=(req.params as {id:string}).id;
    const [row]=await sql<Array<{id:string;gp_name:string;investee_name:string;sector_tags:string[];event_date:string|null;status:string;source_url:string|null}>>`SELECT i.id,g.canonical_name AS gp_name,i.investee_name,i.sector_tags,
      i.approved_event_date::text AS event_date,'verified'::text AS status,i.approved_source_url AS source_url
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      WHERE i.id=${id} AND i.status='verified' AND g.status='active' AND g.entity_role='gp'
        AND (${group??null}::text IS NULL OR ${group??null}::text=ANY(g.project_groups))`;
    if(!row) return reply.code(404).send({error:"not_found"});
    const source=employeeSource(row.source_url);
    return {investment:{...row,source_url:source.url,source_placeholder:source.placeholder}};
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
    const query=req.query as {limit?:string;offset?:string;status?:string};
    const {limit,offset}=pageParams(query);
    const status=query.status;
    if(status!==undefined&&!['candidate','active','paused'].includes(status)) return reply.code(400).send({error:'invalid_status'});
    const rows=await sql`SELECT id,canonical_name,aliases,entity_id,credit_code,entity_role,status,source_ref,project_groups,project_group_basis,reviewed_at,last_synced_at,last_error FROM member_gp_watchlist
      WHERE (${status??null}::text IS NULL OR status=${status??null}) ORDER BY created_at,id LIMIT ${limit+1} OFFSET ${offset}`;
    return {gps:rows.slice(0,limit),pagination:pagination(limit,offset,rows.length)};
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
    const groups=input.projectGroups===undefined?undefined:validProjectGroups(input.projectGroups);
    const groupBasis=input.projectGroupBasis===undefined?undefined:typeof input.projectGroupBasis==="string"?input.projectGroupBasis.trim():null;
    if(groups===null||groupBasis===null||groupBasis!==undefined&&groupBasis.length>1000)
      return reply.code(400).send({error:"invalid_project_groups"});
    if(groups?.length && (!groupBasis || groupBasis.length<8))
      return reply.code(400).send({error:"project_group_basis_required"});
    if(!aliases) return reply.code(400).send({error:"invalid_aliases"});
    if(!["candidate","active","paused"].includes(String(status))||!["manager","gp","fund"].includes(String(role))||
       entityId.length>128||creditCode.length>32||source.length<8||source.length>1000||
       (status==="active"&&(role!=="gp"||!entityId)))
      return reply.code(400).send({error:"gp_identity_verification_required"});
    const id=(req.params as {id:string}).id;
    const changed=await sql`UPDATE member_gp_watchlist SET status=${status as string},entity_role=${role as string},entity_id=${entityId||null},credit_code=${creditCode||null},aliases=${aliases},
      source_ref=${source},project_groups=COALESCE(${groups??null}::text[],project_groups),
      project_group_basis=COALESCE(${groupBasis??null}::text,project_group_basis),
      reviewed_by=${user.id},reviewed_at=now() WHERE id=${id}
      AND (cardinality(COALESCE(${groups??null}::text[],project_groups))=0
        OR length(btrim(COALESCE(${groupBasis??null}::text,project_group_basis,'')))>=8)
      AND (NOT EXISTS(SELECT 1 FROM member_gp_snapshots WHERE gp_id=${id})
           OR (entity_id IS NOT DISTINCT FROM ${entityId||null} AND entity_role=${role as string}))
      RETURNING id`;
    if(changed.length) return {ok:true};
    const [existing]=await sql`SELECT id FROM member_gp_watchlist WHERE id=${id}`;
    return reply.code(existing?409:404).send({error:existing?"gp_identity_or_group_basis_required":"not_found"});
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
    const query=req.query as {limit?:string;offset?:string;status?:string};
    const {limit,offset}=pageParams(query);
    const status=query.status;
    if(status!==undefined&&!['observed','verified','baseline','retracted'].includes(status)) return reply.code(400).send({error:'invalid_status'});
    const observations=await sql`SELECT i.id,i.gp_id,g.canonical_name AS gp_name,i.investee_name,i.investee_id,i.first_seen_at,i.investment_date,i.provider_updated_at,i.data_date,s.captured_at AS snapshot_captured_at,
      i.status,i.sector_tags,i.sector_reason,i.classification_state,i.approved_event_date,i.approved_source_url,i.mother_fund_name,i.subfund_name,i.fund_relation_basis,i.fund_relation_source_url,i.project_province,i.province_checked_at
      FROM member_gp_investments i JOIN member_gp_watchlist g ON g.id=i.gp_id
      LEFT JOIN member_gp_snapshots s ON s.id=i.source_snapshot_id
      WHERE (${status??null}::text IS NULL OR i.status=${status??null}) ORDER BY i.first_seen_at DESC,i.id DESC LIMIT ${limit+1} OFFSET ${offset}`;
    return {observations:observations.slice(0,limit),pagination:pagination(limit,offset,observations.length),allowedTags:GP_TAGS};
  });
  app.patch("/api/v1/membership/admin/gp-observations/:id",async(req,reply)=>{
    const user=await admin(req,reply);if(!user) return;
    const input=body(req);
    const tags=validSectorTags(input.tags);
    const status=input.status;
    const date=typeof input.eventDate==="string"?input.eventDate:"";
    const source=typeof input.sourceUrl==="string"?input.sourceUrl.trim():"";
    const reason=typeof input.reason==="string"?input.reason.slice(0,1000):"";
    const motherFund=optionalName(input.motherFund),subfund=optionalName(input.subfund);
    const fundBasis=typeof input.fundRelationBasis==="string"?input.fundRelationBasis.trim().slice(0,1000):"";
    const fundSource=typeof input.fundRelationSourceUrl==="string"?input.fundRelationSourceUrl.trim():"";
    if(motherFund===undefined||subfund===undefined||((motherFund||subfund)&&(fundBasis.length<8||!isHttpsEvidenceUrl(fundSource)))) return reply.code(400).send({error:"invalid_fund_names"});
    if(!tags||!["baseline","observed","verified","retracted"].includes(String(status))) return reply.code(400).send({error:"invalid_review"});
    // A new-investment assertion requires separately checked evidence; snapshots alone never qualify.
    if(status==="verified"&&(!tags.length||!isCalendarDate(date)||!isHttpsEvidenceUrl(source)))
       return reply.code(400).send({error:"event_evidence_required"});
    const id=(req.params as {id:string}).id;
    const outcome=await sql.begin(async tx=>{
      const [old]=await tx<{
        status:string; sector_tags:string[]; sector_reason:string|null;mother_fund_name:string|null;subfund_name:string|null;fund_relation_basis:string|null;fund_relation_source_url:string|null;
        approved_event_date:string|null; approved_source_url:string|null; approved_by:string|null;
        approved_at:Date|null; revision:number; source_snapshot_id:string|null;
      }[]>`SELECT status,sector_tags,sector_reason,mother_fund_name,subfund_name,fund_relation_basis,fund_relation_source_url,approved_event_date::text,approved_source_url,approved_by,
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
        approved_by=${approvedBy},approved_at=${approvedAt},mother_fund_name=${motherFund},subfund_name=${subfund},
        fund_relation_basis=${fundBasis||null},fund_relation_source_url=${fundSource||null},revision=revision+1
        WHERE id=${id} RETURNING id,revision`;
      const before={...old};
      const after={...old,status,sector_tags:tags,sector_reason:reason,approved_event_date:eventDate,
        approved_source_url:evidenceUrl,approved_by:approvedBy,approved_at:approvedAt,mother_fund_name:motherFund,
        subfund_name:subfund,fund_relation_basis:fundBasis||null,fund_relation_source_url:fundSource||null,revision:updated.revision};
      await tx`INSERT INTO member_gp_review_audit(investment_id,actor_id,tags,reason,before_state,after_state)
        VALUES(${id},${user.id},${tags},${reason},${tx.json(before as never)},${tx.json(after as never)})`;
      return "ok";
    });
    return outcome==="ok"?{ok:true}:reply.code(outcome==="not_found"?404:409).send({error:outcome});
  });

  app.post("/api/v1/membership/admin/gp-observations/:id/province",async(req,reply)=>{
    const user=await admin(req,reply);if(!user) return;
    const id=(req.params as {id:string}).id;
    const [row]=await sql<{investee_name:string;investee_id:string|null}[]>`SELECT investee_name,investee_id FROM member_gp_investments WHERE id=${id}`;
    if(!row) return reply.code(404).send({error:"not_found"});
    if(!row.investee_id) return reply.code(409).send({error:"xinhua_identity_unavailable"});
    try {
      const province=await withXinhua(async call=>{
        const entity={id:row.investee_id!,name:row.investee_name,status:null,creditCode:null,address:null,startDate:null};
        const {profile}=await querySelectedCompanyProfile(call,entity);
        const address=typeof profile.address==="string"?profile.address:typeof profile.registered_address==="string"?profile.registered_address:null;
        return provinceFromAddress(address);
      });
      await sql`UPDATE member_gp_investments SET project_province=${province},province_source='xinhua_company_profile',province_checked_at=now(),revision=revision+1 WHERE id=${id}`;
      return {project_province:province??"未知",verified:province!==null};
    } catch {
      return reply.code(502).send({error:"xinhua_province_unavailable"});
    }
  });
}

function validFilterValue(value:unknown):boolean{return value===undefined||value===null||typeof value==="string"&&value.length>0&&value.length<=120;}
function optionalName(value:unknown):string|null|undefined{
  if(value===undefined)return null;
  if(typeof value!=="string")return undefined;
  const trimmed=value.trim();
  return trimmed.length>120?undefined:trimmed||null;
}

function validProjectGroup(value:unknown):value is undefined|"citic-alliance"|"market-leaders" {
  return value===undefined||value==="citic-alliance"||value==="market-leaders";
}
function validProjectGroups(value:unknown):string[]|null {
  if(!Array.isArray(value)||value.length>2||!value.every(item=>item==="citic-alliance"||item==="market-leaders")||new Set(value).size!==value.length) return null;
  return value as string[];
}

function pageParams(query:{limit?:string;offset?:string}) {
  const requestedLimit=Number(query.limit??25),requestedOffset=Number(query.offset??0);
  return {
    limit:Number.isInteger(requestedLimit)?Math.min(100,Math.max(1,requestedLimit)):25,
    offset:Number.isInteger(requestedOffset)?Math.min(100_000,Math.max(0,requestedOffset)):0,
  };
}
function pagination(limit:number,offset:number,rowCount:number) {
  return {limit,offset,nextOffset:rowCount>limit?offset+limit:null};
}
function isCalendarDate(value:string) {
  if(!/^20\d\d-\d\d-\d\d$/.test(value)) return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}

function isHttpsEvidenceUrl(value:string) {
  try {
    const url=new URL(value);
    return url.protocol==="https:"&&url.hostname.length>0&&!url.username&&!url.password;
  } catch {
    return false;
  }
}
