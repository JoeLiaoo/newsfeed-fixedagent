// The page renderer of a PDF. A research report draws its charts as vectors, so the page itself is
// the picture: this file turns the first pages of a material into images and hands them to the
// same reading, reviewing and citation chain the pictures of a web page go through.
//
// The rendering happens in a process of its own, one page at a time, so that a page that hangs or
// eats the heap ends a process instead of the worker. The parent may stop that process at any
// moment: the page is then missing, the build says which page is missing, and the material is
// still built from its text.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIGURE_LIMITS } from "./catalog.ts";

/** Why a page did not become a picture. */
export type PdfPageFailure = "timeout" | "memory" | "render_failed" | "budget_exhausted";

export type PdfPageOutcome =
  | { page: number; ok: true; png: Buffer }
  | { page: number; ok: false; reason: PdfPageFailure; detail: string | null };

/** The words the page says when it did not become a picture. */
export const PDF_PAGE_FAILURE_LABELS: Record<PdfPageFailure, string> = {
  timeout: "渲染超时",
  memory: "超出内存预算",
  render_failed: "渲染失败",
  budget_exhausted: "超出渲染预算",
};

/**
 * A copy of the material in a private temporary file. The render process reads bytes from it and
 * nothing else: the worker keeps the material in the database, and this copy is removed as soon
 * as the pages are rendered.
 */
export async function withPdfFile<T>(pdf: Buffer, run: (file: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "kb-pdf-"));
  const file = path.join(directory, "material.pdf");
  try {
    await writeFile(file, pdf, { mode: 0o600 });
    return await run(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * One page of the material, drawn in a process of its own. The process starts with a heap of its
 * own and may be stopped when the page takes too long; what comes back is either the picture or
 * the reason there is none.
 */
export async function renderPdfPage(file: string, page: number, options: { timeoutMs?: number } = {}): Promise<PdfPageOutcome> {
  const timeoutMs = options.timeoutMs ?? FIGURE_LIMITS.pdfPages.pageTimeoutMs;
  const script = path.join(import.meta.dirname, "pdf-render-page.ts");
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  const child = spawn(process.execPath, [
    // The render process gets its own heap: the budget of the worker is not the budget of a page.
    `--max-old-space-size=${FIGURE_LIMITS.pdfPages.memoryMb}`,
    script,
    file,
    String(page),
    String(FIGURE_LIMITS.pdfPages.maxScale),
    String(FIGURE_LIMITS.pdfPages.maxEdge),
    String(FIGURE_LIMITS.pdfPages.maxPixels),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: environment,
  });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  let received = 0;
  let errorBytes = 0;
  let overflow = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref?.();
  child.stdout.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > FIGURE_LIMITS.pdfPages.pageBytes) {
      overflow = true;
      child.kill("SIGKILL");
      return;
    }
    chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    // Only the beginning of the complaint is kept: it is shown to nobody but the coverage.
    if (errorBytes >= 8192) return;
    errorBytes += chunk.length;
    errors.push(chunk);
  });
  const finished = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error: Error | null }>(resolve => {
    child.on("error", error => resolve({ code: null, signal: null, error }));
    child.on("close", (code, signal) => resolve({ code, signal, error: null }));
  });
  const message = Buffer.concat(errors).toString("utf8").trim().slice(0, 200) || null;
  if (finished.error) return { page, ok: false, reason: "render_failed", detail: finished.error.message.slice(0, 200) };
  if (timedOut) return { page, ok: false, reason: "timeout", detail: null };
  if (overflow) return { page, ok: false, reason: "render_failed", detail: "页面图片超过单页上限" };
  if (finished.code === 0) return { page, ok: true, png: Buffer.concat(chunks) };
  // A process the operating system stopped on its own ran out of memory before the heap limit did.
  if (finished.signal === "SIGKILL" || /heap out of memory|Allocation failed/i.test(message ?? "")) {
    return { page, ok: false, reason: "memory", detail: null };
  }
  return { page, ok: false, reason: "render_failed", detail: message };
}
