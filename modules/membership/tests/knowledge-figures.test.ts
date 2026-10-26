// The figure steps of a public page: the pictures are frozen first, read once, checked in a second
// and independent look, and only what survives the second look reaches the page. Synthetic pictures
// and a local model stub only; no real material and no paid model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import sharp from "sharp";
import { runWikiTask } from "../knowledge/worker.ts";
import { snapshotFigures, processFigures, type FigureManifest } from "../knowledge/figures.ts";

type Message = { role: string; content: string | Array<{ type: string; text?: string }> };

const AUDIT = { verdict: "pass_with_issues", corrections: [], findings: [], notes: "" };
const MANIFEST: FigureManifest = {
  pipelineVersion: 1,
  htmlSha256: "html-sha",
  candidatesTruncated: false,
  candidates: [
    { url: "https://example.com/a.png", caption: "图一", context: "上下文", ordinal: 1 },
    { url: "https://example.com/b.png", caption: "图二", context: null, ordinal: 2 },
    { url: "https://example.com/c.png", caption: "图三", context: null, ordinal: 3 },
  ],
};

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

const calls = { read: 0, verify: 0, builder: 0, auditor: 0 };
/**
 * The second look accepts one fact of the first picture of every batch and refuses everything else:
 * a number nobody checked, or a number the picture does not carry, never becomes a fact.
 */
const provider = await stub(async (_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Message[] };
  const system = typeof body.messages.find(message => message.role === "system")?.content === "string"
    ? body.messages.find(message => message.role === "system")!.content as string : "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  if (system.includes("独立复核步骤")) {
    calls.verify++;
    const ids = figureIdsOf(user);
    const firstBatch = calls.verify === 1;
    return { choices: [{ message: { content: JSON.stringify({ decisions: ids.flatMap((figureId, index) => firstBatch && index === 0
      ? [{ findingId: `${figureId}:F1`, decision: "accept", reason: "数字与图中标注一致" },
        { findingId: `${figureId}:F2`, decision: "reject", reason: "图中没有这个数值" }]
      : [{ findingId: `${figureId}:F1`, decision: "reject", reason: "图中数字无法确认" },
        { findingId: `${figureId}:F2`, decision: "reject", reason: "图中没有这个数值" }]) }) } }] };
  }
  if (system.includes("只观察所给图片")) {
    calls.read++;
    const ids = figureIdsOf(user);
    return { choices: [{ message: { content: JSON.stringify({ figures: ids.map(figureId => ({ figureId, findings: [
      { id: "F1", figureId, statement: `${figureId} 显示 2026 年二季度收入同比增长 12%`, visibleEvidence: "图右上角标注 12%", value: "12", unit: "%", period: "2026Q2", dataSource: "公司公告", limitations: [] },
      { id: "F2", figureId, statement: `${figureId} 显示净利润为 8.7 亿元`, visibleEvidence: "图下方表格", value: "8.7", unit: "亿元", period: "2026Q2", dataSource: null, limitations: [] },
    ] })) }) } }] };
  }
  if (system.includes("Builder")) {
    calls.builder++;
    // The Builder may only pick figures the platform already verified.
    const payload = JSON.parse(typeof user === "string" ? user : "") as { verifiedFigures?: Array<{ id: string; figureId: string }> };
    const verified = payload.verifiedFigures ?? [];
    return { choices: [{ message: { content: JSON.stringify({
      pages: [{
        pageType: "view", slug: "view-figure-example", title: "图表材料", targetType: "公司", targetName: "某公司", track: "食品饮料",
        consensus: "", divergences: [], marginalChanges: [], stances: [], expectations: [], risks: [], timeline: [],
        question: null, answer: null, definition: null, structure: [], inputs: [], outputs: [], anchors: [], metrics: [], related: [],
        figureRefs: verified.length ? [{ figureId: verified[0]!.figureId, findingIds: [verified[0]!.id] }] : [],
      }],
      sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
      notes: "图表材料",
    }) } }] };
  }
  if (system.includes("Auditor")) {
    calls.auditor++;
    return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  }
  return { choices: [{ message: { content: JSON.stringify({}) } }] };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });

type Fixture = { documentId: string; versionId: string; taskId: string; figureIds: string[] };

/** A public page whose body is short: the pictures carry the content. */
async function fixture(suffix: string, withManifest: boolean): Promise<Fixture> {
  const [user] = await sql<{ id: string }[]>`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${randomUUID()},${`figure-user-${suffix}`},'员工甲','test-hash','active','member') RETURNING id`;
  const documentId = randomUUID();
  const versionId = randomUUID();
  const taskId = randomUUID();
  await sql`INSERT INTO member_wiki_documents(id,uploader_id,title,status) VALUES(${documentId},${user!.id},'图表材料','active')`;
  await sql`INSERT INTO member_wiki_document_versions(id,document_id,version_no,uploader_id,format,media_type,file_name,body,byte_size,sha256,source_url,source_title,extraction_status)
    VALUES(${versionId},${documentId},1,${user!.id},'markdown','text/markdown','report.md',${Buffer.from("图表说明。", "utf8")},${Buffer.byteLength("图表说明。")},${"sha"},${"https://example.com/report"},${"图表材料"},'pending')`;
  const figureIds: string[] = [];
  if (withManifest) {
    await sql`UPDATE member_wiki_document_versions SET figure_manifest=${sql.json(MANIFEST as never)} WHERE id=${versionId}`;
    const picture = await sharp({ create: { width: 320, height: 200, channels: 3, background: "white" } }).jpeg().toBuffer();
    for (const ordinal of [1, 2, 3]) {
      const figureId = randomUUID();
      figureIds.push(figureId);
      await sql`INSERT INTO member_wiki_figure_assets(id,version_id,ordinal,locator,caption,context,original_sha256,normalized_sha256,original_body,normalized_body,media_type,width,height)
        VALUES(${figureId},${versionId},${ordinal},${sql.json({ kind: "html", label: `图 ${ordinal}` })},${`图 ${ordinal}`},null,${"o"},${"n"},${picture},${picture},'image/jpeg',320,200)`;
    }
  }
  await sql`INSERT INTO member_wiki_tasks(id,document_id,version_id,uploader_id,stage,state) VALUES(${taskId},${documentId},${versionId},${user!.id},'queued','queued')`;
  return { documentId, versionId, taskId, figureIds };
}

/** The lease a build holds while it works. */
async function lease(taskId: string, token: string) {
  await sql`UPDATE member_wiki_tasks SET state='running', lease_token=${token}, lease_expires_at=now() + interval '5 minutes' WHERE id=${taskId}`;
}

test("the figure steps read, verify and publish only what survived the second look", async t => {
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

  // With the switch off, no picture is downloaded and no model is asked about one.
  const off = await fixture(`${suffix}-off`, false);
  await lease(off.taskId, "lease-off");
  const before = { ...calls };
  const offCheckpoint = await snapshotFigures(off.taskId, "lease-off", off.versionId, MANIFEST, null);
  assert.equal(offCheckpoint.coverage.read, false);
  assert.deepEqual(calls, before, "a build with the switch off asks no model about pictures");

  // With the switch on, the pictures are read in batches of two and checked once each.
  const item = await fixture(`${suffix}-on`, true);
  await lease(item.taskId, "lease-on");
  const checkpoint = await processFigures(item.taskId, "lease-on", item.versionId, MANIFEST, null);
  assert.equal(checkpoint.coverage.read, true);
  assert.equal(checkpoint.verifiedFindings.length, 1, "only the fact the second look accepted is evidence");
  assert.ok(checkpoint.verifiedFindings.every(finding => finding.id.endsWith(":F1")));
  assert.equal(checkpoint.coverage.processed, 3, "three pictures entered the visual steps");
  assert.equal(checkpoint.coverage.evidenced, 1);
  assert.equal(checkpoint.coverage.unreadable, 2);
  assert.equal(checkpoint.coverage.status, "partial", "a partly read page says so");
  assert.equal(calls.read, before.read + 2, "three pictures are read in two calls of at most two");
  assert.equal(calls.verify, before.verify + 2);

  // A second run over the same checkpoint asks no model again: the answer is not paid for twice.
  const again = await processFigures(item.taskId, "lease-on", item.versionId, MANIFEST, checkpoint);
  assert.equal(again.evidenceDigest, checkpoint.evidenceDigest);
  assert.equal(calls.read, before.read + 2, "a finished batch is not read again");

  // The build publishes the page with the figure evidence and its citation.
  await sql`UPDATE member_wiki_tasks SET figure_checkpoint=${sql.json(checkpoint as never)}, state='queued', lease_token=NULL, lease_expires_at=NULL WHERE id=${item.taskId}`;
  await runWikiTask(item.taskId);
  const [task] = await sql<{ state: string; error_code: string | null }[]>`SELECT state, error_code FROM member_wiki_tasks WHERE id=${item.taskId}`;
  assert.equal(task?.state, "succeeded", `the build failed: ${task?.error_code ?? "unknown"}`);
  const [revision] = await sql<{ body_md: string; coverage: { figureCoverage?: { status: string } } }[]>`
    SELECT body_md, coverage FROM member_wiki_page_revisions ORDER BY revision DESC LIMIT 1`;
  assert.ok(revision, "the build published a page");
  assert.match(revision!.body_md, /## 图表证据/);
  assert.match(revision!.body_md, /2026 年二季度收入同比增长 12%/);
  assert.doesNotMatch(revision!.body_md, /8\.7 亿元/, "a fact the second look refused never reaches the page");
  assert.equal(revision!.coverage.figureCoverage?.status, "partial");
  assert.equal(calls.read, before.read + 2, "the build reuses the frozen reading");
});
