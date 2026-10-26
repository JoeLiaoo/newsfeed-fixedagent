import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { prepareKnowledgeFigure } from "@aihot/backend/media/knowledge-figure";
import { modelSupportsVision } from "@aihot/backend/providers/llm";
import { config } from "@aihot/backend/config";
import { FIGURE_LIMITS } from "./catalog.ts";
import type { FigureCandidate } from "./fetch-url.ts";
import { readFigures, verifyFigures, type FigureFinding, type FigureImage } from "./figure-model.ts";

/** What the page offered as pictures, recorded with the page it came from. */
export type FigureManifest = {
  pipelineVersion: 1;
  htmlSha256: string;
  candidates: FigureCandidate[];
  candidatesTruncated: boolean;
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

function coverageOf(manifest: FigureManifest, processed: number, evidenced: number, read: boolean): FigureCoverage {
  const candidates = manifest.candidates.length;
  const unprocessed = Math.max(0, candidates - processed);
  const unreadable = Math.max(0, processed - evidenced);
  const status = !read || !evidenced ? "unavailable"
    : (unprocessed || unreadable || manifest.candidatesTruncated) ? "partial" : "complete";
  return { status, read, candidates, processed, evidenced, unreadable, unprocessed, truncated: manifest.candidatesTruncated };
}

function initialCheckpoint(manifest: FigureManifest): FigureCheckpoint {
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
    coverage: coverageOf(manifest, 0, 0, false),
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
export async function snapshotFigures(taskId: string, leaseToken: string, versionId: string, manifest: FigureManifest, prior: FigureCheckpoint | null): Promise<FigureCheckpoint> {
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
  checkpoint.coverage = coverageOf(manifest, processed, evidenced, enabled);
  checkpoint.phase = "done";
  checkpoint.evidenceDigest = digest({ manifestDigest, assets: rows.map(row => row.id), findings: checkpoint.verifiedFindings });
  await save(taskId, leaseToken, versionId, checkpoint);
  return checkpoint;
}
