// The build of a knowledge page, stage by stage. Every stage leaves a checkpoint on the task, so a
// failed build can be resumed from where it stopped and a new version of a material never takes the
// published pages down with it.
import { createHash, randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { ModelOutputError, ModelUnavailableError } from "@aihot/backend/providers/receipts";
import { compileMaterial, auditMaterial, type MaterialInput } from "./compile.ts";
import { applyCorrections, coverageOf, renderPage, type SourceRecord } from "./render.ts";
import { lintDraft, blockingFindings } from "./lint.ts";
import { capExtraction, detectFormat, extractMaterial } from "./extract.ts";
import { compiledDraftSchema, auditResultSchema, type CompiledDraft, type Finding } from "./schema.ts";
import { MAX_EXTRACTED_CHARS } from "./catalog.ts";

type TaskRow = {
  id: string;
  document_id: string;
  version_id: string;
  uploader_id: string;
  stage: string;
  attempt_count: number;
  draft: CompiledDraft | null;
  audit: unknown;
};

type VersionRow = {
  id: string;
  document_id: string;
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
  if (error instanceof ModelUnavailableError) return { code: "knowledge_model_failed", message: "模型服务不可用，构建未完成，可重试。" };
  if (error instanceof ModelOutputError) return { code: "knowledge_model_output_invalid", message: "模型输出无法解析，构建未完成，可重试。" };
  const code = error instanceof Error ? error.message : "knowledge_model_failed";
  if (code === "knowledge_text_unavailable" || code === "knowledge_file_unreadable") return { code, message: "未能读取材料内容，未生成知识页。" };
  if (code === "knowledge_audit_failed") return { code, message: "独立复核未通过，未发布任何页面，可重试。" };
  if (code === "knowledge_lint_blocked") return { code, message: "结构与引用检查未通过，未发布任何页面，可重试。" };
  return { code: "knowledge_model_failed", message: "构建未完成，可重试。" };
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  const rows = await sql<TaskRow[]>`SELECT id, document_id, version_id, uploader_id, stage, attempt_count, draft, audit FROM member_wiki_tasks WHERE id = ${taskId}`;
  return rows[0] ?? null;
}

async function loadVersion(versionId: string): Promise<VersionRow | null> {
  const rows = await sql<VersionRow[]>`SELECT id, document_id, file_name, body, source_title, source_author, source_org, source_date, source_kind, extracted_text, extraction_status FROM member_wiki_document_versions WHERE id = ${versionId}`;
  return rows[0] ?? null;
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
  const note = [result.note, capped.truncated ? `内容超出上限，已截取前 ${capped.sections.length} 节` : null].filter(Boolean).join("；") || null;
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
      date: version.source_date,
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

/** The slugs the library already holds, so a page may point at what exists. */
async function knownSlugs(exclude: string[] = []): Promise<Set<string>> {
  const rows = await sql<{ slug: string }[]>`SELECT slug FROM member_wiki_pages`;
  return new Set(rows.map(row => row.slug).filter(slug => !exclude.includes(slug)));
}

/**
 * Publishes the pages of a build. Each page becomes a new revision of the page with the same slug; the
 * pages published before stay readable, and the whole set is written in one transaction.
 */
async function publish(task: TaskRow, version: VersionRow, draft: CompiledDraft, findings: Finding[]): Promise<string[]> {
  const pageIds: string[] = [];
  await sql.begin(async tx => {
    for (const page of draft.pages) {
      const rendered = renderPage(page, draft.sources as SourceRecord[], version.document_id);
      const existing = await tx<{ id: string }[]>`SELECT id FROM member_wiki_pages WHERE slug = ${page.slug} FOR UPDATE`;
      let pageId = existing[0]?.id;
      let revision = 1;
      if (pageId) {
        const latest = await tx<{ revision: number }[]>`SELECT max(revision) AS revision FROM member_wiki_page_revisions WHERE page_id = ${pageId}`;
        revision = (latest[0]?.revision ?? 0) + 1;
        await tx`UPDATE member_wiki_pages SET status='published', updated_at=now(), page_type=${page.pageType}, target_type=${page.targetType}, target_name=${page.targetName}, track=${page.track} WHERE id=${pageId}`;
      } else {
        pageId = randomUUID();
        await tx`INSERT INTO member_wiki_pages(id, slug, page_type, target_type, target_name, track, status) VALUES (${pageId}, ${page.slug}, ${page.pageType}, ${page.targetType}, ${page.targetName}, ${page.track}, 'published')`;
      }
      await tx`INSERT INTO member_wiki_page_revisions(id, page_id, revision, body_md, coverage, task_id, version_id) VALUES (${randomUUID()}, ${pageId}, ${revision}, ${rendered.bodyMd}, ${tx.json(rendered.coverage as never)}, ${task.id}, ${version.id})`;
      const byRef = new Map((draft.sources as SourceRecord[]).map(source => [source.ref, source]));
      const citations = new Map<string, { ref: string; analyst: string | null; organization: string | null; publishedOn: string | null }>();
      for (const stance of page.stances) {
        if (!stance.sourceRef) continue;
        const key = `${stance.sourceRef}|${stance.analyst}|${stance.institution}|${stance.date}`;
        citations.set(key, {
          ref: stance.sourceRef,
          analyst: stance.analyst || null,
          organization: stance.institution || null,
          publishedOn: /^\d{4}-\d{2}-\d{2}$/.test(stance.date) ? stance.date : null,
        });
      }
      for (const entry of page.timeline) {
        for (const ref of entry.sourceRefs ?? []) {
          if ([...citations.values()].some(citation => citation.ref === ref)) continue;
          const source = byRef.get(ref);
          citations.set(`${ref}||`, { ref, analyst: null, organization: source?.institution ?? null, publishedOn: source?.date ?? null });
        }
      }
      // A page that quotes no viewpoint still rests on the material it was compiled from.
      if (!citations.size) {
        for (const source of byRef.values()) {
          citations.set(`${source.ref}||`, { ref: source.ref, analyst: null, organization: source.institution ?? null, publishedOn: source.date ?? null });
        }
      }
      for (const citation of citations.values()) {
        const source = byRef.get(citation.ref);
        await tx`INSERT INTO member_wiki_citations(id, page_id, revision, version_id, label, anchor, analyst, organization, published_on, source_title)
          VALUES (${randomUUID()}, ${pageId}, ${revision}, ${version.id}, ${citation.ref}, ${source?.dateBasis ?? null}, ${citation.analyst}, ${citation.organization}, ${citation.publishedOn}, ${source?.institution ?? version.source_title})`;
      }
      for (const finding of findings.filter(item => item.target === page.slug || item.target?.startsWith(`${page.slug}#`))) {
        await tx`INSERT INTO member_wiki_quality_issues(id, page_id, level, category, target, message, evidence, status) VALUES (${randomUUID()}, ${pageId}, ${finding.level}, ${finding.category}, ${finding.target}, ${finding.message}, ${finding.evidence}, 'open')`;
      }
      pageIds.push(pageId);
    }
    await tx`UPDATE member_wiki_tasks SET state='succeeded', stage='published', updated_at=now(), finished_at=now(), error_code=NULL, error_message=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=${task.id}`;
  });
  return pageIds;
}

/** Runs one build. A failure leaves the task failed with a code the page can show, and the pages that were published before stay. */
export async function runWikiTask(taskId: string): Promise<void> {
  const leaseToken = randomUUID();
  const started = await sql<TaskRow[]>`UPDATE member_wiki_tasks SET state='running', stage='extracting', updated_at=now(), lease_token=${leaseToken}, lease_expires_at=now() + interval '5 minutes', attempt_count=attempt_count+1, last_attempt_at=now(), error_code=NULL, error_message=NULL
    WHERE id=${taskId} AND state='queued' RETURNING id, document_id, version_id, uploader_id, stage, attempt_count, draft, audit`;
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
    await sql`UPDATE member_wiki_tasks SET stage='compiling', updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;

    let draft = task.draft ? compiledDraftSchema.parse(task.draft) : null;
    if (!draft) {
      draft = await compileMaterial(materialInput(task, version, text));
      await sql`UPDATE member_wiki_tasks SET draft=${sql.json(draft as never)}, updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;
    }
    await sql`UPDATE member_wiki_tasks SET stage='auditing', updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;

    const audit = task.audit ? auditResultSchema.parse(task.audit) : await auditMaterial(materialInput(task, version, text), draft);
    await sql`UPDATE member_wiki_tasks SET audit=${sql.json(audit as never)}, updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;

    const corrected = applyCorrections(draft, audit.corrections);
    await sql`UPDATE member_wiki_tasks SET stage='linting', updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;

    const slugs = await knownSlugs(corrected.draft.pages.map(page => page.slug));
    const findings = [...audit.findings, ...corrected.findings, ...lintDraft(corrected.draft, slugs)];
    if (audit.verdict === "fail") throw new Error("knowledge_audit_failed");
    if (blockingFindings(findings).length) throw new Error("knowledge_lint_blocked");

    await sql`UPDATE member_wiki_tasks SET stage='publishing', updated_at=now() WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;
    const pageIds = await publish(task, version, corrected.draft, findings);
    await recordEvent({
      actorId: task.uploader_id,
      eventType: "knowledge.build.published",
      documentId: task.document_id,
      versionId: task.version_id,
      taskId: task.id,
      pageId: pageIds[0] ?? null,
      detail: { pages: pageIds.length, slugs: corrected.draft.pages.map(page => page.slug), findings: findings.length, coverage: corrected.draft.pages.map(page => coverageOf(page)) },
    });
  } catch (error) {
    const failure = failureCode(error);
    if (!leaseLost) {
      await sql`UPDATE member_wiki_tasks SET state='failed', stage='failed', error_code=${failure.code}, error_message=${failure.message}, updated_at=now(), finished_at=now(), lease_token=NULL, lease_expires_at=NULL WHERE id=${taskId} AND state='running' AND lease_token=${leaseToken}`;
      await recordEvent({ actorId: task.uploader_id, eventType: "knowledge.build.failed", documentId: task.document_id, versionId: task.version_id, taskId: task.id, detail: { code: failure.code } });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/** Puts a build whose worker stopped back on the queue, at the stage it had reached. */
export async function recoverWikiTasks(enqueue: (taskId: string, tx: Db) => Promise<unknown>): Promise<{ recovered: number }> {
  return sql.begin(async tx => {
    const stale = await tx<{ id: string }[]>`UPDATE member_wiki_tasks SET state='queued', stage='queued', error_code=NULL, error_message=NULL, updated_at=now(), finished_at=NULL, lease_token=NULL, lease_expires_at=NULL
      WHERE state='running' AND lease_expires_at < now() RETURNING id`;
    for (const row of stale) await enqueue(row.id, tx);
    return { recovered: stale.length };
  });
}

/** The bytes of an original material, for the authorized download. */
export async function versionBody(versionId: string): Promise<{ body: Buffer; fileName: string; mediaType: string; sha256: string } | null> {
  const rows = await sql<{ body: Buffer; file_name: string; media_type: string; sha256: string }[]>`SELECT body, file_name, media_type, sha256 FROM member_wiki_document_versions WHERE id = ${versionId}`;
  const row = rows[0];
  if (!row) return null;
  return { body: row.body, fileName: row.file_name, mediaType: row.media_type, sha256: row.sha256 };
}

/** The checksum of an upload, so the same material is recognised when it comes again. */
export function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
