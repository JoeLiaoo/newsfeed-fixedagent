// The pages of a PDF in a real build: the pages are drawn, frozen with the version, read, checked
// in a second and independent look, and the page says what was read and what was not. A synthetic
// PDF and a local model stub only; no real material and no paid model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { runWikiTask } from "../knowledge/worker.ts";
import { buildPdf } from "./pdf-fixture.ts";

type Message = { role: string; content: string | Array<{ type: string; text?: string }> };

const AUDIT = { verdict: "pass_with_issues", corrections: [], findings: [], notes: "" };
const calls = { read: 0, verify: 0, builder: 0, auditor: 0 };
/** Whether the first look only reads the first picture of a batch: the evidence of a cover alone. */
const onlyFirstPicture = { value: false };

/** The pictures a visual call carries. */
function figureIdsOf(user: Message["content"]): string[] {
  if (typeof user === "string") return [];
  const ids: string[] = [];
  for (const part of user) {
    if (!part.text) continue;
    try {
      const parsed = JSON.parse(part.text) as { figureId?: string };
      if (parsed.figureId) ids.push(parsed.figureId);
    } catch { /* the instruction is not a picture */ }
  }
  return ids;
}

const provider = await stub(async (_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Message[] };
  const system = typeof body.messages.find(message => message.role === "system")?.content === "string"
    ? body.messages.find(message => message.role === "system")!.content as string : "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  if (system.includes("独立复核步骤")) {
    calls.verify++;
    const ids = figureIdsOf(user);
    return { choices: [{ message: { content: JSON.stringify({ decisions: ids.map((figureId, index) => ({
      findingId: `${figureId}:F1`,
      decision: onlyFirstPicture.value && index > 0 ? "reject" : "accept",
      reason: "数字与图中标注一致",
    })) }) } }] };
  }
  if (system.includes("只观察所给图片")) {
    calls.read++;
    const ids = figureIdsOf(user);
    const figures = ids
      .filter((_figureId, index) => !onlyFirstPicture.value || index === 0)
      .map(figureId => ({ figureId, findings: [
        { id: "F1", figureId, statement: "页面显示 2026 年二季度收入同比增长 12%", visibleEvidence: "页面上方标注 12%", value: "12", unit: "%", period: "2026Q2", dataSource: "公司公告", limitations: [] },
        { id: "F2", figureId, statement: "页面显示净利润为 8.7 亿元", visibleEvidence: "页面下方表格", value: "8.7", unit: "亿元", period: "2026Q2", dataSource: null, limitations: [] },
      ] }));
    return { choices: [{ message: { content: JSON.stringify({ figures }) } }] };
  }
  if (system.includes("Builder")) {
    calls.builder++;
    const payload = JSON.parse(typeof user === "string" ? user : "") as { verifiedFigures?: Array<{ id: string; figureId: string }> };
    const verified = payload.verifiedFigures ?? [];
    return { choices: [{ message: { content: JSON.stringify({
      pages: [{
        pageType: "view", slug: "view-pdf-example", title: "某公司", targetType: "公司", targetName: "某公司", track: "食品饮料",
        consensus: "", divergences: [], marginalChanges: [], stances: [], expectations: [], risks: [], timeline: [],
        question: null, answer: null, definition: null, structure: [], inputs: [], outputs: [], anchors: [], metrics: [], related: [],
        figureRefs: verified.length ? [{ figureId: verified[0]!.figureId, findingIds: [verified[0]!.id] }] : [],
      }],
      sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
      notes: "研报材料",
    }) } }] };
  }
  if (system.includes("Auditor")) {
    calls.auditor++;
    return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  }
  return { choices: [{ message: { content: JSON.stringify({}) } }] };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });

type Fixture = { documentId: string; versionId: string; taskId: string };

/** A material that is a PDF: the bytes of the file and the task that builds it. */
async function fixture(suffix: string, pdf: Buffer): Promise<Fixture> {
  const [user] = await sql<{ id: string }[]>`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${randomUUID()},${`pdf-user-${suffix}`},'员工甲','test-hash','active','member') RETURNING id`;
  const documentId = randomUUID();
  const versionId = randomUUID();
  const taskId = randomUUID();
  await sql`INSERT INTO member_wiki_documents(id,uploader_id,title,status) VALUES(${documentId},${user!.id},'研报材料','active')`;
  await sql`INSERT INTO member_wiki_document_versions(id,document_id,version_no,uploader_id,format,media_type,file_name,body,byte_size,sha256,source_title,extraction_status)
    VALUES(${versionId},${documentId},1,${user!.id},'pdf','application/pdf','report.pdf',${pdf},${pdf.length},${"pdf-sha-${suffix}"},${"研报材料"},'pending')`;
  await sql`INSERT INTO member_wiki_tasks(id,document_id,version_id,uploader_id,stage,state) VALUES(${taskId},${documentId},${versionId},${user!.id},'queued','queued')`;
  return { documentId, versionId, taskId };
}

const withPages = buildPdf([
  { lines: ["Company revenue grew twelve percent in 2026Q2; management gave no full-year guidance and left the pace of demand recovery open."] },
  { drawing: true },
]);

test("a PDF is drawn page by page, and the page says what was read", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); await provider.close(); });
  const suffix = tag();
  const previous = { flag: process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED, vision: process.env.LLM_VISION };
  process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED = "true";
  process.env.LLM_VISION = "true";
  t.after(() => {
    if (previous.flag === undefined) delete process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED;
    else process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED = previous.flag;
    if (previous.vision === undefined) delete process.env.LLM_VISION;
    else process.env.LLM_VISION = previous.vision;
  });

  // With the switch off, no page is drawn and no model is asked about one; the text is built.
  process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED = "false";
  const off = await fixture(`${suffix}-off`, withPages);
  const before = { ...calls };
  await runWikiTask(off.taskId);
  const [offTask] = await sql<{ state: string; error_code: string | null }[]>`SELECT state, error_code FROM member_wiki_tasks WHERE id=${off.taskId}`;
  assert.equal(offTask?.state, "succeeded", `the build failed: ${offTask?.error_code ?? "unknown"}`);
  const offAssets = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM member_wiki_figure_assets WHERE version_id=${off.versionId}`;
  assert.equal(offAssets[0]?.count, "0", "a build with the switch off draws no page");
  assert.deepEqual({ read: calls.read, verify: calls.verify }, { read: before.read, verify: before.verify }, "no model is asked about pictures");
  process.env.MEMBER_KNOWLEDGE_FIGURES_ENABLED = "true";

  // With the switch on, the pages are drawn, frozen with the version, read and checked.
  const on = await fixture(`${suffix}-on`, withPages);
  await runWikiTask(on.taskId);
  const [onTask] = await sql<{ state: string; error_code: string | null }[]>`SELECT state, error_code FROM member_wiki_tasks WHERE id=${on.taskId}`;
  assert.equal(onTask?.state, "succeeded", `the build failed: ${onTask?.error_code ?? "unknown"}`);
  const assets = await sql<{ ordinal: number; locator: { kind: string; page: number } }[]>`
    SELECT ordinal, locator FROM member_wiki_figure_assets WHERE version_id=${on.versionId} ORDER BY ordinal`;
  assert.equal(assets.length, 2, "both pages of the material are drawn");
  assert.deepEqual(assets.map(asset => asset.locator.page), [1, 2], "each picture knows the page it came from");
  assert.equal(assets[0]?.locator.kind, "pdf");
  const [checkpoint] = await sql<{ figure_checkpoint: { coverage: { status: string; read: boolean; processed: number; evidenced: number; pages: Array<{ total: number; textPages: number[]; visualPages: number[] }> } } }[]>`
    SELECT figure_checkpoint FROM member_wiki_tasks WHERE id=${on.taskId}`;
  const coverage = checkpoint!.figure_checkpoint.coverage;
  assert.equal(coverage.read, true);
  assert.equal(coverage.processed, 2, "both pages entered the visual steps");
  assert.equal(coverage.evidenced, 2, "both pages carry evidence that survived the second look");
  assert.equal(coverage.pages[0]?.total, 2, "the material has two pages");
  assert.deepEqual(coverage.pages[0]?.textPages, [1], "the text layer gave the first page only");
  assert.deepEqual(coverage.pages[0]?.visualPages, [1, 2], "both pages were drawn");

  const [revision] = await sql<{ body_md: string }[]>`SELECT body_md FROM member_wiki_page_revisions ORDER BY revision DESC LIMIT 1`;
  assert.ok(revision, "the build published a page");
  assert.match(revision!.body_md, /## 图表证据/);
  assert.match(revision!.body_md, /## 读取范围/);
  assert.match(revision!.body_md, /共 2 页/);
  assert.match(revision!.body_md, /文字层读取第 1 页/);
  assert.match(revision!.body_md, /页面识图覆盖第 1–2 页/);
  assert.match(revision!.body_md, /本次为部分读取，不代表整份材料的完整理解/);

  // A scan whose only evidence is the cover is not a report that was read.
  onlyFirstPicture.value = true;
  const scan = buildPdf([{ drawing: true }, { drawing: true }]);
  const item = await fixture(`${suffix}-scan`, scan);
  await runWikiTask(item.taskId);
  onlyFirstPicture.value = false;
  const [task] = await sql<{ state: string; error_code: string | null; error_message: string | null }[]>`
    SELECT state, error_code, error_message FROM member_wiki_tasks WHERE id=${item.taskId}`;
  assert.equal(task?.state, "failed");
  assert.equal(task?.error_code, "knowledge_pdf_cover_only", "a cover is not a report that was read");
  assert.equal(task?.error_message, "这份扫描件只识别到封面，没有取得可核实的正文图表证据，未生成知识页。");
});
