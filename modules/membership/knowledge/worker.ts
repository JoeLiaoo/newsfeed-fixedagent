// The build of a knowledge page, stage by stage. Every stage leaves a checkpoint on the task, so a
// failed build can be resumed from where it stopped and a new version of a material never takes the
// published pages down with it. A build only writes while it still holds the task: a material that
// was withdrawn, or a lease that was lost to another worker, stops the build where it stands.
import { createHash, randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { ModelOutputError, ModelUnavailableError } from "@aihot/backend/providers/receipts";
import { compileMaterial, auditMaterial, type MaterialInput } from "./compile.ts";
import { applyCorrections, coverageOf } from "./render.ts";
import { lintDraft, blockingFindings } from "./lint.ts";
import { capExtraction, detectFormat, extractMaterial } from "./extract.ts";
import { publishBuildPages } from "./publish.ts";
import { DEFAULT_BASE_ID, baseSlugOf } from "./bases.ts";
import { compiledDraftSchema, auditResultSchema, type AuditResult, type CompiledDraft, type Finding } from "./schema.ts";
import { MAX_EXTRACTED_CHARS, MAX_WIKI_ATTEMPTS, TASK_ERRORS } from "./catalog.ts";

type TaskRow = {
  id: string;
  document_id: string;
  version_id: string;
  uploader_id: string;
  /** The base of the material this task builds. */
  base_id: string;
  stage: string;
  attempt_count: number;
  draft: CompiledDraft | null;
  audit: unknown;
};

type VersionRow = {
  id: string;
  document_id: string;
  version_no: number;
  file_name: string;
  body: Buffer;
  source_title: string | null;
  source_author: string | null;
  source_org: string | null;
  source_date: string | null;
  source_kind: string | null;
  extracted_text: string | null;
  extraction_status: string;
};

function failureCode(error: unknown): { code: string; message: string } {
  if (error instanceof ModelUnavailableError) return { code: "knowledge_model_failed", message: TASK_ERRORS.knowledge_model_failed };
  if (error instanceof ModelOutputError) return { code: "knowledge_model_output_invalid", message: TASK_ERRORS.knowledge_model_output_invalid };
  const code = error instanceof Error ? error.message : "knowledge_model_failed";
  if (code === "knowledge_text_unavailable" || code === "knowledge_file_unreadable") return { code, message: "未能读取材料内容，未生成知识页。" };
  if (code === "knowledge_text_empty") return { code, message: TASK_ERRORS.knowledge_text_empty };
  if (code === "knowledge_audit_failed") return { code, message: TASK_ERRORS.knowledge_audit_failed };
  if (code === "knowledge_audit_invalid") return { code, message: TASK_ERRORS.knowledge_audit_invalid };
  if (code === "knowledge_lint_blocked") return { code, message: TASK_ERRORS.knowledge_lint_blocked };
  if (code === "knowledge_publish_stale") return { code, message: TASK_ERRORS.knowledge_publish_stale };
  if (code === "knowledge_document_withdrawn") return { code, message: TASK_ERRORS.knowledge_document_withdrawn };
  if (code === "knowledge_lease_lost") return { code, message: TASK_ERRORS.knowledge_lease_lost };
  return { code: "knowledge_model_failed", message: TASK_ERRORS.knowledge_model_failed };
}

/** The date a column holds, as the text the pages show. */
function dateText(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  const rows = await sql<TaskRow[]>`SELECT t.id, t.document_id, t.version_id, t.uploader_id, t.stage, t.attempt_count, t.draft, t.audit, d.base_id
    FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id = t.document_id WHERE t.id = ${taskId}`;
  return rows[0] ?? null;
}

async function loadVersion(versionId: string): Promise<VersionRow | null> {
  const rows = await sql<VersionRow[]>`SELECT id, document_id, version_no, file_name, body, source_title, source_author, source_org, source_date, source_kind, extracted_text, extraction_status FROM member_wiki_document_versions WHERE id = ${versionId}`;
  return rows[0] ?? null;
}

/**
 * Moves the build to its next stage. The stage only moves while this worker still holds the task:
 * a build whose material was withdrawn, or whose lease went to another worker, stops here.
 */
async function advanceStage(taskId: string, leaseToken: string, stage: string): Promise<void> {
  const rows = await sql<{ id: string }[]>`UPDATE member_wiki_tasks SET stage=${stage}, updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken} RETURNING id`;
  if (!rows.length) throw new Error("knowledge_lease_lost");
}

/** Keeps a checkpoint of the build. A checkpoint that cannot be written means the build is not ours. */
async function saveCheckpoint(taskId: string, leaseToken: string, field: "draft" | "audit", value: unknown): Promise<void> {
  const rows = field === "draft"
    ? await sql<{ id: string }[]>`UPDATE member_wiki_tasks SET draft=${sql.json(value as never)}, updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken} RETURNING id`
    : await sql<{ id: string }[]>`UPDATE member_wiki_tasks SET audit=${sql.json(value as never)}, updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken} RETURNING id`;
  if (!rows.length) throw new Error("knowledge_lease_lost");
}

/** Reads the material out and keeps the text on the version, so a retry does not read the file again. */
async function extractVersion(version: VersionRow): Promise<string> {
  if (version.extraction_status === "available" && version.extracted_text) return version.extracted_text;
  const format = detectFormat(version.file_name, version.body);
  if (!format) throw new Error("knowledge_file_type_unsupported");
  const result = await extractMaterial(format, version.body);
  if (result.status === "unavailable") {
    await sql`UPDATE member_wiki_document_versions SET extraction_status='unavailable', extraction_note=${result.note} WHERE id=${version.id}`;
    throw new Error("knowledge_text_unavailable");
  }
  const capped = capExtraction(result, MAX_EXTRACTED_CHARS);
  // A build without text has nothing to compile; it fails here rather than asking a model to read
  // an empty material.
  if (!capped.text.trim()) throw new Error("knowledge_text_empty");
  const note = [result.note, capped.truncated ? `内容超出上限，已截取前 ${capped.sections.length} 节（末节可能不完整）` : null].filter(Boolean).join("；") || null;
  await sql`UPDATE member_wiki_document_versions SET extracted_text=${capped.text}, extraction_status='available', extraction_note=${note} WHERE id=${version.id}`;
  return capped.text;
}

function materialInput(task: TaskRow, version: VersionRow, text: string): MaterialInput {
  return {
    versionId: version.id,
    title: version.source_title ?? version.file_name,
    fileName: version.file_name,
    declared: {
      author: version.source_author,
      organization: version.source_org,
      date: dateText(version.source_date),
      kind: version.source_kind,
    },
    text,
  };
}

async function recordEvent(event: {
  actorId: string | null;
  eventType: string;
  documentId?: string | null;
  versionId?: string | null;
  taskId?: string | null;
  pageId?: string | null;
  detail?: Record<string, unknown>;
}) {
  await sql`INSERT INTO member_wiki_audit_events(id, actor_id, event_type, document_id, version_id, task_id, page_id, detail)
    VALUES (${randomUUID()}, ${event.actorId}, ${event.eventType}, ${event.documentId ?? null}, ${event.versionId ?? null}, ${event.taskId ?? null}, ${event.pageId ?? null}, ${sql.json((event.detail ?? {}) as never)})`;
}

/** The slugs the library already holds, so a page may point at what exists. Only the base's own
 *  pages count: a page of another base is not a page this build may point at. */
async function knownSlugs(baseId: string, exclude: string[] = []): Promise<Set<string>> {
  const rows = await sql<{ slug: string }[]>`SELECT slug FROM member_wiki_pages WHERE base_id = ${baseId}`;
  return new Set(rows.map(row => baseSlugOf(row.slug, baseId)).filter(slug => !exclude.includes(slug)));
}

/**
 * Publishes the pages of a build. The material's own contribution and the page it belongs to are
 * written in one transaction, and only while this worker still holds the task: the material must
 * still be in the library, the task must still be running with this worker's lease, and no newer
 * version of the same material may have been published already.
 */
async function publish(task: TaskRow, version: VersionRow, draft: CompiledDraft, findings: Finding[], leaseToken: string): Promise<Array<{ pageId: string; slug: string }>> {
  const pages: Array<{ pageId: string; slug: string }> = [];
  await sql.begin(async tx => {
    // The locks are taken in one order everywhere: the material first, then the task.
    const documents = await tx<{ id: string; status: string; base_id: string }[]>`SELECT id, status, base_id FROM member_wiki_documents WHERE id=${version.document_id} FOR UPDATE`;
    const document = documents[0];
    if (!document) throw new Error("knowledge_document_not_found");
    if (document.status !== "active") throw new Error("knowledge_document_withdrawn");
    const baseId = document.base_id || DEFAULT_BASE_ID;
    const tasks = await tx<{ id: string; state: string; lease_token: string | null; lease_expires_at: Date | null }[]>`SELECT id, state, lease_token, lease_expires_at FROM member_wiki_tasks WHERE id=${task.id} FOR UPDATE`;
    const running = tasks[0];
    if (!running) throw new Error("knowledge_task_not_found");
    if (running.state !== "running") throw new Error("knowledge_lease_lost");
    if (!running.lease_token || running.lease_token !== leaseToken) throw new Error("knowledge_lease_lost");
    if (!running.lease_expires_at || running.lease_expires_at.getTime() <= Date.now()) throw new Error("knowledge_lease_lost");
    // A newer version of this material was published already: this build is out of date and may not
    // take the page back to what it knows.
    const newer = await tx<{ version_id: string }[]>`SELECT t.version_id FROM member_wiki_tasks t JOIN member_wiki_document_versions v ON v.id=t.version_id WHERE t.document_id=${version.document_id} AND t.state='succeeded' AND v.version_no > ${version.version_no} LIMIT 1`;
    if (newer[0]) throw new Error("knowledge_publish_stale");
    const written = await publishBuildPages(tx, {
      taskId: task.id,
      versionId: version.id,
      documentId: version.document_id,
      versionNo: version.version_no,
      baseId,
      draft,
      findings,
      attribution: [version.source_org, dateText(version.source_date)].filter(Boolean).join(" ") || null,
      materialTitle: version.source_title ?? version.file_name,
    });
    for (const page of written) pages.push({ pageId: page.pageId, slug: page.slug });
    const finished = await tx<{ id: string }[]>`UPDATE member_wiki_tasks SET state='succeeded', stage='published', updated_at=now(), finished_at=now(), error_code=NULL, error_message=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=${task.id} AND state='running' AND lease_token=${leaseToken} RETURNING id`;
    if (!finished.length) throw new Error("knowledge_lease_lost");
  });
  return pages;
}

/** The review of a checkpointed build, read again. A checkpoint that no longer parses is not a review. */
function readAuditCheckpoint(value: unknown): AuditResult {
  const parsed = auditResultSchema.safeParse(value);
  if (!parsed.success) throw new Error("knowledge_audit_invalid");
  return parsed.data;
}

/** Runs one build. A failure leaves the task failed with a code the page can show, and the pages that were published before stay. */
export async function runWikiTask(taskId: string): Promise<void> {
  const leaseToken = randomUUID();
  const started = await sql<TaskRow[]>`UPDATE member_wiki_tasks t SET state='running', stage='extracting', updated_at=now(), lease_token=${leaseToken}, lease_expires_at=now() + interval '5 minutes', attempt_count=attempt_count+1, last_attempt_at=now(), error_code=NULL, error_message=NULL
    FROM member_wiki_documents d
    WHERE t.id=${taskId} AND d.id=t.document_id AND t.state='queued' AND t.attempt_count < ${MAX_WIKI_ATTEMPTS}
    RETURNING t.id, t.document_id, t.version_id, t.uploader_id, t.stage, t.attempt_count, t.draft, t.audit, d.base_id`;
  const task = started[0];
  if (!task) return;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void sql`UPDATE member_wiki_tasks SET updated_at=now(), lease_expires_at=now() + interval '5 minutes' WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken} RETURNING id`
      .then(rows => { if (!rows.length) leaseLost = true; })
      .catch(() => { leaseLost = true; });
  }, 30_000);
  heartbeat.unref?.();
  try {
    const version = await loadVersion(task.version_id);
    if (!version) throw new Error("knowledge_document_not_found");
    const text = await extractVersion(version);
    await advanceStage(taskId, leaseToken, "compiling");

    let draft = task.draft ? compiledDraftSchema.parse(task.draft) : null;
    if (!draft) {
      draft = await compileMaterial(materialInput(task, version, text));
      await saveCheckpoint(taskId, leaseToken, "draft", draft);
    }
    await advanceStage(taskId, leaseToken, "auditing");

    const audit = task.audit ? readAuditCheckpoint(task.audit) : await auditMaterial(materialInput(task, version, text), draft);
    await saveCheckpoint(taskId, leaseToken, "audit", audit);

    const corrected = applyCorrections(draft, audit.corrections);
    await advanceStage(taskId, leaseToken, "linting");

    const slugs = await knownSlugs(task.base_id || DEFAULT_BASE_ID, corrected.draft.pages.map(page => page.slug));
    const findings = [...audit.findings, ...corrected.findings, ...lintDraft(corrected.draft, slugs)];
    if (audit.verdict === "fail") throw new Error("knowledge_audit_failed");
    if (blockingFindings(findings).length) throw new Error("knowledge_lint_blocked");

    await advanceStage(taskId, leaseToken, "publishing");
    const pages = await publish(task, version, corrected.draft, findings, leaseToken);
    await recordEvent({
      actorId: task.uploader_id,
      eventType: "knowledge.build.published",
      documentId: task.document_id,
      versionId: task.version_id,
      taskId: task.id,
      pageId: pages[0]?.pageId ?? null,
      detail: { pages: pages.length, slugs: pages.map(page => page.slug), findings: findings.length, coverage: corrected.draft.pages.map(page => coverageOf(page)) },
    });
  } catch (error) {
    const failure = failureCode(error);
    // The task is only marked failed while this worker still holds it; a build that lost the task
    // to a withdrawal or to another worker leaves the task to whoever holds it now.
    const owned = await sql<{ id: string }[]>`UPDATE member_wiki_tasks SET state='failed', stage='failed', error_code=${failure.code}, error_message=${failure.message}, updated_at=now(), finished_at=now(), lease_token=NULL, lease_expires_at=NULL WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken} RETURNING id`;
    if (!owned.length || leaseLost) return;
    await recordEvent({ actorId: task.uploader_id, eventType: "knowledge.build.failed", documentId: task.document_id, versionId: task.version_id, taskId: task.id, detail: { code: failure.code } });
  } finally {
    clearInterval(heartbeat);
  }
}

/** Puts a build whose worker stopped back on the queue, at the stage it had reached. */
export async function recoverWikiTasks(enqueue: (taskId: string, tx: Db) => Promise<unknown>): Promise<{ recovered: number }> {
  return sql.begin(async tx => {
    const stale = await tx<{ id: string; state: string }[]>`UPDATE member_wiki_tasks SET
      state=CASE WHEN attempt_count < ${MAX_WIKI_ATTEMPTS} THEN 'queued' ELSE 'failed' END,
      stage=CASE WHEN attempt_count < ${MAX_WIKI_ATTEMPTS} THEN 'queued' ELSE 'failed' END,
      error_code=CASE WHEN attempt_count < ${MAX_WIKI_ATTEMPTS} THEN NULL ELSE 'knowledge_retry_exhausted' END,
      error_message=CASE WHEN attempt_count < ${MAX_WIKI_ATTEMPTS} THEN NULL ELSE ${TASK_ERRORS.knowledge_retry_exhausted} END,
      updated_at=now(), finished_at=CASE WHEN attempt_count < ${MAX_WIKI_ATTEMPTS} THEN NULL ELSE now() END,
      lease_token=NULL, lease_expires_at=NULL
      WHERE state='running' AND lease_expires_at < now() RETURNING id,state`;
    const queued = stale.filter(row => row.state === "queued");
    for (const row of queued) await enqueue(row.id, tx);
    return { recovered: queued.length };
  });
}

/** The bytes of an original material, with the state of the material they belong to. */
export async function versionBody(versionId: string): Promise<{
  body: Buffer;
  fileName: string;
  mediaType: string;
  sha256: string;
  documentId: string;
  documentStatus: string;
  uploaderId: string;
} | null> {
  const rows = await sql<{ body: Buffer; file_name: string; media_type: string; sha256: string; document_id: string; document_status: string; uploader_id: string }[]>`
    SELECT v.body, v.file_name, v.media_type, v.sha256, v.document_id, d.status AS document_status, d.uploader_id
    FROM member_wiki_document_versions v JOIN member_wiki_documents d ON d.id = v.document_id WHERE v.id = ${versionId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    body: row.body,
    fileName: row.file_name,
    mediaType: row.media_type,
    sha256: row.sha256,
    documentId: row.document_id,
    documentStatus: row.document_status,
    uploaderId: row.uploader_id,
  };
}

/** The checksum of an upload, so the same material is recognised when it comes again. */
export function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
