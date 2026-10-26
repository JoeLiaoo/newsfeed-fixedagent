import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { prepareKnowledgeFigure } from "@aihot/backend/media/knowledge-figure";
import { modelSupportsVision } from "@aihot/backend/providers/llm";
import { config } from "@aihot/backend/config";
import { FIGURE_LIMITS } from "./catalog.ts";
import type { FigureCandidate } from "./fetch-url.ts";
import { PDF_PAGE_FAILURE_LABELS, renderPdfPage, withPdfFile, type PdfPageFailure } from "./pdf-pages.ts";
import { readFigures, verifyFigures, type FigureFinding, type FigureImage } from "./figure-model.ts";

/** What the page offered as pictures, recorded with the page it came from. */
export type HtmlFigureManifest = {
  pipelineVersion: 1;
  kind: "html";
  htmlSha256: string;
  candidates: FigureCandidate[];
  candidatesTruncated: boolean;
};

/** One page of a PDF that may be drawn and read. */
export type PdfPageCandidate = { ordinal: number; page: number; label: string; context: string | null };

/**
 * The pages of a PDF. A research report draws its charts as vectors, so the page itself is the
 * picture: the manifest says how many pages the material has, which of them the text layer gave,
 * and which of them may be drawn.
 */
export type PdfFigureManifest = {
  pipelineVersion: 1;
  kind: "pdf";
  /** The checksum of the material the pages come from. */
  sourceSha256: string;
  /** How many pages the material has. */
  totalPages: number;
  /** The pages whose text layer was read. */
  textPages: number[];
  /** The pages that may be drawn, at most FIGURE_LIMITS.pdfPages.maxPages of them. */
  candidates: PdfPageCandidate[];
  /** Whether pages beyond the drawn ones exist. */
  candidatesTruncated: boolean;
};

export type FigureManifest = HtmlFigureManifest | PdfFigureManifest;

/**
 * A manifest that was written before the pages of a PDF existed keeps its shape: a manifest
 * without a kind is a page of pictures. A manifest that cannot be read at all is no manifest.
 */
export function readFigureManifest(value: unknown): FigureManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const list = (input: unknown) => (Array.isArray(input) ? input : []);
  if (record.kind === "pdf") {
    const candidates = list(record.candidates)
      .map(candidate => candidate as Partial<PdfPageCandidate>)
      .filter(candidate => Number.isInteger(candidate.page) && Number(candidate.page)! > 0)
      .map(candidate => ({
        ordinal: Number(candidate.ordinal ?? candidate.page),
        page: Number(candidate.page),
        label: typeof candidate.label === "string" ? candidate.label : `第 ${Number(candidate.page)} 页`,
        context: typeof candidate.context === "string" ? candidate.context : null,
      }));
    return {
      pipelineVersion: 1,
      kind: "pdf",
      sourceSha256: typeof record.sourceSha256 === "string" ? record.sourceSha256 : "",
      totalPages: Number(record.totalPages ?? 0),
      textPages: list(record.textPages).map(page => Number(page)).filter(page => Number.isInteger(page) && page > 0),
      candidates,
      candidatesTruncated: record.candidatesTruncated === true,
    };
  }
  if (record.kind === "html" || record.kind === undefined) {
    return {
      pipelineVersion: 1,
      kind: "html",
      htmlSha256: typeof record.htmlSha256 === "string" ? record.htmlSha256 : "",
      candidates: list(record.candidates) as FigureCandidate[],
      candidatesTruncated: record.candidatesTruncated === true,
    };
  }
  return null;
}

/** What happened to one page of a PDF that was to be drawn. */
export type FigurePageProgress = { page: number; state: "rendered" | "failed"; reason: PdfPageFailure | null };

/**
 * The pages of a PDF that may be drawn. A research report draws its charts as vectors, so the page
 * itself is the picture: the platform reads the first pages and leaves the rest to the text layer.
 */
export function pdfFigureManifest(input: {
  /** The checksum of the material the pages come from. */
  sourceSha256: string;
  /** How many pages the material has. */
  totalPages: number;
  /** The sections of the text layer, each with the page it came from. */
  sections: Array<{ page?: number; text: string }>;
}): PdfFigureManifest {
  const textPages = input.sections.map(section => section.page).filter((page): page is number => typeof page === "number");
  const contexts = new Map<number, string>();
  for (const section of input.sections) if (typeof section.page === "number") contexts.set(section.page, section.text.slice(0, 600));
  const drawable = Math.min(input.totalPages, FIGURE_LIMITS.pdfPages.maxPages);
  const candidates = Array.from({ length: drawable }, (_unused, index) => {
    const page = index + 1;
    return { ordinal: page, page, label: `第 ${page} 页`, context: contexts.get(page) ?? null };
  });
  return {
    pipelineVersion: 1,
    kind: "pdf",
    sourceSha256: input.sourceSha256,
    totalPages: input.totalPages,
    textPages,
    candidates,
    candidatesTruncated: input.totalPages > drawable,
  };
}

/**
 * The page coverage of one material: the text layer and the drawn pages are told apart, because
 * one material may have a full text layer and no page that could be drawn.
 */
export type FigurePageCoverage = {
  documentId: string | null;
  title: string | null;
  /** How many pages the material has. */
  total: number;
  /** The pages whose text layer was read. */
  textPages: number[];
  /** The pages that were drawn and entered the visual steps. */
  visualPages: number[];
  /** The pages that could not be drawn, and why. */
  failed: Array<{ page: number; reason: string }>;
  /** The pages that were not drawn at all: beyond the page limit or beyond the budget. */
  uncovered: number[];
};

/** What one build actually read. The counts come from the program, never from the model. */
export type FigureCoverage = {
  status: "complete" | "partial" | "unavailable" | "legacy_text_only";
  /** Whether this build read images at all; a build with the switch off says so instead of counting nothing. */
  read: boolean;
  candidates: number;
  processed: number;
  evidenced: number;
  unreadable: number;
  unprocessed: number;
  truncated: boolean;
  /** The page coverage of the PDF materials; a page of pictures has none. */
  pages?: FigurePageCoverage[] | null;
};

type BatchState = {
  read: "waiting" | "reserved" | "done" | "failed";
  verify: "waiting" | "reserved" | "done" | "failed";
  readReceiptId?: number;
  verifyReceiptId?: number;
  candidates?: FigureFinding[];
};

/** The checkpoint of the figure steps: what was downloaded, what was asked, what was verified. */
export type FigureCheckpoint = {
  pipelineVersion: 1;
  manifestDigest: string;
  modelConfigDigest: string;
  phase: "snapshot" | "reading" | "verifying" | "done";
  downloadAttempts: number;
  downloadBytes: number;
  visionRequests: number;
  normalizedBytes: number;
  attemptedOrdinals: number[];
  snapshotDone: boolean;
  batches: Record<string, BatchState>;
  verifiedFindings: FigureFinding[];
  evidenceDigest: string;
  coverage: FigureCoverage;
  /** What happened to each page of a PDF that was to be drawn. */
  pageProgress?: FigurePageProgress[];
};

/**
 * The digest of a value that must survive a round trip through the database. The checkpoint is
 * stored as JSON, which does not keep the order of the keys, so a plain hash of the text would
 * change between two runs of the same build.
 */
const digest = (value: unknown) => sha256(stableJson(value));

/** The figure steps run only when the switch is on, model calls are allowed, and the model reads images. */
export const figuresEnabled = () => process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED === "true"
  && config.modelCallsEnabled && modelSupportsVision("default");

export const legacyCoverage = (): FigureCoverage => ({
  status: "legacy_text_only", read: false, candidates: 0, processed: 0, evidenced: 0, unreadable: 0, unprocessed: 0, truncated: false,
});

/** The pages of a PDF that were drawn, and the pages that were not. */
export function pdfPageCoverage(manifest: PdfFigureManifest, progress: FigurePageProgress[]): FigurePageCoverage {
  const rendered = progress.filter(entry => entry.state === "rendered").map(entry => entry.page);
  const failed = progress
    .filter(entry => entry.state === "failed")
    .map(entry => ({ page: entry.page, reason: entry.reason ? PDF_PAGE_FAILURE_LABELS[entry.reason] : PDF_PAGE_FAILURE_LABELS.render_failed }));
  const uncovered: number[] = [];
  for (let page = 1; page <= manifest.totalPages; page++) {
    if (rendered.includes(page)) continue;
    if (failed.some(entry => entry.page === page)) continue;
    uncovered.push(page);
  }
  return { documentId: null, title: null, total: manifest.totalPages, textPages: manifest.textPages, visualPages: rendered, failed, uncovered };
}

function coverageOf(manifest: FigureManifest, processed: number, evidenced: number, read: boolean, pages: FigurePageCoverage[] | null): FigureCoverage {
  const candidates = manifest.candidates.length;
  const unprocessed = Math.max(0, candidates - processed);
  const unreadable = Math.max(0, processed - evidenced);
  const status = !read || !evidenced ? "unavailable"
    : (unprocessed || unreadable || manifest.candidatesTruncated) ? "partial" : "complete";
  return { status, read, candidates, processed, evidenced, unreadable, unprocessed, truncated: manifest.candidatesTruncated, pages };
}

function initialCheckpoint(manifest: FigureManifest): FigureCheckpoint {
  const pages = manifest.kind === "pdf" ? [pdfPageCoverage(manifest, [])] : null;
  return {
    pipelineVersion: 1,
    manifestDigest: digest(manifest),
    modelConfigDigest: digest({ model: process.env.LLM_MODEL ?? "", vision: process.env.LLM_VISION === "true" }),
    phase: "snapshot",
    downloadAttempts: 0,
    downloadBytes: 0,
    visionRequests: 0,
    normalizedBytes: 0,
    attemptedOrdinals: [],
    snapshotDone: false,
    batches: {},
    verifiedFindings: [],
    evidenceDigest: "",
    coverage: coverageOf(manifest, 0, 0, false, pages),
    pageProgress: manifest.kind === "pdf" ? [] : undefined,
  };
}

/** The build must still be ours: the task runs under this lease and the material is in the library. */
async function assertOwned(taskId: string, leaseToken: string, versionId: string) {
  const rows = await sql<{ id: string }[]>`SELECT t.id FROM member_wiki_tasks t JOIN member_wiki_documents d ON d.id=t.document_id
    WHERE t.id=${taskId} AND t.version_id=${versionId} AND t.state='running' AND t.lease_token=${leaseToken}
      AND t.lease_expires_at > now() AND d.status='active'`;
  if (!rows.length) throw new Error("knowledge_lease_lost");
}

async function save(taskId: string, leaseToken: string, versionId: string, checkpoint: FigureCheckpoint) {
  const rows = await sql<{ id: string }[]>`UPDATE member_wiki_tasks t SET figure_checkpoint=${sql.json(checkpoint as never)}, updated_at=now()
    FROM member_wiki_documents d WHERE t.id=${taskId} AND t.version_id=${versionId} AND d.id=t.document_id
      AND d.status='active' AND t.state='running' AND t.lease_token=${leaseToken} AND t.lease_expires_at > now() RETURNING t.id`;
  if (!rows.length) throw new Error("knowledge_lease_lost");
}

/**
 * Freeze the pictures of the page before any model sees them: the same bytes are downloaded once,
 * stored with the version, and read again by every later step of this build.
 */
export async function snapshotFigures(taskId: string, leaseToken: string, versionId: string, manifest: FigureManifest, prior: FigureCheckpoint | null, options: { body?: Buffer } = {}): Promise<FigureCheckpoint> {
  const checkpoint = prior ?? initialCheckpoint(manifest);
  if (checkpoint.manifestDigest !== digest(manifest)) throw new Error("knowledge_figure_evidence_changed");
  if (checkpoint.snapshotDone) return checkpoint;
  await save(taskId, leaseToken, versionId, checkpoint);
  if (!figuresEnabled()) {
    // The switch is off: no image is downloaded and no model is asked. The build says so.
    checkpoint.snapshotDone = true;
    checkpoint.phase = "done";
    await save(taskId, leaseToken, versionId, checkpoint);
    return checkpoint;
  }
  if (manifest.kind === "pdf") return snapshotPdfPages(taskId, leaseToken, versionId, manifest, checkpoint, options.body ?? null);
  return snapshotWebFigures(taskId, leaseToken, versionId, manifest, checkpoint);
}

/**
 * Freeze the pictures of a web page: download each candidate, normalize it, and store it with the
 * version. A candidate that cannot be fetched or decoded is skipped, not paid for twice.
 */
async function snapshotWebFigures(taskId: string, leaseToken: string, versionId: string, manifest: HtmlFigureManifest, checkpoint: FigureCheckpoint): Promise<FigureCheckpoint> {
  const started = Date.now();
  // A picture with a caption comes first; the rest keep the order of the page.
  const ordered = [...manifest.candidates].sort((a, b) => Number(Boolean(b.caption)) - Number(Boolean(a.caption)) || a.ordinal - b.ordinal);
  const existing = await sql<{ ordinal: number; normalized_sha256: string; normalized_body: Buffer }[]>`
    SELECT ordinal, normalized_sha256, normalized_body FROM member_wiki_figure_assets WHERE version_id=${versionId}`;
  const saved = new Set(existing.map(row => row.ordinal));
  const hashes = new Set(existing.map(row => row.normalized_sha256));
  let normalized = existing.reduce((sum, row) => sum + row.normalized_body.length, 0);
  for (const candidate of ordered) {
    if (saved.size >= FIGURE_LIMITS.visualImages) break;
    if (checkpoint.downloadAttempts >= FIGURE_LIMITS.downloadAttempts) break;
    if (checkpoint.downloadBytes >= FIGURE_LIMITS.downloadBytes) break;
    if (Date.now() - started >= FIGURE_LIMITS.downloadStageMs) break;
    if (saved.has(candidate.ordinal) || checkpoint.attemptedOrdinals.includes(candidate.ordinal)) continue;
    await assertOwned(taskId, leaseToken, versionId);
    checkpoint.downloadAttempts++;
    checkpoint.attemptedOrdinals.push(candidate.ordinal);
    await save(taskId, leaseToken, versionId, checkpoint);
    // A download never reads past the remaining budget of the build.
    const cap = Math.min(FIGURE_LIMITS.imageBytes, FIGURE_LIMITS.downloadBytes - checkpoint.downloadBytes);
    try {
      const response = await guardedFetch(candidate.url, {
        publicOnly: true,
        timeoutMs: FIGURE_LIMITS.imageTimeoutMs,
        maxRedirects: 3,
        maxBytes: cap,
        signal: AbortSignal.timeout(Math.max(1, FIGURE_LIMITS.downloadStageMs - (Date.now() - started))),
      });
      checkpoint.downloadBytes += response.body.length;
      await save(taskId, leaseToken, versionId, checkpoint);
      if (response.status !== 200) continue;
      const figure = await prepareKnowledgeFigure(response.body, response.headers.get("content-type") ?? "");
      // Tracking pixels and small marks are not charts; the same picture twice is one picture.
      if (figure.width < 120 || figure.height < 60) continue;
      if (hashes.has(figure.normalizedSha256)) continue;
      if (normalized + figure.normalized.length > FIGURE_LIMITS.normalizedBytes) continue;
      await assertOwned(taskId, leaseToken, versionId);
      await sql`INSERT INTO member_wiki_figure_assets(id, version_id, ordinal, locator, caption, context, original_sha256, normalized_sha256,
        original_body, normalized_body, media_type, width, height) VALUES (${randomUUID()}, ${versionId}, ${candidate.ordinal},
        ${sql.json({ kind: "html", label: `图 ${candidate.ordinal}` })}, ${candidate.caption}, ${candidate.context ?? null},
        ${figure.originalSha256}, ${figure.normalizedSha256},
        ${figure.original}, ${figure.normalized}, ${figure.mediaType}, ${figure.width}, ${figure.height}) ON CONFLICT (version_id, ordinal) DO NOTHING`;
      saved.add(candidate.ordinal);
      hashes.add(figure.normalizedSha256);
      normalized += figure.normalized.length;
      checkpoint.normalizedBytes = normalized;
      await save(taskId, leaseToken, versionId, checkpoint);
    } catch (error) {
      // Losing the build is not an image problem; an unreachable or invalid picture is.
      if (error instanceof Error && error.message === "knowledge_lease_lost") throw error;
    }
  }
  checkpoint.snapshotDone = true;
  checkpoint.phase = "reading";
  await save(taskId, leaseToken, versionId, checkpoint);
  return checkpoint;
}

/**
 * Draw the pages of a PDF and freeze them as pictures: the images the model reads later are the
 * ones stored with the version. The pages are drawn one at a time, in a process that may be
 * stopped; a page that cannot be drawn is recorded and skipped, so the build says which page is
 * missing instead of pretending the whole report was read.
 */
async function snapshotPdfPages(taskId: string, leaseToken: string, versionId: string, manifest: PdfFigureManifest, checkpoint: FigureCheckpoint, body: Buffer | null): Promise<FigureCheckpoint> {
  if (!body) {
    checkpoint.snapshotDone = true;
    checkpoint.phase = "done";
    await save(taskId, leaseToken, versionId, checkpoint);
    return checkpoint;
  }
  const started = Date.now();
  const existing = await sql<{ ordinal: number; normalized_sha256: string; normalized_body: Buffer }[]>`
    SELECT ordinal, normalized_sha256, normalized_body FROM member_wiki_figure_assets WHERE version_id=${versionId}`;
  const saved = new Set(existing.map(row => row.ordinal));
  const hashes = new Set(existing.map(row => row.normalized_sha256));
  let normalized = existing.reduce((sum, row) => sum + row.normalized_body.length, 0);
  const progress = checkpoint.pageProgress ?? [];
  await withPdfFile(body, async file => {
    for (const candidate of manifest.candidates) {
      if (saved.size >= FIGURE_LIMITS.visualImages) break;
      // The whole render stage may take; the pages after that point are not drawn.
      if (Date.now() - started >= FIGURE_LIMITS.pdfPages.totalBudgetMs) break;
      if (saved.has(candidate.ordinal)) continue;
      if (progress.some(entry => entry.page === candidate.page)) continue;
      await assertOwned(taskId, leaseToken, versionId);
      const outcome = await renderPdfPage(file, candidate.page);
      if (!outcome.ok) {
        progress.push({ page: candidate.page, state: "failed", reason: outcome.reason });
        checkpoint.pageProgress = progress;
        await save(taskId, leaseToken, versionId, checkpoint);
        continue;
      }
      try {
        const figure = await prepareKnowledgeFigure(outcome.png, "image/png");
        // A page too small to read is not a chart; it is still a page that was drawn.
        if (figure.width < 120 || figure.height < 60) {
          progress.push({ page: candidate.page, state: "rendered", reason: null });
          checkpoint.pageProgress = progress;
          await save(taskId, leaseToken, versionId, checkpoint);
          continue;
        }
        // The same picture twice is one picture.
        if (hashes.has(figure.normalizedSha256)) continue;
        if (normalized + figure.normalized.length > FIGURE_LIMITS.normalizedBytes) continue;
        await assertOwned(taskId, leaseToken, versionId);
        await sql`INSERT INTO member_wiki_figure_assets(id, version_id, ordinal, locator, caption, context, original_sha256, normalized_sha256,
          original_body, normalized_body, media_type, width, height) VALUES (${randomUUID()}, ${versionId}, ${candidate.ordinal},
          ${sql.json({ kind: "pdf", label: candidate.label, page: candidate.page })}, ${candidate.label}, ${candidate.context ?? null},
          ${figure.originalSha256}, ${figure.normalizedSha256},
          ${figure.original}, ${figure.normalized}, ${figure.mediaType}, ${figure.width}, ${figure.height}) ON CONFLICT (version_id, ordinal) DO NOTHING`;
        saved.add(candidate.ordinal);
        hashes.add(figure.normalizedSha256);
        normalized += figure.normalized.length;
        checkpoint.normalizedBytes = normalized;
        progress.push({ page: candidate.page, state: "rendered", reason: null });
        checkpoint.pageProgress = progress;
        await save(taskId, leaseToken, versionId, checkpoint);
      } catch (error) {
        // Losing the build is not a page problem; a page that cannot be decoded is.
        if (error instanceof Error && error.message === "knowledge_lease_lost") throw error;
        progress.push({ page: candidate.page, state: "failed", reason: "render_failed" });
        checkpoint.pageProgress = progress;
        await save(taskId, leaseToken, versionId, checkpoint);
      }
    }
  });
  checkpoint.pageProgress = progress;
  checkpoint.snapshotDone = true;
  checkpoint.phase = "reading";
  await save(taskId, leaseToken, versionId, checkpoint);
  return checkpoint;
}

type StoredFigure = { id: string; ordinal: number; caption: string | null; context: string | null; normalized_body: Buffer };

/**
 * Read the frozen pictures and check the reading in a second, independent look. Only the facts
 * that survive the second look become evidence; the rest are not shown and not cited.
 */
export async function processFigures(taskId: string, leaseToken: string, versionId: string, manifest: FigureManifest, prior: FigureCheckpoint | null): Promise<FigureCheckpoint> {
  const manifestDigest = digest(manifest);
  const modelConfigDigest = digest({ model: process.env.LLM_MODEL ?? "", vision: process.env.LLM_VISION === "true" });
  if (prior && (prior.manifestDigest !== manifestDigest || prior.modelConfigDigest !== modelConfigDigest)) throw new Error("knowledge_figure_evidence_changed");
  const rows = await sql<StoredFigure[]>`
    SELECT id, ordinal, caption, context, normalized_body FROM member_wiki_figure_assets WHERE version_id=${versionId} ORDER BY ordinal LIMIT ${FIGURE_LIMITS.visualImages}`;
  const enabled = figuresEnabled();
  const checkpoint = prior ?? initialCheckpoint(manifest);
  checkpoint.normalizedBytes = rows.reduce((sum, row) => sum + row.normalized_body.length, 0);
  await save(taskId, leaseToken, versionId, checkpoint);
  const batches: Array<{ batchId: string; rows: StoredFigure[] }> = [];
  for (let offset = 0; offset < rows.length; offset += FIGURE_LIMITS.batchSize) {
    const slice = rows.slice(offset, offset + FIGURE_LIMITS.batchSize);
    batches.push({ batchId: digest(slice.map(row => row.id)).slice(0, 20), rows: slice });
  }
  if (enabled) {
    const started = Date.now();
    for (const batch of batches) {
      if (Date.now() - started >= FIGURE_LIMITS.visualStageMs) break;
      const state = checkpoint.batches[batch.batchId] ?? { read: "waiting" as const, verify: "waiting" as const };
      checkpoint.batches[batch.batchId] = state;
      if (state.read === "failed" || state.verify === "failed") continue;
      if (state.read === "done" && state.verify === "done") continue;
      const images: FigureImage[] = batch.rows.map(row => ({ id: row.id, caption: row.caption, context: row.context, normalized: row.normalized_body }));
      try {
        if (state.read !== "done") {
          if (state.read === "waiting") {
            if (checkpoint.visionRequests >= FIGURE_LIMITS.visionRequests) break;
            checkpoint.visionRequests++;
            state.read = "reserved";
            await save(taskId, leaseToken, versionId, checkpoint);
          }
          checkpoint.phase = "reading";
          await save(taskId, leaseToken, versionId, checkpoint);
          const read = await readFigures(versionId, batch.batchId, images);
          state.candidates = read.findings;
          state.readReceiptId = read.receiptId;
          state.read = "done";
          await save(taskId, leaseToken, versionId, checkpoint);
        }
        if (!state.candidates?.length) {
          state.verify = "done";
          await save(taskId, leaseToken, versionId, checkpoint);
          continue;
        }
        if (state.verify !== "done") {
          if (state.verify === "waiting") {
            if (checkpoint.visionRequests >= FIGURE_LIMITS.visionRequests) break;
            checkpoint.visionRequests++;
            state.verify = "reserved";
            await save(taskId, leaseToken, versionId, checkpoint);
          }
          checkpoint.phase = "verifying";
          await save(taskId, leaseToken, versionId, checkpoint);
          const verified = await verifyFigures(versionId, batch.batchId, images, state.candidates);
          state.verifyReceiptId = verified.receiptId;
          state.verify = "done";
          // The verified set replaces what this batch contributed before: a fact the second look
          // did not accept is not evidence, even if the first look wrote it down.
          const batchFindings = new Set(state.candidates!.map(candidate => candidate.id));
          checkpoint.verifiedFindings = [
            ...checkpoint.verifiedFindings.filter(item => !batchFindings.has(item.id)),
            ...verified.findings,
          ];
          await save(taskId, leaseToken, versionId, checkpoint);
        }
      } catch (error) {
        if (error instanceof Error && error.message === "knowledge_lease_lost") throw error;
        // A refused, unusable or unknown call ends this batch: it contributes no picture facts and
        // is not paid for twice. The next build of the same material starts from the frozen bytes.
        if (state.read !== "done") state.read = "failed";
        else if (state.verify !== "done") state.verify = "failed";
        await save(taskId, leaseToken, versionId, checkpoint);
        continue;
      }
    }
  }
  const processed = batches.filter(batch => checkpoint.batches[batch.batchId]?.read === "done")
    .reduce((sum, batch) => sum + batch.rows.length, 0);
  const evidenced = new Set(checkpoint.verifiedFindings.map(item => item.figureId)).size;
  const pages = manifest.kind === "pdf" ? [pdfPageCoverage(manifest, checkpoint.pageProgress ?? [])] : null;
  checkpoint.coverage = coverageOf(manifest, processed, evidenced, enabled, pages);
  checkpoint.phase = "done";
  checkpoint.evidenceDigest = digest({ manifestDigest, assets: rows.map(row => row.id), findings: checkpoint.verifiedFindings });
  await save(taskId, leaseToken, versionId, checkpoint);
  return checkpoint;
}
