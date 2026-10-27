import {randomUUID} from "node:crypto";
import {sql,type Db} from "@aihot/backend/db";
import {answerQuestion} from "./answer.ts";
import {performance} from "node:perf_hooks";
import {routePages,type RoutableCitation,type RoutablePage} from "./routing.ts";
import {enrichCitations,toAnswerCitation} from "./history.ts";
import {ensureDefaultBase} from "./bases.ts";

const actorToken=Symbol("knowledge-actor");
export type KnowledgeActor={readonly userId:string;readonly [actorToken]:true;readonly channel:"web"|"ilink";readonly bindingVersion?:number;readonly grantId?:string};
/** Only an authenticated platform session or a checked iLink binding may mint this actor. */
export function knowledgeActor(userId:string):KnowledgeActor{return {userId,channel:"web",[actorToken]:true};}
export function knowledgeIlinkActor(userId:string,bindingVersion:number,grantId:string):KnowledgeActor{return {userId,channel:"ilink",bindingVersion,grantId,[actorToken]:true};}
export class KnowledgeError extends Error {readonly code:string;constructor(code:string){super(code);this.code=code;}}
async function check(actor:KnowledgeActor,baseId?:string,db:Db=sql){
  if(actor?.[actorToken]!==true)throw new KnowledgeError("knowledge_forbidden");
  const [user]=await db`SELECT 1 FROM member_users WHERE id=${actor.userId} AND status='active' FOR SHARE`;
  if(!user)throw new KnowledgeError("knowledge_forbidden");
  if(actor.channel==="ilink"){
    const [bound]=await db`SELECT 1 FROM member_agent_grants g
      JOIN member_weixin_bindings b ON b.user_id=g.user_id AND b.status='active'
      JOIN member_ilink_accounts a ON a.user_id=g.user_id AND a.recipient_id=b.recipient_id AND a.channel_account_id=b.channel_account_id
      JOIN member_notification_settings s ON s.user_id=g.user_id AND s.binding_version=${actor.bindingVersion??null}
      WHERE g.user_id=${actor.userId} AND g.grant_id=${actor.grantId??null}::uuid FOR SHARE OF g,b,s`;
    if(!bound)throw new KnowledgeError("knowledge_forbidden");
  }
  if(baseId!==undefined){
    if(baseId==="shared")await ensureDefaultBase();
    const [base]=await db<{id:string;name:string}[]>`SELECT id,name FROM member_wiki_bases WHERE id=${baseId} AND status='active' FOR SHARE`;
    if(!base)throw new KnowledgeError("knowledge_base_not_found");
    return base;
  }
}
export async function listKnowledgeBases(actor:KnowledgeActor){
  await check(actor);await ensureDefaultBase();
  return sql<{id:string;name:string;description:string;status:string;createdAt:Date;updatedAt:Date;documents:number;pages:number;building:number;failed:number}[]>`
    SELECT b.id,b.name,b.description,b.status,b.created_at AS "createdAt",b.updated_at AS "updatedAt",
      (SELECT count(*)::int FROM member_wiki_documents d WHERE d.base_id=b.id AND d.status='active') AS documents,
      (SELECT count(*)::int FROM member_wiki_pages p WHERE p.base_id=b.id AND p.status='published') AS pages,
      (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id WHERE d.base_id=b.id AND t.state IN ('queued','running')) AS building,
      (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id WHERE d.base_id=b.id AND t.state='failed') AS failed
    FROM member_wiki_bases b WHERE b.status='active' ORDER BY (b.id='shared') DESC,b.created_at,b.id`;
}
export async function searchKnowledgePages(actor:KnowledgeActor,baseId:string,query:string,type="",limit=50,offset=0){
  await check(actor,baseId);
  const pages=await sql`
    SELECT p.slug,p.page_type AS "pageType",p.target_type AS "targetType",p.target_name AS "targetName",p.track,p.status,p.updated_at AS "updatedAt",
      r.revision,r.coverage,r.published_at AS "publishedAt",
      (SELECT count(*)::int FROM member_wiki_citations c WHERE c.page_id=p.id AND c.revision=r.revision) AS "citationCount",
      (SELECT count(*)::int FROM member_wiki_quality_issues q WHERE q.page_id=p.id AND q.status='open') AS "issueCount"
    FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id=p.id AND r.revision=(SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id=p.id)
    WHERE p.status='published' AND p.base_id=${baseId} AND (${type}='' OR p.page_type=${type}) AND (${query}='' OR p.slug ILIKE ${`%${query}%`} OR p.target_name ILIKE ${`%${query}%`} OR r.body_md ILIKE ${`%${query}%`})
    ORDER BY r.published_at DESC,p.slug LIMIT ${limit+1} OFFSET ${offset}`;
  return {pages:pages.slice(0,limit),hasMore:pages.length>limit,nextOffset:pages.length>limit?offset+limit:null};
}
function dateText(value:unknown):string|null {return value instanceof Date?value.toISOString().slice(0,10):typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;}
export async function answerKnowledgeQuestion(actor:KnowledgeActor,baseId:string,question:string,
  options:{short?:boolean;onModelTiming?:(durationMs:number,status:"processed"|"failed")=>void}={}){
  if(question.trim().length<2||question.length>500)throw new KnowledgeError("knowledge_question_required");
  await check(actor,baseId);
  const rows = await sql<{ id: string; slug: string; page_type: string; target_name: string | null; track: string | null; body_md: string; coverage: Record<string, unknown> | null; revision_id: string }[]>`
      SELECT p.id, p.slug, p.page_type, p.target_name, p.track, r.body_md, r.coverage, r.id AS revision_id
      FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id = p.id
        AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published' AND p.base_id = ${baseId}`;
    const citationRows = await sql<{ id: string; page_id: string; label: string; anchor: string | null; analyst: string | null; organization: string | null; published_on: Date | null; source_title: string | null; version_id: string; document_id: string; document_title: string; file_name: string }[]>`
      SELECT c.id, c.page_id, c.label, c.anchor, c.analyst, c.organization, c.published_on, c.source_title, c.version_id,
        d.id AS document_id, d.title AS document_title, v.file_name AS file_name
      FROM member_wiki_citations c
      JOIN member_wiki_pages p ON p.id = c.page_id
      JOIN member_wiki_document_versions v ON v.id = c.version_id
      JOIN member_wiki_documents d ON d.id = v.document_id
      WHERE p.status='published' AND p.base_id = ${baseId}
        AND c.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = c.page_id)`;
    const byPage = new Map<string, RoutableCitation[]>();
    for (const row of citationRows) {
      const list = byPage.get(row.page_id) ?? [];
      list.push({
        id: row.id,
        label: row.label,
        analyst: row.analyst,
        organization: row.organization,
        publishedOn: dateText(row.published_on),
        anchor: row.anchor,
        sourceTitle: row.source_title,
        versionId: row.version_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        fileName: row.file_name,
      });
      byPage.set(row.page_id, list);
    }
    const candidates: RoutablePage[] = rows.map(row => ({
      slug: row.slug,
      title: row.slug,
      pageType: row.page_type,
      targetName: row.target_name,
      track: row.track,
      bodyMd: row.body_md,
      revisionId: row.revision_id,
      citations: byPage.get(row.id) ?? [],
      coverage: {
        analysts: Number(row.coverage?.analysts ?? 0),
        firms: Number(row.coverage?.firms ?? 0),
        reports: Number(row.coverage?.reports ?? 0),
        first_report: (row.coverage?.first_report as string | null) ?? null,
        last_report: (row.coverage?.last_report as string | null) ?? null,
      },
    }));
    const routed = routePages(question, candidates);
    if (!routed.length) throw new KnowledgeError("knowledge_no_coverage");
    let answer;
    const modelStarted=performance.now();
    try { answer = await answerQuestion(question, routed.map(entry => entry.page), new Date(), {memberUserId: actor.userId, short: options.short});
      options.onModelTiming?.(performance.now()-modelStarted,"processed"); }
    catch (error) { options.onModelTiming?.(performance.now()-modelStarted,"failed");
      throw error instanceof Error && error.message === "knowledge_answer_unverified" ? new KnowledgeError("knowledge_answer_unverified") : new KnowledgeError("knowledge_answer_failed"); }
    const citations = answer.citations;
    // An answer that rests on nothing the library can show is not an answer: it is refused.
    if (!citations.length) throw new KnowledgeError("knowledge_answer_unverified");
    let bodyText = answer.answer;
    const usedPages = new Set(citations.map(citation => citation.pageSlug));
    for (const citation of citations) {
      const needle = `[^${citation.label}]`;
      const replacement = `[${citation.label}](/knowledge/targets/${citation.pageSlug})`;
      bodyText = bodyText.replaceAll(needle, () => replacement);
    }
    const id = randomUUID();
    // Model calls may outlive a withdrawal or a new publication. Lock the same documents before
    // pages as publishing/withdrawal do, then verify the exact revisions before recording an answer.
    const saved = await sql.begin(async tx => {
      await check(actor,baseId,tx);
      const versionIds = [...new Set(citations.map(citation => citation.versionId))];
      const documents = await tx<{ id: string; status: string }[]>`
        SELECT d.id, d.status FROM member_wiki_documents d
        WHERE d.id IN (SELECT document_id FROM member_wiki_document_versions WHERE id IN ${tx(versionIds)})
        ORDER BY d.id FOR SHARE`;
      if (!documents.length || documents.some(document => document.status !== "active")) return false;
      const current = await tx<{ slug: string; status: string }[]>`SELECT slug, status FROM member_wiki_pages WHERE slug IN ${tx([...usedPages])} ORDER BY slug FOR SHARE`;
      if (current.length !== usedPages.size || current.some(page => page.status !== "published")) return false;
      for (const entry of routed.filter(entry => usedPages.has(entry.page.slug))) {
        const revisions = await tx<{ id: string }[]>`SELECT r.id FROM member_wiki_page_revisions r JOIN member_wiki_pages p ON p.id=r.page_id WHERE p.slug=${entry.page.slug} ORDER BY r.revision DESC LIMIT 1`;
        if (revisions[0]?.id !== entry.page.revisionId) return false;
      }
      await tx`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by) VALUES (${id}, ${question}, ${bodyText}, ${tx.json(citations as never)}, ${tx.json(answer.coverage as never)}, ${tx.json(answer.freshness as never)}, ${tx.json([...usedPages])}, ${actor.userId})`;
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, detail) VALUES (${randomUUID()}, ${actor.userId}, 'knowledge.answer.created', ${tx.json({ pages: [...usedPages] })})`;
      return true;
    });
    if (!saved) throw new KnowledgeError("knowledge_answer_conflict");
    return { id, question, answerMd: bodyText, citations: await enrichCitations(citations.map(toAnswerCitation)), coverage: answer.coverage, freshness: answer.freshness, pages: [...usedPages], references: routed.map(entry => ({ slug: entry.page.slug, score: entry.score })) };
}
