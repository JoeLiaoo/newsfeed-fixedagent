// Writing a page into the library. A material keeps its own structured contribution under the
// target's stable id, and the page of that target is the aggregate of the contributions that are
// still active. Everything here runs inside the caller's transaction: a build either writes its
// whole contribution and the page it belongs to, or writes nothing at all.
import { randomUUID } from "node:crypto";
import type { Tx } from "@aihot/backend/db";
import { aggregateContributions, targetKeyOf, type Contribution } from "./aggregate.ts";
import { renderPage } from "./render.ts";
import type { CompiledDraft, Finding, PageDraft, SourceRecord } from "./schema.ts";

export type ContributionRow = {
  versionId: string;
  documentId: string;
  versionNo: number;
  createdAt: string;
  taskId: string | null;
  targetKey: string;
  slug: string;
  page: PageDraft;
  sources: SourceRecord[];
  attribution: string | null;
  materialTitle: string | null;
};

export type WrittenPage = { pageId: string; slug: string; revision: number };

/** A slug nobody holds yet. Two targets that the Builder named the same way stay apart. */
async function freeSlug(tx: Tx, wanted: string, targetKey: string, attempt: number): Promise<string> {
  const base = wanted.trim() || "page";
  const suffix = attempt === 0 ? "" : `-${shortHash(targetKey)}${attempt > 1 ? attempt : ""}`;
  const candidate = `${base}${suffix}`;
  const taken = await tx<{ id: string }[]>`SELECT id FROM member_wiki_pages WHERE slug = ${candidate}`;
  if (!taken[0]) return candidate;
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash.toString(36).slice(0, 6);
}

/** Whether the database refused a row because another one already holds that name. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * The page of a target, locked for the rest of the transaction. Two builds of two materials about
 * the same target take turns here, so neither of them writes the page without the other's material.
 */
async function lockPage(tx: Tx, page: PageDraft, targetKey: string): Promise<{ id: string; slug: string }> {
  const existing = await tx<{ id: string; slug: string }[]>`SELECT id, slug FROM member_wiki_pages WHERE target_key = ${targetKey} FOR UPDATE`;
  if (existing[0]) return existing[0];
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = await freeSlug(tx, page.slug, targetKey, attempt);
    let inserted: Array<{ id: string }> = [];
    try {
      // The savepoint keeps a name that is already taken from taking the whole build down.
      inserted = await tx.savepoint(async sp => sp<{ id: string }[]>`
        INSERT INTO member_wiki_pages(id, slug, page_type, target_type, target_name, track, status, target_key)
        VALUES (${randomUUID()}, ${slug}, ${page.pageType}, ${page.targetType}, ${page.targetName}, ${page.track}, 'published', ${targetKey})
        ON CONFLICT (target_key) WHERE target_key <> '' DO NOTHING RETURNING id`);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }
    if (inserted[0]) return { id: inserted[0].id, slug };
    const raced = await tx<{ id: string; slug: string }[]>`SELECT id, slug FROM member_wiki_pages WHERE target_key = ${targetKey} FOR UPDATE`;
    if (!raced[0]) throw new Error("knowledge_page_lock_failed");
    return raced[0];
  }
  throw new Error("knowledge_page_slug_conflict");
}

/** The material's own contribution: what this material says about the target, and nothing else. */
async function writeContribution(tx: Tx, contribution: ContributionRow): Promise<void> {
  const stored = { page: contribution.page, sources: contribution.sources, attribution: contribution.attribution, materialTitle: contribution.materialTitle };
  // A build that changed its mind about its pages leaves the pages it no longer holds behind.
  await tx`UPDATE member_wiki_contributions SET status='superseded', updated_at=now() WHERE version_id = ${contribution.versionId} AND status='active'`;
  await tx`
    INSERT INTO member_wiki_contributions(id, target_key, slug, page_type, target_type, target_name, track, document_id, version_id, version_no, task_id, status, contribution)
    VALUES (${randomUUID()}, ${contribution.targetKey}, ${contribution.slug}, ${contribution.page.pageType}, ${contribution.page.targetType}, ${contribution.page.targetName}, ${contribution.page.track}, ${contribution.documentId}, ${contribution.versionId}, ${contribution.versionNo}, ${contribution.taskId}, 'active', ${tx.json(stored as never)})
    ON CONFLICT (version_id, slug) DO UPDATE SET status='active', contribution=${tx.json(stored as never)}, target_key=${contribution.targetKey}, task_id=${contribution.taskId}, updated_at=now()`;
}

/** The contributions of a target that still count: the active ones, of materials still in the library. */
export async function activeContributions(tx: Tx, targetKey: string): Promise<ContributionRow[]> {
  const rows = await tx<{
    version_id: string; document_id: string; version_no: number; created_at: Date; task_id: string | null; slug: string;
    contribution: { page: PageDraft; sources: SourceRecord[]; attribution: string | null; materialTitle: string | null };
  }[]>`SELECT c.version_id, c.document_id, c.version_no, c.created_at, c.task_id, c.slug, c.contribution
    FROM member_wiki_contributions c
    JOIN member_wiki_documents d ON d.id = c.document_id
    WHERE c.target_key = ${targetKey} AND c.status = 'active' AND d.status = 'active'
    ORDER BY c.version_no, c.created_at, c.version_id`;
  return rows.map(row => ({
    versionId: row.version_id,
    documentId: row.document_id,
    versionNo: row.version_no,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    taskId: row.task_id,
    targetKey,
    slug: row.slug,
    page: row.contribution.page,
    sources: row.contribution.sources ?? [],
    attribution: row.contribution.attribution ?? null,
    materialTitle: row.contribution.materialTitle ?? null,
  }));
}

/** Writes the page the contributions add up to, as a new revision. The old revision stays readable. */
async function writeRevision(tx: Tx, page: { id: string; slug: string }, aggregate: ReturnType<typeof aggregateContributions>, meta: { taskId: string | null; versionId: string | null; documentId: string }): Promise<number> {
  const latest = await tx<{ revision: number }[]>`SELECT max(revision) AS revision FROM member_wiki_page_revisions WHERE page_id = ${page.id}`;
  const revision = (latest[0]?.revision ?? 0) + 1;
  const body = { ...aggregate.page, slug: page.slug };
  const rendered = renderPage(body, aggregate.sources, meta.documentId);
  await tx`INSERT INTO member_wiki_page_revisions(id, page_id, revision, body_md, coverage, task_id, version_id)
    VALUES (${randomUUID()}, ${page.id}, ${revision}, ${rendered.bodyMd}, ${tx.json(rendered.coverage as never)}, ${meta.taskId}, ${meta.versionId})`;
  for (const citation of aggregate.citations) {
    await tx`INSERT INTO member_wiki_citations(id, page_id, revision, version_id, label, anchor, analyst, organization, published_on, source_title)
      VALUES (${randomUUID()}, ${page.id}, ${revision}, ${citation.versionId}, ${citation.label}, ${citation.anchor}, ${citation.analyst}, ${citation.organization}, ${citation.publishedOn}, ${citation.sourceTitle})`;
  }
  return revision;
}

/**
 * Writes the page of a target again, from the contributions that are still active. A page that
 * holds nothing any more goes down.
 */
export async function rebuildTarget(tx: Tx, targetKey: string): Promise<{ slug: string; withdrawn: boolean } | null> {
  const pageRow = await tx<{ id: string; slug: string }[]>`SELECT id, slug FROM member_wiki_pages WHERE target_key = ${targetKey} FOR UPDATE`;
  if (!pageRow[0]) return null;
  const remaining = await activeContributions(tx, targetKey);
  if (!remaining.length) {
    await tx`UPDATE member_wiki_pages SET status='withdrawn', updated_at=now() WHERE id=${pageRow[0].id} AND status='published'`;
    return { slug: pageRow[0].slug, withdrawn: true };
  }
  const aggregate = aggregateContributions(remaining);
  await writeRevision(tx, pageRow[0], aggregate, { taskId: aggregate.taskId, versionId: aggregate.versionId, documentId: aggregate.citations[0]?.documentId ?? "" });
  await tx`UPDATE member_wiki_pages SET status='published', updated_at=now() WHERE id=${pageRow[0].id}`;
  return { slug: pageRow[0].slug, withdrawn: false };
}

/**
 * The pages of a build. Each page of the draft becomes this material's contribution to a target,
 * and the page of that target is written again with every active contribution in it.
 */
export async function publishBuildPages(tx: Tx, args: {
  taskId: string;
  versionId: string;
  documentId: string;
  versionNo: number;
  draft: CompiledDraft;
  findings: Finding[];
  attribution: string | null;
  materialTitle: string | null;
}): Promise<WrittenPage[]> {
  const previous = await tx<{ target_key: string }[]>`SELECT DISTINCT target_key FROM member_wiki_contributions WHERE version_id = ${args.versionId} AND status = 'active'`;
  const written: WrittenPage[] = [];
  const touched = new Set<string>();
  for (const page of args.draft.pages) {
    const targetKey = targetKeyOf(page);
    touched.add(targetKey);
    const pageRow = await lockPage(tx, page, targetKey);
    const contribution: ContributionRow = {
      versionId: args.versionId,
      documentId: args.documentId,
      versionNo: args.versionNo,
      createdAt: new Date().toISOString(),
      taskId: args.taskId,
      targetKey,
      slug: page.slug,
      page,
      sources: args.draft.sources as SourceRecord[],
      attribution: args.attribution,
      materialTitle: args.materialTitle,
    };
    await writeContribution(tx, contribution);
    const aggregate = aggregateContributions(await activeContributions(tx, targetKey));
    const revision = await writeRevision(tx, pageRow, aggregate, { taskId: args.taskId, versionId: args.versionId, documentId: args.documentId });
    await tx`UPDATE member_wiki_pages SET status='published', updated_at=now(), page_type=${page.pageType}, target_type=${page.targetType}, target_name=${page.targetName}, track=${page.track} WHERE id=${pageRow.id}`;
    for (const finding of args.findings.filter(item => item.target === page.slug || item.target?.startsWith(`${page.slug}#`))) {
      await tx`INSERT INTO member_wiki_quality_issues(id, page_id, level, category, target, message, evidence, status)
        VALUES (${randomUUID()}, ${pageRow.id}, ${finding.level}, ${finding.category}, ${finding.target}, ${finding.message}, ${finding.evidence}, 'open')`;
    }
    written.push({ pageId: pageRow.id, slug: pageRow.slug, revision });
  }
  // A build that no longer holds a page it used to hold: that page is written again without it.
  for (const target of previous) {
    if (touched.has(target.target_key)) continue;
    await rebuildTarget(tx, target.target_key);
  }
  return written;
}

/**
 * A material leaves the library: its contribution is withdrawn, and the pages it held are written
 * again without it. A page that held nothing else goes down with it.
 */
export async function withdrawDocumentPages(tx: Tx, documentId: string): Promise<{ withdrawn: string[]; rebuilt: string[] }> {
  await tx`UPDATE member_wiki_contributions SET status='withdrawn', updated_at=now() WHERE document_id = ${documentId} AND status <> 'withdrawn'`;
  const targets = await tx<{ target_key: string }[]>`SELECT DISTINCT target_key FROM member_wiki_contributions WHERE document_id = ${documentId}`;
  const withdrawn: string[] = [];
  const rebuilt: string[] = [];
  for (const target of targets) {
    const result = await rebuildTarget(tx, target.target_key);
    if (!result) continue;
    if (result.withdrawn) withdrawn.push(result.slug);
    else rebuilt.push(result.slug);
  }
  return { withdrawn, rebuilt };
}
