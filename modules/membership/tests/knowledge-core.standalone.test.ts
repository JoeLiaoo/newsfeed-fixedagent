// The parts of the shared library that need no database: what a material is, what can be read out of
// it, how a draft becomes a page, what the machine can check, and how a question finds its pages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { capExtraction, detectFormat, extractMaterial } from "../knowledge/extract.ts";
import { applyCorrections, coverageOf, renderPage } from "../knowledge/render.ts";
import { lintDraft, lintPage } from "../knowledge/lint.ts";
import { routePages, tokenize } from "../knowledge/routing.ts";
import { freshnessTier } from "../knowledge/catalog.ts";
import type { CompiledDraft, PageDraft } from "../knowledge/schema.ts";

/** A one-page PDF with a line of text, built here so the test carries its own material. */
function samplePdf(): Buffer {
  const content = "BT /F1 12 Tf 72 720 Td (Research note on the target company) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const DOCX = zipSync({
  "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
    <w:p><w:r><w:t>标题：某公司深度报告</w:t></w:r></w:p>
    <w:p><w:r><w:t>评级：看好；目标价 100 元</w:t></w:r></w:p>
    <w:p><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>
  </w:body></w:document>`),
});

const PPTX = zipSync({
  "ppt/slides/slide1.xml": strToU8(`<?xml version="1.0"?><p:sld xmlns:a="x"><a:p><a:r><a:t>第一页：观点</a:t></a:r></a:p></p:sld>`),
  "ppt/slides/slide2.xml": strToU8(`<?xml version="1.0"?><p:sld xmlns:a="x"><a:p><a:r><a:t>第二页：风险</a:t></a:r></a:p></p:sld>`),
});

const page: PageDraft = {
  pageType: "view",
  slug: "view-company-example",
  title: "某公司",
  targetType: "公司",
  targetName: "某公司",
  track: "食品饮料",
  consensus: "已覆盖的材料中，多数分析师看好。",
  divergences: [{ point: "需求能否恢复", sides: [{ attribution: "张三/某券商", argument: "库存低位", date: "2026-06-20" }] }],
  marginalChanges: [{ date: "2026-06-20", attribution: "张三/某券商", note: "首次覆盖" }],
  stances: [
    { analyst: "张三", institution: "某券商", stance: "看好", date: "2026-06-20", argument: "渠道库存低位", sourceRef: "S1" },
    { analyst: "李四", institution: "另一券商", stance: "中性", date: "2026-05-30", argument: "需求恢复或慢于预期", sourceRef: "S1" },
    { analyst: "未知", institution: "未知", stance: "中性", date: "未知", argument: "只有图表没有署名", sourceRef: "S1" },
  ],
  expectations: [{ analyst: "张三", institution: "某券商", metric: "2026E 净利润", value: "10 亿元", date: "2026-06-20" }],
  risks: [{ threshold: "批价跌破 200 元", interpretation: "需求恢复证伪", attribution: "张三/某券商", date: "2026-06-20" }],
  timeline: [
    { date: "2026-06-20", headline: "首次覆盖给予看好", notes: [{ attribution: "张三/某券商", note: "目标价 100 元", date: "2026-06-20" }], sourceRefs: ["S1"] },
    { date: "2026-05-30", headline: "另一家给予中性", notes: [], sourceRefs: ["S1"] },
  ],
  question: null,
  answer: null,
  definition: null,
  structure: [],
  inputs: [],
  outputs: [],
  anchors: [],
  metrics: [],
  related: [],
};

const draft: CompiledDraft = {
  pages: [page],
  sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
  notes: "",
};

test("the format of a material is decided by its bytes", () => {
  assert.equal(detectFormat("note.pdf", samplePdf()), "pdf");
  assert.equal(detectFormat("note.docx", DOCX), "docx");
  assert.equal(detectFormat("slides.pptx", PPTX), "pptx");
  assert.equal(detectFormat("note.md", Buffer.from("# 标题\n正文", "utf8")), "markdown");
  assert.equal(detectFormat("note.pdf", Buffer.from("not a pdf", "utf8")), null, "a name that says pdf does not make it one");
  assert.equal(detectFormat("other.zip", zipSync({ "a/b.txt": strToU8("x") })), null);
});

test("text is read out of every accepted format", async () => {
  const markdown = await extractMaterial("markdown", Buffer.from("# 标题\n正文", "utf8"));
  assert.equal(markdown.status, "available");
  assert.match(markdown.text, /正文/);

  const docx = await extractMaterial("docx", DOCX);
  assert.equal(docx.status, "available");
  assert.match(docx.text, /标题：某公司深度报告/);
  assert.doesNotMatch(docx.text, /PAGE/, "field codes are not the document's text");

  const pptx = await extractMaterial("pptx", PPTX);
  assert.equal(pptx.status, "available");
  assert.equal(pptx.sections.length, 2);
  assert.match(pptx.text, /第二页：风险/);

  const pdf = await extractMaterial("pdf", samplePdf());
  assert.equal(pdf.status, "available");
  assert.match(pdf.text, /Research note on the target company/);
  assert.match(pdf.text, /<!-- 第 1 页 -->/, "each page keeps its anchor");
});

test("extraction is capped at a section edge and says so", async () => {
  const result = await extractMaterial("markdown", Buffer.from("a".repeat(100), "utf8"));
  const capped = capExtraction({ ...result, sections: [{ label: "正文", text: "b".repeat(100) }] }, 50);
  assert.equal(capped.truncated, true);
  assert.equal(capped.sections.length, 0);
});

test("a page is rendered in one shape, with the coverage counted from its own rows", () => {
  const { bodyMd, coverage } = renderPage(page, draft.sources, "doc-1");
  const sections = [...bodyMd.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sections, ["共识与分歧", "边际变化", "观点分布", "一致预期", "风险与证伪信号", "观点时间线", "Related Pages"]);
  assert.match(bodyMd, /\| 张三 \| 某券商 \| 看好 \| 2026-06-20 \|/);
  assert.match(bodyMd, /\[S1\]\(\/knowledge\/documents\/doc-1#S1\)/);
  assert.equal(coverage.analysts, 2, "an unknown author is not an analyst");
  assert.equal(coverage.firms, 2);
  assert.equal(coverage.reports, 1);
  assert.equal(coverage.first_report, "2026-05-30");
  assert.equal(coverage.last_report, "2026-06-20");
  assert.deepEqual(coverageOf(page), coverage);
});

test("the auditor may withdraw an entry or lower its attribution, and never adds one", () => {
  const corrected = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 2, action: "remove", field: null, reason: "只有图表，没有署名" },
    { pageSlug: page.slug, section: "stances", index: 1, action: "unknown_attribution", field: "institution", reason: "机构无法核实" },
  ]);
  assert.equal(corrected.draft.pages[0]!.stances.length, 2);
  assert.equal(corrected.draft.pages[0]!.stances[1]!.institution, "未知");
  assert.equal(corrected.draft.pages[0]!.stances[1]!.analyst, "李四");
  assert.ok(corrected.findings.length >= 2);
});

test("the machine finds what it can decide", () => {
  const findings = lintPage(page, new Set());
  const categories = findings.map(finding => finding.category);
  assert.ok(categories.includes("coverage-mismatch"), "the consensus needs a coverage statement");
  const nameless = lintPage({ ...page, stances: [{ ...page.stances[0]!, analyst: "", institution: "" }] }, new Set());
  assert.ok(nameless.some(finding => finding.category === "attribution-missing"), "an empty attribution is reported");
  const broken = lintPage({ ...page, stances: [{ ...page.stances[0]!, date: "去年" }] }, new Set());
  assert.ok(broken.some(finding => finding.level === "P0" && finding.category === "time-anchor-missing"));
  const vague = lintPage({ ...page, stances: [{ ...page.stances[0]!, analyst: "某分析师" }] }, new Set());
  assert.ok(vague.some(finding => finding.category === "attribution-vague"));
  const duplicated = lintDraft({ ...draft, pages: [page, page] }, new Set());
  assert.ok(duplicated.some(finding => finding.category === "duplicate-page"));
});

test("a question finds the pages that hold its subject, and only those", () => {
  const pages = [{
    slug: "view-company-example",
    title: "某公司",
    pageType: "view",
    targetName: "某公司",
    track: "食品饮料",
    bodyMd: renderPage(page, draft.sources, "doc-1").bodyMd,
    coverage: coverageOf(page),
  }];
  assert.ok(tokenize("某公司现在怎么看").includes("某公"));
  assert.equal(routePages("某公司现在怎么看", pages).length, 1);
  assert.equal(routePages("完全无关的问题", pages).length, 0, "a question nothing covers gets no page");
});

test("a page's freshness is read from the date of its newest source", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  assert.equal(freshnessTier("2026-06-20", now), "fresh");
  assert.equal(freshnessTier("2025-12-20", now), "semi");
  assert.equal(freshnessTier("2024-06-20", now), "stale");
  assert.equal(freshnessTier(null, now), "undated");
});
