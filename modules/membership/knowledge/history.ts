// The answers an employee asked, read back. The rows are written when the answer is given; reading
// them back joins the material behind every citation, so an old answer can be opened again and
// followed to the page, the material and the file it rests on. Nothing is invented here: a field
// the library never recorded stays empty, and the page shows it as 未知.
import { sql } from "@aihot/backend/db";

/** One citation of an answer: what it points at, who said it, and where it may be read. */
export type AnswerCitation = {
  label: string;
  pageSlug: string;
  title: string;
  analyst: string | null;
  organization: string | null;
  publishedOn: string | null;
  anchor: string | null;
  citationId: string | null;
  versionId: string | null;
  documentId: string | null;
  documentTitle: string | null;
  fileName: string | null;
};

/** The coverage an answer recorded: what it rests on, counted by the library itself. */
export type AnswerCoverage = {
  analysts: number;
  firms: number;
  reports: number;
  first_report: string | null;
  last_report: string | null;
};

/** The freshness of the pages an answer used, as the library graded them. */
export type AnswerFreshness = { pageSlug: string; tier: string | null; lastReport: string | null };

/** One answer, as the employee reads it back. */
export type AnswerRecord = {
  id: string;
  question: string;
  answerMd: string;
  citations: AnswerCitation[];
  coverage: AnswerCoverage;
  freshness: AnswerFreshness[];
  pages: string[];
  createdAt: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** One citation, read out of what the answer stored. */
export function toAnswerCitation(value: unknown): AnswerCitation {
  const stored = record(value);
  return {
    label: text(stored.label) ?? "",
    pageSlug: text(stored.pageSlug) ?? "",
    title: text(stored.title) ?? "",
    analyst: text(stored.analyst),
    organization: text(stored.organization),
    publishedOn: text(stored.publishedOn),
    anchor: text(stored.anchor),
    citationId: text(stored.citationId),
    versionId: text(stored.versionId),
    documentId: text(stored.documentId),
    documentTitle: text(stored.documentTitle),
    fileName: text(stored.fileName),
  };
}

/** The citations an answer stored, read into the platform's own shape. */
export function readCitations(value: unknown): AnswerCitation[] {
  return Array.isArray(value) ? value.map(toAnswerCitation) : [];
}

/** The coverage an answer stored, read into the platform's own shape. */
export function readCoverage(value: unknown): AnswerCoverage {
  const stored = record(value);
  const count = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry) ? entry : 0;
  return {
    analysts: count(stored.analysts),
    firms: count(stored.firms),
    reports: count(stored.reports),
    first_report: text(stored.first_report),
    last_report: text(stored.last_report),
  };
}

/** The freshness an answer stored, read into the platform's own shape. */
export function readFreshness(value: unknown): AnswerFreshness[] {
  if (!Array.isArray(value)) return [];
  return value.map(entry => {
    const stored = record(entry);
    return { pageSlug: text(stored.pageSlug) ?? "", tier: text(stored.tier), lastReport: text(stored.lastReport) };
  });
}

/** The pages an answer used, read out of what it stored. */
export function readPages(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((page): page is string => typeof page === "string" && !!page) : [];
}

/** The material a version belongs to: the document, its title and the file behind it. */
type Material = { documentId: string; documentTitle: string; fileName: string };

/**
 * The material behind every citation of an answer. The answer recorded the version it read, and a
 * version names the material and the file behind it. A citation that names only the row it came
 * from is resolved through that row; one that names neither is resolved through the page it was
 * read from, and only when that page still holds exactly one source — otherwise the material stays
 * empty rather than guessed. What the answer already carries is kept as it is.
 */
export async function enrichCitations(citations: AnswerCitation[]): Promise<AnswerCitation[]> {
  if (!citations.length) return citations;
  const versionIds = new Set<string>();
  const citationIds: string[] = [];
  const slugs: string[] = [];
  for (const citation of citations) {
    if (citation.versionId) versionIds.add(citation.versionId);
    else if (citation.citationId) citationIds.push(citation.citationId);
    else if (citation.pageSlug) slugs.push(citation.pageSlug);
  }
  const versionByCitation = new Map<string, string>();
  if (citationIds.length) {
    const rows = await sql<{ citationId: string; versionId: string }[]>`
      SELECT id AS "citationId", version_id AS "versionId" FROM member_wiki_citations WHERE id IN ${sql(citationIds)}`;
    for (const row of rows) {
      if (!row.versionId) continue;
      versionByCitation.set(row.citationId, row.versionId);
      versionIds.add(row.versionId);
    }
  }
  const versionBySlug = new Map<string, string>();
  if (slugs.length) {
    const rows = await sql<{ slug: string; versionId: string }[]>`
      SELECT p.slug AS "slug", c.version_id AS "versionId"
      FROM member_wiki_pages p
      JOIN member_wiki_citations c ON c.page_id = p.id AND c.revision = (SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id = p.id)
      WHERE p.slug IN ${sql([...new Set(slugs)])}`;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.slug, (counts.get(row.slug) ?? 0) + 1);
    for (const row of rows) {
      if (counts.get(row.slug) !== 1) continue;
      versionBySlug.set(row.slug, row.versionId);
      versionIds.add(row.versionId);
    }
  }
  const materialByVersion = new Map<string, Material>();
  if (versionIds.size) {
    const rows = await sql<{ versionId: string; fileName: string; documentId: string; documentTitle: string }[]>`
      SELECT v.id AS "versionId", v.file_name AS "fileName", d.id AS "documentId", d.title AS "documentTitle"
      FROM member_wiki_document_versions v JOIN member_wiki_documents d ON d.id = v.document_id
      WHERE v.id IN ${sql([...versionIds])}`;
    for (const row of rows) materialByVersion.set(row.versionId, { documentId: row.documentId, documentTitle: row.documentTitle, fileName: row.fileName });
  }
  return citations.map(citation => {
    const versionId = citation.versionId
      ?? (citation.citationId ? versionByCitation.get(citation.citationId) : undefined)
      ?? (citation.pageSlug ? versionBySlug.get(citation.pageSlug) : undefined)
      ?? null;
    const material = versionId ? materialByVersion.get(versionId) : undefined;
    return {
      ...citation,
      versionId,
      documentId: citation.documentId ?? material?.documentId ?? null,
      documentTitle: citation.documentTitle ?? material?.documentTitle ?? null,
      fileName: citation.fileName ?? material?.fileName ?? null,
    };
  });
}

/**
 * The citations of several answers, enriched in one pass: the material behind them is read once for
 * the whole list, not once per answer.
 */
export async function enrichAllCitations(groups: AnswerCitation[][]): Promise<AnswerCitation[][]> {
  const flat = groups.flat();
  const enriched = await enrichCitations(flat);
  const result: AnswerCitation[][] = [];
  let cursor = 0;
  for (const group of groups) {
    result.push(enriched.slice(cursor, cursor + group.length));
    cursor += group.length;
  }
  return result;
}
