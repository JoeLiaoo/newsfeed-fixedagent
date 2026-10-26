// The pages of a PDF: what the renderer does with a page, what the text layer says about the
// document, and how the coverage tells the text pages, the drawn pages and the missing ones apart.
// Synthetic material and a real renderer; no model is called here.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { buildPdf } from "./pdf-fixture.ts";
import { renderPdfPage, withPdfFile } from "../knowledge/pdf-pages.ts";
import { capExtraction, extractMaterial } from "../knowledge/extract.ts";
import { pdfFigureManifest, pdfPageCoverage, type FigurePageProgress } from "../knowledge/figures.ts";
import { pageRanges, renderPage } from "../knowledge/render.ts";
import { FIGURE_LIMITS } from "../knowledge/catalog.ts";
import type { PageDraft, SourceRecord } from "../knowledge/schema.ts";

const mixed = buildPdf([
  { lines: ["Revenue grew twelve percent in 2026"] },
  { drawing: true },
  { lines: ["Third page of the note"] },
]);

test("a page of a PDF is drawn in a process of its own", async () => {
  await withPdfFile(mixed, async file => {
    const outcome = await renderPdfPage(file, 1);
    assert.equal(outcome.ok, true, "the first page becomes a picture");
    if (!outcome.ok) return;
    const picture = await sharp(outcome.png).metadata();
    assert.equal(picture.format, "png");
    assert.ok(picture.width! > 600 && picture.height! > 800, "the page keeps its own size");
    assert.ok(picture.width! <= FIGURE_LIMITS.pdfPages.maxEdge, "the page fits the longest edge of a picture the model may read");
  });
});

test("a page that is not in the document does not become a picture", async () => {
  await withPdfFile(mixed, async file => {
    const outcome = await renderPdfPage(file, 9);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "render_failed");
  });
});

test("a page that takes too long is stopped, and the build may go on", async () => {
  await withPdfFile(mixed, async file => {
    const outcome = await renderPdfPage(file, 1, { timeoutMs: 1 });
    assert.equal(outcome.ok, false, "the page is given up on instead of waiting");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "timeout");
  });
});

test("the text layer of a PDF says which pages it gave", async () => {
  const result = await extractMaterial("pdf", mixed);
  assert.equal(result.status, "available");
  assert.equal(result.pages?.total, 3);
  assert.deepEqual(result.pages?.read, [1, 3], "the page without letters is not a text page");
  assert.match(result.text, /<!-- 第 1 页 -->/);
  const capped = capExtraction(result, 40);
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.sections.map(section => section.page), [1], "a capped section keeps the page it came from");
});

test("a scan has pages but no letters", async () => {
  const scan = buildPdf([{ drawing: true }, { drawing: true }]);
  const result = await extractMaterial("pdf", scan);
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "no_text", "a scan is not a file that could not be read");
  assert.equal(result.pages?.total, 2);
  assert.deepEqual(result.pages?.read, []);
});

test("a PDF offers at most the first eight pages, and says how many pages it has", () => {
  const long = buildPdf(Array.from({ length: 12 }, () => ({ lines: ["a page"] })));
  const manifest = pdfFigureManifest({ sourceSha256: "sha", totalPages: 12, sections: [{ page: 1, text: "第一页" }] });
  assert.equal(manifest.candidates.length, FIGURE_LIMITS.pdfPages.maxPages);
  assert.equal(manifest.candidates.at(-1)?.page, 8, "the pages after the eighth are not drawn");
  assert.equal(manifest.candidatesTruncated, true);
  assert.equal(manifest.totalPages, 12);
  assert.deepEqual(manifest.textPages, [1]);
  assert.equal(manifest.candidates[0]?.context, "第一页", "the text of the page is the context of its picture");
  assert.ok(long.length > 0);
});

test("the coverage tells the text pages, the drawn pages and the missing ones apart", () => {
  const manifest = pdfFigureManifest({ sourceSha256: "sha", totalPages: 10, sections: [{ page: 1, text: "第一页" }, { page: 2, text: "第二页" }] });
  const progress: FigurePageProgress[] = [
    { page: 1, state: "rendered", reason: null },
    { page: 2, state: "failed", reason: "timeout" },
    { page: 3, state: "rendered", reason: null },
  ];
  const coverage = pdfPageCoverage(manifest, progress);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.textPages, [1, 2]);
  assert.deepEqual(coverage.visualPages, [1, 3]);
  assert.deepEqual(coverage.failed, [{ page: 2, reason: "渲染超时" }]);
  assert.deepEqual(coverage.uncovered, [4, 5, 6, 7, 8, 9, 10], "the pages that were never drawn are named");
});

test("the pages of a set are written the way people read them", () => {
  assert.equal(pageRanges([1, 2, 3, 5, 7, 8]), "1–3、5、7–8");
  assert.equal(pageRanges([]), "无");
});

test("the page shows the reading scope: the text pages and the drawn pages apart", () => {
  const page: PageDraft = {
    pageType: "view", slug: "view-pdf-example", title: "某公司", targetType: "公司", targetName: "某公司", track: "食品饮料",
    consensus: "", divergences: [], marginalChanges: [], stances: [], expectations: [], risks: [], timeline: [],
    question: null, answer: null, definition: null, structure: [], inputs: [], outputs: [], anchors: [], metrics: [], related: [],
    figureRefs: [],
  };
  const sources: SourceRecord[] = [{ ref: "S1", institution: "某券商", authors: [], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }];
  const { bodyMd } = renderPage(page, sources, "doc-1", [], {
    status: "partial", read: true, candidates: 8, processed: 3, evidenced: 1, unreadable: 2, unprocessed: 5, truncated: true,
    pages: [{ documentId: "doc-1", title: "某公司深度报告", total: 42, textPages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], visualPages: [1, 2, 3],
      failed: [{ page: 4, reason: "渲染超时" }], uncovered: [5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42] }],
  });
  assert.match(bodyMd, /## 读取范围/);
  assert.match(bodyMd, /共 42 页/);
  assert.match(bodyMd, /文字层读取第 1–12 页/);
  assert.match(bodyMd, /页面识图覆盖第 1–3 页/);
  assert.match(bodyMd, /第 4 页未能渲染（渲染超时）/);
  assert.match(bodyMd, /本次为部分读取，不代表整份材料的完整理解/);
});

test("a material that was read whole does not claim a partial reading", () => {
  const page: PageDraft = {
    pageType: "view", slug: "view-pdf-whole", title: "某公司", targetType: "公司", targetName: "某公司", track: "食品饮料",
    consensus: "", divergences: [], marginalChanges: [], stances: [], expectations: [], risks: [], timeline: [],
    question: null, answer: null, definition: null, structure: [], inputs: [], outputs: [], anchors: [], metrics: [], related: [],
    figureRefs: [],
  };
  const { bodyMd } = renderPage(page, [], "doc-1", [], {
    status: "complete", read: true, candidates: 2, processed: 2, evidenced: 2, unreadable: 0, unprocessed: 0, truncated: false,
    pages: [{ documentId: "doc-1", title: "某公司深度报告", total: 2, textPages: [1, 2], visualPages: [1, 2], failed: [], uncovered: [] }],
  });
  assert.match(bodyMd, /## 读取范围/);
  assert.doesNotMatch(bodyMd, /部分读取/, "a material that was read whole is not called a partial reading");
});
