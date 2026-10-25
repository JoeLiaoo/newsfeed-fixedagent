// The shared library's own addresses. Everything here is employee-only: the account system decides who
// may see the library, and the library decides what it holds.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import type { MemberSession } from "../server.ts";
import { WIKI_QUEUE } from "./queue.ts";
import { answerQuestion } from "./answer.ts";
import { routePages, type RoutableCitation, type RoutablePage } from "./routing.ts";
import { FORMAT_MEDIA_TYPES, freshnessTier, FRESHNESS_LABELS, MAX_WIKI_ATTEMPTS, TASK_ERRORS, maxFileBytes } from "./catalog.ts";
import { DEFAULT_BASE_ID, MAX_BASES, baseSlugOf, ensureDefaultBase, newBaseId, resolveBase } from "./bases.ts";
import { checksum, versionBody } from "./worker.ts";
import { withdrawDocumentPages } from "./publish.ts";
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
  if (!value || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The knowledge base a request works in: the one it names, or the default base. A base that is not
 * there is not worked in: the request is refused rather than answered from another base.
 */
async function baseOf(req: FastifyRequest): Promise<{ id: string; name: string } | null> {
  const raw = typeof req.query === "object" && req.query && "baseId" in req.query ? (req.query as { baseId?: unknown }).baseId : undefined;
  return resolveBase(typeof raw === "string" ? raw : undefined);
}

/** The date a column holds, as the text the pages show. */
function dateText(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

/**
 * Whether an employee may look at what a withdrawn material left behind: the uploader of one of
 * the materials the page was built from, or an administrator. The shared library itself never
 * shows a withdrawn material to anyone else.
 */
async function mayAudit(user: MemberSession, targetKey: string | null): Promise<boolean> {
  if (user.role === "admin") return true;
  if (!targetKey) return false;
  const rows = await sql<{ id: string }[]>`SELECT v.id FROM member_wiki_contributions c JOIN member_wiki_document_versions v ON v.id = c.version_id WHERE c.target_key = ${targetKey} AND v.uploader_id = ${user.id} LIMIT 1`;
  return !!rows[0];
}

export function registerKnowledgeRoutes(app: FastifyInstance, authenticate: Authenticate) {
  /** The knowledge bases of the library: what each of them holds, for the card list. */
  app.get("/api/v1/membership/knowledge/bases", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    await ensureDefaultBase();
    const bases = await sql`
      SELECT b.id, b.name, b.description, b.status, b.created_at AS "createdAt", b.updated_at AS "updatedAt",
        (SELECT count(*)::int FROM member_wiki_documents d WHERE d.base_id = b.id AND d.status = 'active') AS documents,
        (SELECT count(*)::int FROM member_wiki_pages p WHERE p.base_id = b.id AND p.status = 'published') AS pages,
        (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id = t.document_id WHERE d.base_id = b.id AND t.state IN ('queued','running')) AS building,
        (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id = t.document_id WHERE d.base_id = b.id AND t.state = 'failed') AS failed
      FROM member_wiki_bases b
      WHERE b.status = 'active'
      ORDER BY (b.id = ${DEFAULT_BASE_ID}) DESC, b.created_at`;
    return { bases };
  });

  /** A new knowledge base: a named collection of materials with its own pages and its own answers. */
  app.post("/api/v1/membership/knowledge/bases", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const name = text(body(req).name, 80);
    const description = text(body(req).description, 200) ?? "";
    if (!name || name.length < 2) return reply.code(400).send({ error: "knowledge_base_name_required", message: "请填写知识库名称（2–80 字）。" });
    await ensureDefaultBase();
    const existing = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_bases WHERE status = 'active'`;
    if ((existing[0]?.count ?? 0) >= MAX_BASES) return reply.code(409).send({ error: "knowledge_base_limit_reached", message: `知识库数量已达上限（${MAX_BASES} 个）。` });
    const id = newBaseId();
    await sql`INSERT INTO member_wiki_bases(id, name, description, status, created_by) VALUES (${id}, ${name}, ${description}, 'active', ${user.id})`;
    await sql`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.base.created', ${sql.json({ baseId: id, name })})`;
    return reply.code(201).send({ base: { id, name, description, status: "active" } });
  });

  /** One knowledge base: what it is called and when it was last touched. */
  app.get("/api/v1/membership/knowledge/bases/:id", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    await ensureDefaultBase();
    const bases = await sql`SELECT id, name, description, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM member_wiki_bases WHERE id = ${id} AND status = 'active'`;
    if (!bases[0]) return reply.code(404).send({ error: "knowledge_base_not_found" });
    return { base: bases[0] };
  });

  /** What the library holds right now: how much, how current, and what is still open. */
  app.get("/api/v1/membership/knowledge/overview", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const base = await baseOf(req);
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const [counts] = await sql`
      SELECT (SELECT count(*)::int FROM member_wiki_documents WHERE status='active' AND base_id=${base.id}) AS documents,
             (SELECT count(*)::int FROM member_wiki_document_versions v JOIN member_wiki_documents d ON d.id=v.document_id WHERE d.base_id=${base.id}) AS versions,
             (SELECT count(*)::int FROM member_wiki_pages WHERE status='published' AND base_id=${base.id}) AS pages,
             (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id WHERE d.base_id=${base.id} AND t.state='queued') AS queued,
             (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id WHERE d.base_id=${base.id} AND t.state='running') AS running,
             (SELECT count(*)::int FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id WHERE d.base_id=${base.id} AND t.state='failed') AS failed,
             (SELECT count(*)::int FROM member_wiki_quality_issues q JOIN member_wiki_pages p ON p.id=q.page_id WHERE p.base_id=${base.id} AND q.status='open') AS openIssues,
             (SELECT count(*)::int FROM member_wiki_quality_issues q JOIN member_wiki_pages p ON p.id=q.page_id WHERE p.base_id=${base.id} AND q.status='open' AND q.level='P0') AS blockingIssues`;
    const pages = await sql<{ slug: string; coverage: { analysts?: number; last_report?: string | null } | null }[]>`
      SELECT p.slug, r.coverage FROM member_wiki_pages p
      JOIN member_wiki_page_revisions r ON r.page_id = p.id AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published' AND p.base_id=${base.id}`;
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
    const base = await baseOf(req);
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const query = typeof req.query === "object" && req.query && "query" in req.query ? String((req.query as { query?: unknown }).query ?? "").trim() : "";
    const documents = await sql`
      SELECT d.id, d.title, d.status, d.base_id AS "baseId", d.uploader_id AS "uploaderId", u.real_name AS "uploaderName", d.created_at AS "createdAt", d.withdrawn_at AS "withdrawnAt",
        v.id AS "versionId", v.file_name AS "fileName", v.format, v.byte_size AS "byteSize", v.sha256, v.source_author AS "sourceAuthor", v.source_org AS "sourceOrg", v.source_date AS "sourceDate",
        v.extraction_status AS "extractionStatus", v.extraction_note AS "extractionNote", v.version_no AS "versionNo",
        t.state AS "taskState", t.stage AS "taskStage", t.error_code AS "errorCode", t.error_message AS "errorMessage"
      FROM member_wiki_documents d
      JOIN member_users u ON u.id = d.uploader_id
      JOIN LATERAL (SELECT * FROM member_wiki_document_versions v WHERE v.document_id = d.id ORDER BY v.version_no DESC LIMIT 1) v ON true
      LEFT JOIN LATERAL (SELECT * FROM member_wiki_tasks t WHERE t.version_id = v.id ORDER BY t.created_at DESC LIMIT 1) t ON true
      WHERE d.status = 'active' AND d.base_id = ${base.id} AND (${query} = '' OR d.title ILIKE ${`%${query}%`} OR v.file_name ILIKE ${`%${query}%`} OR v.source_org ILIKE ${`%${query}%`})
      ORDER BY d.created_at DESC LIMIT 100`;
    return { documents };
  });

  /** One material with its versions and its builds. */
  app.get("/api/v1/membership/knowledge/documents/:id", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const documents = await sql`SELECT id, title, status, base_id AS "baseId", uploader_id AS "uploaderId", created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM member_wiki_documents WHERE id = ${id}`;
    if (!documents[0]) return reply.code(404).send({ error: "knowledge_document_not_found" });
    // A withdrawn material is no longer part of the shared library: only the uploader and the
    // administrators may still look at what it left behind.
    if (documents[0].status !== "active" && documents[0].uploaderId !== user.id && user.role !== "admin") {
      return reply.code(404).send({ error: "knowledge_document_not_found" });
    }
    const versions = await sql`
      SELECT v.id, v.version_no AS "versionNo", v.file_name AS "fileName", v.format, v.byte_size AS "byteSize", v.sha256, v.source_title AS "sourceTitle", v.source_author AS "sourceAuthor",
        v.source_org AS "sourceOrg", v.source_date AS "sourceDate", v.source_kind AS "sourceKind", v.extraction_status AS "extractionStatus", v.extraction_note AS "extractionNote",
        CASE WHEN v.format = 'markdown' AND v.extraction_status = 'available' THEN convert_from(v.body, 'UTF8') ELSE NULL END AS "bodyMd",
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
    const date = typeof payload.date === "string" ? payload.date.trim() || null : null;
    if (date && !isDate(date)) return reply.code(400).send({ error: "knowledge_date_invalid", message: "材料日期需为真实有效的 YYYY-MM-DD 日期。" });
    if (payload.date !== undefined && payload.date !== null && typeof payload.date !== "string") return reply.code(400).send({ error: "knowledge_date_invalid", message: "材料日期需为真实有效的 YYYY-MM-DD 日期。" });
    const requestedDocument = text(payload.documentId, 64);
    const base = await resolveBase(text(payload.baseId, 64));
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const sha256 = checksum(bytes);

    const admitted = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      const active = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_tasks WHERE uploader_id=${user.id} AND state IN ('queued','running')`;
      if ((active[0]?.count ?? 0) >= 2) return { limited: true as const };
      const recent = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_tasks WHERE uploader_id=${user.id} AND created_at > now() - interval '1 hour'`;
      if ((recent[0]?.count ?? 0) >= 10) return { limited: true as const };

      let documentId = requestedDocument;
      if (documentId) {
        const owned = await tx<{ id: string }[]>`SELECT id FROM member_wiki_documents WHERE id=${documentId} AND status='active' AND base_id=${base.id} AND (uploader_id=${user.id} OR ${user.role === "admin"})`;
        if (!owned[0]) return { forbidden: true as const };
      } else {
        const same = await tx<{ document_id: string }[]>`SELECT v.document_id FROM member_wiki_document_versions v WHERE v.sha256=${sha256} AND v.document_id IN (SELECT id FROM member_wiki_documents WHERE uploader_id=${user.id} AND base_id=${base.id}) LIMIT 1`;
        if (same[0]) {
          const version = await tx<{ id: string; version_no: number }[]>`SELECT id, version_no FROM member_wiki_document_versions WHERE document_id=${same[0].document_id} AND sha256=${sha256} LIMIT 1`;
          return { duplicate: true as const, documentId: same[0].document_id, versionId: version[0]!.id, versionNo: version[0]!.version_no };
        }
        documentId = randomUUID();
        await tx`INSERT INTO member_wiki_documents(id, uploader_id, title, base_id) VALUES (${documentId}, ${user.id}, ${title}, ${base.id})`;
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
      // The material's own contribution leaves the library; the pages it held are written again
      // without it, and a page that held nothing else goes down with it.
      const pages = await withdrawDocumentPages(tx, id);
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, document_id, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.document.withdrawn', ${id}, ${tx.json({ withdrawn: pages.withdrawn, rebuilt: pages.rebuilt })})`;
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
    const base = await baseOf(req);
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const tasks = await sql`
      SELECT t.id, t.stage, t.state, t.attempt_count AS "attemptCount", t.error_code AS "errorCode", t.error_message AS "errorMessage",
        t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.finished_at AS "finishedAt",
        d.id AS "documentId", d.title AS "documentTitle", u.real_name AS "uploaderName", v.version_no AS "versionNo", v.file_name AS "fileName"
      FROM member_wiki_tasks t
      JOIN member_wiki_documents d ON d.id = t.document_id
      JOIN member_wiki_document_versions v ON v.id = t.version_id
      JOIN member_users u ON u.id = t.uploader_id
      WHERE d.base_id = ${base.id}
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
        WHERE id=${id} AND uploader_id=${user.id} AND state='failed' AND attempt_count < ${MAX_WIKI_ATTEMPTS} RETURNING id`;
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
    const base = await baseOf(req);
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const query = typeof req.query === "object" && req.query && "query" in req.query ? String((req.query as { query?: unknown }).query ?? "").trim() : "";
    const type = typeof req.query === "object" && req.query && "type" in req.query ? String((req.query as { type?: unknown }).type ?? "") : "";
    const pages = await sql`
      SELECT p.slug, p.page_type AS "pageType", p.target_type AS "targetType", p.target_name AS "targetName", p.track, p.status, p.updated_at AS "updatedAt",
        r.revision, r.coverage, r.published_at AS "publishedAt",
        (SELECT count(*)::int FROM member_wiki_citations c WHERE c.page_id = p.id AND c.revision = r.revision) AS "citationCount",
        (SELECT count(*)::int FROM member_wiki_quality_issues q WHERE q.page_id = p.id AND q.status='open') AS "issueCount"
      FROM member_wiki_pages p
      JOIN member_wiki_page_revisions r ON r.page_id = p.id AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published' AND p.base_id = ${base.id} AND (${type} = '' OR p.page_type = ${type}) AND (${query} = '' OR p.slug ILIKE ${`%${query}%`} OR p.target_name ILIKE ${`%${query}%`} OR r.body_md ILIKE ${`%${query}%`})
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
      SELECT p.id, p.slug, p.page_type AS "pageType", p.target_type AS "targetType", p.target_name AS "targetName", p.track, p.status, p.target_key AS "targetKey", p.base_id AS "baseId", p.updated_at AS "updatedAt",
        r.revision, r.body_md AS "bodyMd", r.coverage, r.published_at AS "publishedAt"
      FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id = p.id
      WHERE p.slug=${slug} ORDER BY r.revision DESC LIMIT 1`;
    const page = pages[0];
    if (!page) return reply.code(404).send({ error: "knowledge_page_not_found" });
    // A withdrawn page is not part of the shared library any more: the uploader and the
    // administrators may still see that it is gone, nobody else.
    if (page.status !== "published") {
      const auditor = await mayAudit(user, page.targetKey);
      return reply.code(auditor ? 410 : 404).send({
        error: auditor ? "knowledge_page_withdrawn" : "knowledge_page_not_found",
        message: auditor ? TASK_ERRORS.knowledge_page_withdrawn : undefined,
      });
    }
    const citations = await sql`
      SELECT c.label, c.anchor, c.analyst, c.organization, to_char(c.published_on, 'YYYY-MM-DD') AS "publishedOn", c.source_title AS "sourceTitle", v.id AS "versionId", v.file_name AS "fileName", v.format, d.id AS "documentId", d.title AS "documentTitle"
      FROM member_wiki_citations c JOIN member_wiki_document_versions v ON v.id = c.version_id JOIN member_wiki_documents d ON d.id = v.document_id
      WHERE c.page_id=${page.id} AND c.revision=${page.revision} ORDER BY c.label, c.created_at`;
    const related = await sql<{ slug: string; targetName: string | null }[]>`
      SELECT slug, target_name AS "targetName" FROM member_wiki_pages
      WHERE base_id=${page.baseId} AND status='published'`;
    const knownRelated = new Set(related.flatMap(item => [item.slug, baseSlugOf(item.slug, page.baseId)]));
    const storedIssues = await sql<{ level: string; category: string; target: string | null; message: string; evidence: string | null; detectedAt: string }[]>`
      SELECT level, category, target, message, evidence, detected_at AS "detectedAt"
      FROM member_wiki_quality_issues WHERE page_id=${page.id} AND status='open' ORDER BY level, detected_at DESC`;
    const issues = storedIssues.filter(issue => {
      if (issue.category !== "related-target-missing") return true;
      const slug = /Related Pages 指向不存在的页面：(.+?)。?$/.exec(issue.message)?.[1];
      return !slug || !knownRelated.has(slug);
    });
    const tier = freshnessTier(page.coverage?.last_report ?? null);
    return { page: { ...page, freshness: tier, freshnessLabel: FRESHNESS_LABELS[tier] }, citations, issues,
      related: related.map(item => ({ ...item, localSlug: baseSlugOf(item.slug, page.baseId) })) };
  });

  /** The original material, for an employee who may see it. */
  app.get("/api/v1/membership/knowledge/versions/:id/original", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const material = await versionBody(id);
    if (!material) return reply.code(404).send({ error: "knowledge_document_not_found" });
    // The bytes of a withdrawn material are kept for the audit; the shared library does not serve
    // them to anybody else.
    if (material.documentStatus !== "active") {
      const auditor = material.uploaderId === user.id || user.role === "admin";
      return reply.code(auditor ? 410 : 404).send({
        error: auditor ? "knowledge_document_withdrawn" : "knowledge_document_not_found",
        message: auditor ? TASK_ERRORS.knowledge_document_withdrawn : undefined,
      });
    }
    return reply
      .header("Content-Type", material.mediaType)
      .header("Content-Disposition", `attachment; filename="${material.fileName.replace(/[^\w.\-]/g, "_")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(material.body);
  });

  app.get("/api/v1/membership/knowledge/answers", async (_req, reply) => {
    noStore(reply);
    return reply.code(405).header("Allow", "POST").send({ error: "method_not_allowed", message: "请在知识库页面提交问题。" });
  });

  /** Asking the library a question. It answers from the published pages only. */
  app.post("/api/v1/membership/knowledge/answers", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const question = text(body(req).question, 500);
    if (!question || question.length < 2) return reply.code(400).send({ error: "knowledge_question_required", message: "请输入要问的问题。" });
    const base = await resolveBase(text(body(req).baseId, 64));
    if (!base) return reply.code(404).send({ error: "knowledge_base_not_found" });
    const rows = await sql<{ id: string; slug: string; page_type: string; target_name: string | null; track: string | null; body_md: string; coverage: Record<string, unknown> | null; revision_id: string }[]>`
      SELECT p.id, p.slug, p.page_type, p.target_name, p.track, r.body_md, r.coverage, r.id AS revision_id
      FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id = p.id
        AND r.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.status='published' AND p.base_id = ${base.id}`;
    const citationRows = await sql<{ id: string; page_id: string; label: string; anchor: string | null; analyst: string | null; organization: string | null; published_on: Date | null; source_title: string | null; version_id: string }[]>`
      SELECT c.id, c.page_id, c.label, c.anchor, c.analyst, c.organization, c.published_on, c.source_title, c.version_id
      FROM member_wiki_citations c JOIN member_wiki_pages p ON p.id = c.page_id
      WHERE p.status='published' AND p.base_id = ${base.id}
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
    if (!routed.length) return reply.code(422).send({ error: "knowledge_no_coverage", message: TASK_ERRORS.knowledge_no_coverage });
    let answer;
    try { answer = await answerQuestion(question, routed.map(entry => entry.page)); }
    catch (error) {
      const code = error instanceof Error && error.message === "knowledge_answer_unverified" ? "knowledge_answer_unverified" : "knowledge_answer_failed";
      // An answer the library cannot check is not an upstream failure: the request was understood, the
      // answer was refused. A model that could not be reached stays a gateway failure.
      return reply.code(code === "knowledge_answer_unverified" ? 422 : 502).send({ error: code, message: TASK_ERRORS[code] });
    }
    const citations = answer.citations;
    // An answer that rests on nothing the library can show is not an answer: it is refused.
    if (!citations.length) return reply.code(422).send({ error: "knowledge_answer_unverified", message: TASK_ERRORS.knowledge_answer_unverified });
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
      await tx`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by) VALUES (${id}, ${question}, ${bodyText}, ${tx.json(citations as never)}, ${tx.json(answer.coverage as never)}, ${tx.json(answer.freshness as never)}, ${tx.json([...usedPages])}, ${user.id})`;
      await tx`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, detail) VALUES (${randomUUID()}, ${user.id}, 'knowledge.answer.created', ${tx.json({ question: question.slice(0, 200), pages: [...usedPages] })})`;
      return true;
    });
    if (!saved) return reply.code(409).send({ error: "knowledge_answer_unverified", message: "知识页已更新或撤回，请重新提问。" });
    return {
      answer: { id, question, answerMd: bodyText, citations, coverage: answer.coverage, freshness: answer.freshness, pages: [...usedPages], references: routed.map(entry => ({ slug: entry.page.slug, score: entry.score })) },
    };
  });
}
