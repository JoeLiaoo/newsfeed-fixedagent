// The parts of the shared library that need no database: what a material is, what can be read out of
// it, how a draft becomes a page, what the machine can check, and how a question finds its pages.
import assert from "node:assert/strict";
import { verifyAnswer } from "../knowledge/answer.ts";
import { answerSchema } from "../knowledge/schema.ts";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { capExtraction, detectFormat, extractMaterial } from "../knowledge/extract.ts";
import { applyCorrections, coverageOf, renderPage } from "../knowledge/render.ts";
import { aggregateContributions, targetKeyOf, type Contribution } from "../knowledge/aggregate.ts";
import { lintDraft, lintPage } from "../knowledge/lint.ts";
import { routePages, tokenize } from "../knowledge/routing.ts";
import { freshnessTier } from "../knowledge/catalog.ts";
import { DEFAULT_BASE_ID, baseSlugOf, scopedSlug, scopedTargetKey } from "../knowledge/bases.ts";
import type { CompiledDraft, PageDraft, SourceRecord } from "../knowledge/schema.ts";

/** A one-page PDF with a line of text, built here so the test carries its own material. */
function samplePdf(text = "Research note on the target company"): Buffer {
  const lines = String(text).split("\n");
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((line, index) => `${index ? "0 -14 Td " : ""}(${line}) Tj`).join(" ")} ET`;
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
  assert.equal(capped.sections.length, 1, "a section that is too long still leaves a prefix behind");
  assert.ok(capped.text.length > 0, "the material is never cut down to nothing");
  assert.ok(capped.text.length <= 50, "the anchors and the separators are counted in the budget");
  assert.match(capped.text, /^<!-- 正文 -->/);
});

test("a material that fits the budget is kept whole", async () => {
  const body = "a".repeat(40);
  const anchor = "<!-- 正文 -->\n".length;
  const result = await extractMaterial("markdown", Buffer.from(body, "utf8"));
  const exact = capExtraction({ ...result, sections: [{ label: "正文", text: body }] }, body.length + anchor);
  assert.equal(exact.truncated, false);
  assert.match(exact.text, /a{40}/);
  assert.equal(exact.text.length, body.length + anchor);
  const over = capExtraction({ ...result, sections: [{ label: "正文", text: body }] }, body.length + anchor - 1);
  assert.equal(over.truncated, true);
  assert.ok(over.text.length > 0);
  assert.ok(over.text.length <= body.length + anchor - 1);
});

test("a single section that is longer than the budget still gives the build text", async () => {
  const result = await extractMaterial("markdown", Buffer.from("x".repeat(500), "utf8"));
  const capped = capExtraction({ ...result, sections: [{ label: "正文", text: "x".repeat(500) }] }, 100);
  assert.equal(capped.truncated, true);
  assert.ok(capped.text.length > 0, "an over-long section is not cut down to nothing");
  assert.ok(capped.text.length <= 100);
  assert.equal(capped.sections.length, 1);
});

test("a one-page PDF that is longer than the budget keeps a readable part", async () => {
  const pdf = await extractMaterial("pdf", samplePdf(Array.from({ length: 20 }, () => "A".repeat(60)).join("\n")));
  assert.equal(pdf.status, "available");
  assert.ok(pdf.text.length > 120, "the page is longer than the budget");
  const capped = capExtraction(pdf, 120);
  assert.equal(capped.truncated, true);
  assert.ok(capped.text.length > 0, "a long page still gives the build something to read");
  assert.ok(capped.text.length <= 120);
  assert.equal(capped.sections.length, 1);
});

test("the cap keeps as many sections as fit and no more", async () => {
  const result = await extractMaterial("markdown", Buffer.from("a", "utf8"));
  const sections = [
    { label: "第一节", text: "a".repeat(40) },
    { label: "第二节", text: "b".repeat(40) },
    { label: "第三节", text: "c".repeat(40) },
  ];
  const capped = capExtraction({ ...result, sections }, 120);
  assert.equal(capped.truncated, true);
  assert.equal(capped.sections.length, 2, "the third section does not fit in the budget");
  assert.ok(capped.text.length <= 120);
  assert.match(capped.text, /第一节/);
  assert.match(capped.text, /第二节/);
  assert.doesNotMatch(capped.text, /第三节/);
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

test("the auditor's indices point at the draft it read, not at a list that is being shortened", () => {
  const two = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 0, action: "remove", field: null, reason: "第一条没有依据" },
    { pageSlug: page.slug, section: "stances", index: 2, action: "remove", field: null, reason: "第三条没有依据" },
  ]);
  assert.deepEqual(two.draft.pages[0]!.stances.map(stance => stance.analyst), ["李四"], "两条按原下标撤回，第三条仍在");

  const mixed = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 2, action: "remove", field: null, reason: "第三条没有依据" },
    { pageSlug: page.slug, section: "stances", index: 0, action: "unknown_attribution", field: "analyst", reason: "分析师无法核实" },
  ]);
  assert.deepEqual(mixed.draft.pages[0]!.stances.map(stance => stance.analyst), ["未知", "李四"]);
  assert.equal(mixed.draft.pages[0]!.stances[0]!.institution, "某券商", "降级落在原条目上");
  assert.equal(mixed.draft.pages[0]!.stances[1]!.analyst, "李四");

  const order = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 0, action: "remove", field: null, reason: "第一条没有依据" },
    { pageSlug: page.slug, section: "stances", index: 2, action: "remove", field: null, reason: "第三条没有依据" },
  ]);
  assert.deepEqual(order.draft.pages[0]!.stances.map(stance => stance.analyst), two.draft.pages[0]!.stances.map(stance => stance.analyst),
    "撤回的顺序不影响结果");

  const duplicated = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 1, action: "remove", field: null, reason: "重复的撤回" },
    { pageSlug: page.slug, section: "stances", index: 1, action: "remove", field: null, reason: "重复的撤回" },
  ]);
  assert.equal(duplicated.draft.pages[0]!.stances.length, 2, "同一条不会被撤回两次");

  const outOfRange = applyCorrections(draft, [
    { pageSlug: page.slug, section: "stances", index: 9, action: "remove", field: null, reason: "指向不存在的条目" },
  ]);
  assert.equal(outOfRange.draft.pages[0]!.stances.length, 3, "越界的修正不动原列表");
  assert.ok(outOfRange.findings.some(finding => finding.category === "correction-out-of-range"));
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
    revisionId: "rev-1",
    citations: [],
  }];
  assert.ok(tokenize("某公司现在怎么看").includes("某公"));
  assert.equal(routePages("某公司现在怎么看", pages).length, 1);
  assert.equal(routePages("完全无关的问题", pages).length, 0, "a question nothing covers gets no page");
  assert.equal(routePages("完全没有覆盖的问题主题", pages).length, 0, "one shared word is not a match");
});

test("a page's freshness is read from the date of its newest source", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  assert.equal(freshnessTier("2026-06-20", now), "fresh");
  assert.equal(freshnessTier("2025-12-20", now), "semi");
  assert.equal(freshnessTier("2024-06-20", now), "stale");
  assert.equal(freshnessTier(null, now), "undated");
});

/** One material's contribution to a target's page. */
function contributionOf(overrides: Partial<Contribution> & { versionId: string; documentId: string }): Contribution {
  return {
    versionNo: 1,
    createdAt: "2026-06-20T00:00:00.000Z",
    taskId: `task-${overrides.versionId}`,
    targetKey: targetKeyOf(page),
    page,
    sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
    attribution: "某券商 2026-06-20",
    materialTitle: "某公司深度报告",
    ...overrides,
  };
}

test("two materials about the same target keep their own viewpoints", () => {
  const other: PageDraft = {
    ...page,
    stances: [{ analyst: "王五", institution: "另一券商", stance: "中性", date: "2026-07-01", argument: "需求恢复偏慢", sourceRef: "S1" }],
    timeline: [{ date: "2026-07-01", headline: "另一家维持中性", notes: [], sourceRefs: ["S1"] }],
  };
  const merged = aggregateContributions([
    contributionOf({ versionId: "v1", documentId: "doc-1" }),
    contributionOf({ versionId: "v2", documentId: "doc-2", page: other, sources: [{ ref: "S1", institution: "另一券商", authors: ["王五"], date: "2026-07-01", dateBasis: "首页", kind: "点评" }], attribution: "另一券商 2026-07-01", materialTitle: "某公司点评" }),
  ]);
  assert.equal(merged.page.stances.length, 4, "后一份材料不会替掉前一份的观点");
  assert.deepEqual(merged.page.stances.map(stance => stance.analyst), ["张三", "李四", "未知", "王五"]);
  assert.deepEqual(merged.page.stances.map(stance => stance.sourceRef), ["S1", "S1", "S1", "S2"], "两份材料的同名来源不会混在一起");
  assert.deepEqual(merged.sources.map(source => source.documentId), ["doc-1", "doc-2"]);
  assert.equal(merged.citations.length, 4);
  assert.deepEqual(merged.citations.map(citation => citation.versionId), ["v1", "v1", "v1", "v2"]);
  const body = renderPage(merged.page, merged.sources, "doc-1").bodyMd;
  assert.match(body, /\[S1\]\(\/knowledge\/documents\/doc-1#S1\)/);
  assert.match(body, /\[S2\]\(\/knowledge\/documents\/doc-2#S2\)/);
  assert.match(body, /另一券商 2026-07-01/, "每份材料的共识各自标出出处");
});

test("updating one material replaces only that material's contribution", () => {
  const other: PageDraft = {
    ...page,
    stances: [{ analyst: "王五", institution: "另一券商", stance: "中性", date: "2026-07-01", argument: "需求恢复偏慢", sourceRef: "S1" }],
  };
  const first = contributionOf({ versionId: "v1", documentId: "doc-1" });
  const second = contributionOf({ versionId: "v2", documentId: "doc-2", page: other, sources: [{ ref: "S1", institution: "另一券商", authors: ["王五"], date: "2026-07-01", dateBasis: "首页", kind: "点评" }] });
  const updated: PageDraft = { ...page, stances: [{ analyst: "张三", institution: "某券商", stance: "看好", date: "2026-08-01", argument: "渠道库存继续下降", sourceRef: "S1" }] };
  const merged = aggregateContributions([contributionOf({ versionId: "v1", documentId: "doc-1", page: updated }), second]);
  assert.deepEqual(merged.page.stances.map(stance => stance.analyst), ["张三", "王五"], "新材料只换掉自己的那一份");
  assert.equal(merged.page.stances.length, 2);
});


test("answer provenance rejects mixed or unbound citations and derives freshness from the evidence used", () => {
  const pages = [{
    slug: page.slug, title: page.title, pageType: page.pageType, targetName: page.targetName,
    track: page.track, bodyMd: "published", coverage: { ...coverageOf(page), last_report: "2026-10-01" }, revisionId: "r1",
    citations: [{ id: "old", label: "S1", analyst: "张三", organization: "券商", publishedOn: "2024-01-01", anchor: null, sourceTitle: "old", versionId: "v-old" }],
  }];
  const citation = { label: "1", pageSlug: page.slug, citationId: "old" };
  const valid = { answer: "历史观点[^1]", citations: [citation] };
  const trusted = verifyAnswer(answerSchema.parse({ ...valid, coverage: { analysts: 200 } }), pages, new Date("2026-10-24T00:00:00Z"));
  assert.equal(trusted.coverage.analysts, 1);
  assert.equal(trusted.coverage.reports, 1);
  assert.equal(trusted.freshness[0]?.tier, "stale", "a fresh page must not make an old cited report fresh");
  for (const invalid of [
    { answer: "valid[^1] unverified[^2]", citations: [citation, { ...citation, label: "2", citationId: "invented" }] },
    { answer: "unbound[^2]", citations: [citation] },
    { answer: "claim without marker", citations: [citation] },
    { ...valid, citations: [citation, citation] },
    { ...valid, citations: [{ ...citation, pageSlug: "not-routed" }] },
  ]) assert.throws(() => verifyAnswer(invalid, pages), /knowledge_answer_unverified/);
});


test("a heading before an oversized paragraph does not consume the entire extraction", async () => {
  const extracted = await extractMaterial("markdown", Buffer.from("# Heading\n" + "x".repeat(70_000)));
  const capped = capExtraction(extracted, 60_000);
  assert.ok(capped.text.length > 59_000, "keep a useful prefix rather than only the short heading");
  assert.ok(capped.text.length <= 60_000);
});


test("every knowledge base has a key space and a slug space of its own", () => {
  // The shared base keeps the keys and slugs its pages already carry, so the pages that are
  // published stay the pages of that base.
  assert.equal(scopedTargetKey(DEFAULT_BASE_ID, "view|company|某公司"), "view|company|某公司");
  assert.equal(scopedSlug(DEFAULT_BASE_ID, "view-company-example"), "view-company-example");
  assert.equal(baseSlugOf("view-company-example", DEFAULT_BASE_ID), "view-company-example");

  // Another base has a space of its own, so two bases may hold a page about the same target.
  assert.equal(scopedTargetKey("kb-abc", "view|company|某公司"), "kb-abc|view|company|某公司");
  assert.equal(scopedSlug("kb-abc", "view-company-example"), "kb-abc-view-company-example");
  assert.equal(baseSlugOf("kb-abc-view-company-example", "kb-abc"), "view-company-example");
  assert.notEqual(scopedTargetKey("kb-abc", "view|company|某公司"), scopedTargetKey("kb-xyz", "view|company|某公司"));
  assert.notEqual(scopedSlug("kb-abc", "view-company-example"), scopedSlug("kb-xyz", "view-company-example"));
});


test("answer citations accept complete published names with base and collision suffixes", () => {
  const raw = "a".repeat(80);
  const published = `${scopedSlug("kb-123456789abc", raw)}-12345678`;
  const parsed = answerSchema.parse({
    answer: "依据[^1]。",
    citations: [{ label: "1", pageSlug: published, citationId: "citation-id" }],
  });
  assert.equal(parsed.citations[0]?.pageSlug, published);
  assert.equal(published.length, 105);
  assert.equal(answerSchema.parse({
    answer: "依据[^1]。",
    citations: [{ label: "1", pageSlug: raw, citationId: "citation-id" }],
  }).citations[0]?.pageSlug, raw, "shared base names stay unchanged");
});
