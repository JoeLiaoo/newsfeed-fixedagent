// The shared library's own addresses. Everything here is employee-only: the account system decides who
// may see the library, and the library decides what it holds.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import type { MemberSession } from "../server.ts";
import { WIKI_QUEUE } from "./queue.ts";
import { answerQuestion } from "./answer.ts";
import { routePages, type RoutablePage } from "./routing.ts";
import { FORMAT_MEDIA_TYPES, freshnessTier, FRESHNESS_LABELS, TASK_ERRORS, maxFileBytes } from "./catalog.ts";
import { checksum, versionBody } from "./worker.ts";
import { detectFormat } from "./extract.ts";

type Authenticate = (request: FastifyRequest, allowPending?: boolean) => Promise<MemberSession | null>;

function noStore(reply: { header: (name: string, value: string) => unknown }) {
  reply.header("Cache-Control", "private, no-store");
  reply.header("Vary", "Cookie");
}

function validOrigin(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function body(req: FastifyRequest): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function registerKnowledgeRoutes(app: FastifyInstance, authenticate: Authenticate) {
  /** What the library holds right now: how much, how current, and what is still open. */
  app.get("/api/v1/membership/knowledge/overview", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const [counts] = await sql`
      SELECT (SELECT count(*)::int FROM member_wiki_documents WHERE status='active') AS documents,
             (SELECT count(*)::int FROM member_wiki_document_versions) AS versions,
             (SELECT count(*)::int FROM member_wiki_pages WHERE status='published') AS pages,
             (SELECT count(*)::int FROM member_wiki_tasks WHERE state='queued') AS queued,
             (SELECT count(*)::int FROM member_wiki_tasks WHERE state='running') AS running,
             (SELECT count(*)::int FROM member_wiki_tasks WHERE state='failed') AS failed,
             (SELECT count(*)::int FROM member_wiki_quality_issues WHERE status='open') AS openIssues,
             (SELECT count(*)::int FROM member_wiki_quality_issues WHERE status='open' AND level='P0') AS blockingIssues`;
    const pages = await sql<{ slug: string; coverage: { analysts?: number; last_report?: string | null } | null }[]>`
      SELECT p.slug, r.coverage FROM member_wiki_pages p
      JOIN member_wiki_page_revisions r ON r.page_id = p.id AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published'`;
    const freshness = { fresh: 0, semi: 0, stale: 0, undated: 0 };
    for (const page of pages) freshness[freshnessTier(page.coverage?.last_report ?? null)] += 1;
    const coverage = pages.reduce((sum, page) => sum + (page.coverage?.analysts ?? 0), 0);
    return { overview: { ...counts, freshness, namedAnalysts: coverage, myId: user.id } };
  });

  /** The shared library's materials, with the state of their last build. */
  app.get("/api/v1/membership/knowledge/documents", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const query = typeof req.query === "object" && req.query && "query" in req.query ? String((req.query as { query?: unknown }).query ?? "").trim() : "";
    const documents = await sql`
      SELECT d.id, d.title, d.status, d.uploader_id AS "uploaderId", u.real_name AS "uploaderName", d.created_at AS "createdAt", d.withdrawn_at AS "withdrawnAt",
        v.id AS "versionId", v.file_name AS "fileName", v.format, v.byte_size AS "byteSize", v.sha256, v.source_author AS "sourceAuthor", v.source_org AS "sourceOrg", v.source_date AS "sourceDate",
        v.extraction_status AS "extractionStatus", v.extraction_note AS "extractionNote", v.version_no AS "versionNo",
        t.state AS "taskState", t.stage AS "taskStage", t.error_code AS "errorCode", t.error_message AS "errorMessage"
      FROM member_wiki_documents d
      JOIN member_users u ON u.id = d.uploader_id
      JOIN LATERAL (SELECT * FROM member_wiki_document_versions v WHERE v.document_id = d.id ORDER BY v.version_no DESC LIMIT 1) v ON true
      LEFT JOIN LATERAL (SELECT * FROM member_wiki_tasks t WHERE t.version_id = v.id ORDER BY t.created_at DESC LIMIT 1) t ON true
      WHERE d.status = 'active' AND (${query} = '' OR d.title ILIKE ${`%${query}%`} OR v.file_name ILIKE ${`%${query}%`} OR v.source_org ILIKE ${`%${query}%`})
      ORDER BY d.created_at DESC LIMIT 100`;
    return { documents };
  });

  /** One material with its versions and its builds. */
  app.get("/api/v1/membership/knowledge/documents/:id", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const documents = await sql`SELECT id, title, status, uploader_id AS "uploaderId", created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM member_wiki_documents WHERE id = ${id}`;
    if (!documents[0]) return reply.code(404).send({ error: "knowledge_document_not_found" });
    const versions = await sql`
      SELECT v.id, v.version_no AS "versionNo", v.file_name AS "fileName", v.format, v.byte_size AS "byteSize", v.sha256, v.source_title AS "sourceTitle", v.source_author AS "sourceAuthor",
        v.source_org AS "sourceOrg", v.source_date AS "sourceDate", v.source_kind AS "sourceKind", v.extraction_status AS "extractionStatus", v.extraction_note AS "extractionNote",
        v.created_at AS "createdAt", u.real_name AS "uploaderName",
        t.id AS "taskId", t.state AS "taskState", t.stage AS "taskStage", t.error_code AS "errorCode", t.error_message AS "errorMessage", t.attempt_count AS "attemptCount", t.updated_at AS "updatedAt"
      FROM member_wiki_document_versions v JOIN member_users u ON u.id = v.uploader_id
      LEFT JOIN LATERAL (SELECT * FROM member_wiki_tasks t WHERE t.version_id = v.id ORDER BY t.created_at DESC LIMIT 1) t ON true
      WHERE v.document_id = ${id} ORDER BY v.version_no DESC`;
    return { document: documents[0], versions };
  });

  /** Uploading a material. It enters the shared library on its own; there is no per-item approval. */
  app.post("/api/v1/membership/knowledge/documents", { bodyLimit: Math.ceil((maxFileBytes() * 4) / 3) + 1024 * 1024 }, async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const payload = body(req);
    const fileName = text(payload.fileName, 200);
    const base64 = typeof payload.base64 === "string" ? payload.base64 : "";
    if (!fileName || !base64) return reply.code(400).send({ error: "knowledge_file_type_unsupported", message: "请选择要上传的材料文件。" });
    const limit = maxFileBytes();
    if (base64.length > Math.ceil((limit * 4) / 3) + 8) return reply.code(413).send({ error: "knowledge_upload_too_large", message: TASK_ERRORS.knowledge_upload_too_large });
    let bytes: Buffer;
    try { bytes = Buffer.from(base64, "base64"); }
    catch { return reply.code(400).send({ error: "knowledge_file_unreadable" }); }
    if (!bytes.length) return reply.code(400).send({ error: "knowledge_file_unreadable" });
    if (bytes.length > limit) return reply.code(413).send({ error: "knowledge_upload_too_large", message: TASK_ERRORS.knowledge_upload_too_large });
    const format = detectFormat(fileName, bytes);
    if (!format) return reply.code(400).send({ error: "knowledge_file_type_unsupported", message: TASK_ERRORS.knowledge_file_type_unsupported });

    const title = text(payload.title, 200) ?? fileName.replace(/\.[^.]+$/, "");
    const author = text(payload.author, 120);
    const organization = text(payload.organization, 120);
    const kind = text(payload.kind, 60);
    const date = text(payload.date, 10);
    if (date && !isDate(date)) return reply.code(400).send({ error: "knowledge_date_invalid", message: "材料日期需为 YYYY-MM-DD。" });
    const requestedDocument = text(payload.documentId, 64);
    const sha256 = checksum(bytes);

    const admitted = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      const active = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_tasks WHERE uploader_id=${user.id} AND state IN ('queued','running')`;
      if ((active[0]?.count ?? 0) >= 2) return { limited: true as const };
      const recent = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_tasks WHERE uploader_id=${user.id} AND created_at > now() - interval '1 hour'`;
      if ((recent[0]?.count ?? 0) >= 10) return { limited: true as const };

      let documentId = requestedDocument;
      if (documentId) {
        const owned = await tx<{ id: string }[]>`SELECT id FROM member_wiki_documents WHERE id=${documentId} AND status='active' AND (uploader_id=${user.id} OR ${user.role === "admin"})`;
        if (!owned[0]) return { forbidden: true as const };
      } else {
        const same = await tx<{ document_id: string }[]>`SELECT v.document_id FROM member_wiki_document_versions v WHERE v.sha256=${sha256} AND v.document_id IN (SELECT id FROM member_wiki_documents WHERE uploader_id=${user.id}) LIMIT 1`;
        if (same[0]) {
          const version = await tx<{ id: string; version_no: number }[]>`SELECT id, version_no FROM member_wiki_document_versions WHERE document_id=${same[0].document_id} AND sha256=${sha256} LIMIT 1`;
          return { duplicate: true as const, documentId: same[0].document_id, versionId: version[0]!.id, versionNo: version[0]!.version_no };
        }
        documentId = randomUUID();
        await tx`INSERT INTO member_wiki_documents(id, uploader_id, title) VALUES (${documentId}, ${user.id}, ${title})`;
      }
      const duplicate = await tx<{ id: string; version_no: number }[]>`SELECT id, version_no FROM member_wiki_document_versions WHERE document_id=${documentId} AND sha256=${sha256} LIMIT 1`;
      if (duplicate[0]) return { duplicate: true as const, documentId, versionId: duplicate[0].id, versionNo: duplicate[0].version_no };
      const latest = await tx<{ version_no: number }[]>`SELECT max(version_no) AS version_no FROM member_wiki_document_versions WHERE document_id=${documentId}`;
      const versionNo = (latest[0]?.version_no ?? 0) + 1;
      const versionId = randomUUID();
      await tx`INSERT INTO member_wiki_document_versions(id, document_id, version_no, uploader_id, file_name, media_type, format, byte_size, sha256, body, source_title, source_author, source_org, source_date, source_kind)
        VALUES (${versionId}, ${documentId}, ${versionNo}, ${user.id}, ${fileName}, ${FORMAT_MEDIA_TYPES[format][0]}, ${format}, ${bytes.length}, ${sha256}, ${bytes}, ${title}, ${author}, ${organization}, ${date}, ${kind})`;
      await tx`UPDATE member_wiki_document_versions SET superseded_at=now() WHERE document_id=${documentId} AND id <> ${versionId} AND superseded_at IS NULL`;
      const taskId = randomUUID();
      await tx`INSERT INTO member_wiki_tasks(id, document_id, version_id, uploader_id) VALUES (${taskId}, ${documentId}, ${versionId}, ${user.id})`;
      await enqueueOn(WIKI_QUEUE, { taskId }, { singletonKey: taskId }, tx);
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, document_id, version_id, task_id, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.document.uploaded', ${documentId}, ${versionId}, ${taskId}, ${tx.json({ fileName, format, sha256, versionNo })})`;
      return { documentId, versionId, versionNo, taskId };
    });

    if ("limited" in admitted) {
      console.warn(JSON.stringify({ event: "knowledge_upload_rate_limited", userId: user.id }));
      return reply.code(429).send({ error: "knowledge_upload_rate_limited", message: "同时处理的构建过多，请稍后再试。" });
    }
    if ("forbidden" in admitted) return reply.code(403).send({ error: "knowledge_not_permitted", message: TASK_ERRORS.knowledge_not_permitted });
    if ("duplicate" in admitted) {
      return reply.code(200).send({ duplicate: true, documentId: admitted.documentId, versionId: admitted.versionId, versionNo: admitted.versionNo, taskId: null, message: "这份材料已在共享库中，未重复入库。" });
    }
    return reply.code(202).send({ duplicate: false, documentId: admitted.documentId, versionId: admitted.versionId, versionNo: admitted.versionNo, taskId: admitted.taskId });
  });

  /** Taking a material out of the shared library. The pages it produced are withdrawn with it. */
  app.post("/api/v1/membership/knowledge/documents/:id/withdraw", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const changed = await sql.begin(async tx => {
      const owned = await tx<{ id: string }[]>`SELECT id FROM member_wiki_documents WHERE id=${id} AND (uploader_id=${user.id} OR ${user.role === "admin"}) FOR UPDATE`;
      if (!owned[0]) return false;
      await tx`UPDATE member_wiki_documents SET status='withdrawn', withdrawn_at=now(), withdrawn_by=${user.id}, updated_at=now() WHERE id=${id}`;
      await tx`UPDATE member_wiki_tasks SET state='cancelled', stage='failed', error_code='knowledge_task_cancelled', error_message=${TASK_ERRORS.knowledge_task_cancelled}, updated_at=now(), finished_at=now() WHERE document_id=${id} AND state IN ('queued','running')`;
      await tx`UPDATE member_wiki_pages SET status='withdrawn', updated_at=now() WHERE status='published' AND id IN (
        SELECT r.page_id FROM member_wiki_page_revisions r
        JOIN member_wiki_document_versions v ON v.id = r.version_id
        WHERE v.document_id = ${id}
          AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = r.page_id))`;
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, document_id, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.document.withdrawn', ${id}, ${tx.json({})})`;
      return true;
    });
    if (!changed) return reply.code(404).send({ error: "knowledge_document_not_found" });
    return { id, status: "withdrawn" };
  });

  /** The builds of the shared library, with their state. */
  app.get("/api/v1/membership/knowledge/tasks", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tasks = await sql`
      SELECT t.id, t.stage, t.state, t.attempt_count AS "attemptCount", t.error_code AS "errorCode", t.error_message AS "errorMessage",
        t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.finished_at AS "finishedAt",
        d.id AS "documentId", d.title AS "documentTitle", u.real_name AS "uploaderName", v.version_no AS "versionNo", v.file_name AS "fileName"
      FROM member_wiki_tasks t
      JOIN member_wiki_documents d ON d.id = t.document_id
      JOIN member_wiki_document_versions v ON v.id = t.version_id
      JOIN member_users u ON u.id = t.uploader_id
      ORDER BY t.created_at DESC LIMIT 100`;
    return { tasks };
  });

  /** Running a failed build again, from the stage it stopped at. */
  app.post("/api/v1/membership/knowledge/tasks/:id/retry", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const changed = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      const rows = await tx`UPDATE member_wiki_tasks SET state='queued', stage='queued', error_code=NULL, error_message=NULL, updated_at=now(), finished_at=NULL, lease_token=NULL, lease_expires_at=NULL
        WHERE id=${id} AND uploader_id=${user.id} AND state='failed' AND attempt_count < 5 RETURNING id`;
      if (!rows.length) return false;
      await enqueueOn(WIKI_QUEUE, { taskId: id }, { singletonKey: `${id}-${Date.now()}` }, tx);
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, task_id, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.build.retried', ${id}, ${tx.json({})})`;
      return true;
    });
    if (!changed) return reply.code(404).send({ error: "knowledge_task_not_retryable" });
    return reply.code(202).send({ id, state: "queued" });
  });

  /** The published pages, for browsing and searching. */
  app.get("/api/v1/membership/knowledge/pages", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const query = typeof req.query === "object" && req.query && "query" in req.query ? String((req.query as { query?: unknown }).query ?? "").trim() : "";
    const type = typeof req.query === "object" && req.query && "type" in req.query ? String((req.query as { type?: unknown }).type ?? "") : "";
    const pages = await sql`
      SELECT p.slug, p.page_type AS "pageType", p.target_type AS "targetType", p.target_name AS "targetName", p.track, p.status, p.updated_at AS "updatedAt",
        r.revision, r.coverage, r.published_at AS "publishedAt",
        (SELECT count(*)::int FROM member_wiki_citations c WHERE c.page_id = p.id AND c.revision = r.revision) AS "citationCount",
        (SELECT count(*)::int FROM member_wiki_quality_issues q WHERE q.page_id = p.id AND q.status='open') AS "issueCount"
      FROM member_wiki_pages p
      JOIN member_wiki_page_revisions r ON r.page_id = p.id AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published' AND (${type} = '' OR p.page_type = ${type}) AND (${query} = '' OR p.slug ILIKE ${`%${query}%`} OR p.target_name ILIKE ${`%${query}%`} OR r.body_md ILIKE ${`%${query}%`})
      ORDER BY r.published_at DESC LIMIT 100`;
    return {
      pages: pages.map(page => ({
        ...page,
        freshness: freshnessTier(page.coverage?.last_report ?? null),
        freshnessLabel: FRESHNESS_LABELS[freshnessTier(page.coverage?.last_report ?? null)],
      })),
    };
  });

  /** One page: its text, its sources and its open quality issues. */
  app.get("/api/v1/membership/knowledge/pages/:slug", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const slug = (req.params as { slug: string }).slug;
    const pages = await sql`
      SELECT p.id, p.slug, p.page_type AS "pageType", p.target_type AS "targetType", p.target_name AS "targetName", p.track, p.status, p.updated_at AS "updatedAt",
        r.revision, r.body_md AS "bodyMd", r.coverage, r.published_at AS "publishedAt"
      FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id = p.id
      WHERE p.slug=${slug} ORDER BY r.revision DESC LIMIT 1`;
    const page = pages[0];
    if (!page) return reply.code(404).send({ error: "knowledge_page_not_found" });
    const citations = await sql`
      SELECT c.label, c.anchor, c.analyst, c.organization, c.published_on AS "publishedOn", c.source_title AS "sourceTitle", v.id AS "versionId", v.file_name AS "fileName", v.format, d.id AS "documentId", d.title AS "documentTitle"
      FROM member_wiki_citations c JOIN member_wiki_document_versions v ON v.id = c.version_id JOIN member_wiki_documents d ON d.id = v.document_id
      WHERE c.page_id=${page.id} AND c.revision=${page.revision} ORDER BY c.label, c.created_at`;
    const issues = await sql`SELECT level, category, target, message, evidence, detected_at AS "detectedAt" FROM member_wiki_quality_issues WHERE page_id=${page.id} AND status='open' ORDER BY level, detected_at DESC`;
    const tier = freshnessTier(page.coverage?.last_report ?? null);
    return { page: { ...page, freshness: tier, freshnessLabel: FRESHNESS_LABELS[tier] }, citations, issues };
  });

  /** The original material, for an employee who may see it. */
  app.get("/api/v1/membership/knowledge/versions/:id/original", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const material = await versionBody(id);
    if (!material) return reply.code(404).send({ error: "knowledge_document_not_found" });
    return reply
      .header("Content-Type", material.mediaType)
      .header("Content-Disposition", `attachment; filename="${material.fileName.replace(/[^\w.\-]/g, "_")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(material.body);
  });

  /** Asking the library a question. It answers from the published pages only. */
  app.post("/api/v1/membership/knowledge/answers", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const question = text(body(req).question, 500);
    if (!question || question.length < 2) return reply.code(400).send({ error: "knowledge_question_required", message: "请输入要问的问题。" });
    const rows = await sql<{ slug: string; page_type: string; target_name: string | null; track: string | null; body_md: string; coverage: Record<string, unknown> | null }[]>`
      SELECT p.slug, p.page_type, p.target_name, p.track, r.body_md, r.coverage
      FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id = p.id
        AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published'`;
    const candidates: RoutablePage[] = rows.map(row => ({
      slug: row.slug,
      title: row.slug,
      pageType: row.page_type,
      targetName: row.target_name,
      track: row.track,
      bodyMd: row.body_md,
      coverage: {
        analysts: Number(row.coverage?.analysts ?? 0),
        firms: Number(row.coverage?.firms ?? 0),
        reports: Number(row.coverage?.reports ?? 0),
        first_report: (row.coverage?.first_report as string | null) ?? null,
        last_report: (row.coverage?.last_report as string | null) ?? null,
      },
    }));
    const routed = routePages(question, candidates);
    if (!routed.length) return reply.code(404).send({ error: "knowledge_no_coverage", message: TASK_ERRORS.knowledge_no_coverage });
    let answer;
    try { answer = await answerQuestion(question, routed.map(entry => entry.page)); }
    catch { return reply.code(502).send({ error: "knowledge_answer_failed", message: TASK_ERRORS.knowledge_answer_failed }); }
    const known = new Set(candidates.map(page => page.slug));
    const citations = answer.citations.filter(citation => known.has(citation.pageSlug));
    const labels = new Set(citations.map(citation => citation.label));
    // A footnote without a source is dropped rather than left pointing nowhere.
    let bodyText = answer.answer
      .split("\n")
      .filter(line => !/^\[\^[^\]]+\]:/.test(line.trim()))
      .join("\n")
      .replace(/\[\^(\d+)\]/g, (whole, label: string) => labels.has(label) ? whole : "");
    const usedPages = new Set(citations.map(citation => citation.pageSlug));
    for (const citation of citations) {
      const needle = `[^${citation.label}]`;
      const replacement = `[${citation.label}](/knowledge/targets/${citation.pageSlug})`;
      bodyText = bodyText.replaceAll(needle, () => replacement);
    }
    const id = randomUUID();
    await sql`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by) VALUES (${id}, ${question}, ${bodyText}, ${sql.json(citations as never)}, ${sql.json(answer.coverage as never)}, ${sql.json(answer.freshness as never)}, ${sql.json([...usedPages])}, ${user.id})`;
    await sql`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.answer.created', ${sql.json({ question: question.slice(0, 200), pages: [...usedPages] })})`;
    return {
      answer: { id, question, answerMd: bodyText, citations, coverage: answer.coverage, freshness: answer.freshness, pages: [...usedPages], references: routed.map(entry => ({ slug: entry.page.slug, score: entry.score })) },
    };
  });
}
