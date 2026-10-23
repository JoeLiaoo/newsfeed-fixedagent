// The shared library under two employees and a visitor: who may see what, what an upload does to the
// library, what a failed build leaves behind, and what an answer is allowed to rest on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { runWikiTask } from "../knowledge/worker.ts";

const DRAFT = {
  pages: [{
    pageType: "view",
    slug: "view-company-example",
    title: "某公司",
    targetType: "公司",
    targetName: "某公司",
    track: "食品饮料",
    consensus: "基于 1 家机构 1 位分析师 1 篇材料：多数看好。",
    divergences: [{ point: "需求恢复节奏", sides: [{ attribution: "张三/某券商", argument: "库存低位", date: "2026-06-20" }] }],
    marginalChanges: [{ date: "2026-06-20", attribution: "张三/某券商", note: "首次覆盖" }],
    stances: [{ analyst: "张三", institution: "某券商", stance: "看好", date: "2026-06-20", argument: "渠道库存低位", sourceRef: "S1" }],
    expectations: [],
    risks: [{ threshold: "批价跌破 200 元", interpretation: "需求恢复证伪", attribution: "张三/某券商", date: "2026-06-20" }],
    timeline: [{ date: "2026-06-20", headline: "首次覆盖给予看好", notes: [], sourceRefs: ["S1"] }],
    question: null,
    answer: null,
    definition: null,
    structure: [],
    inputs: [],
    outputs: [],
    anchors: [],
    metrics: [],
    related: [],
  }],
  sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
  notes: "测试用草稿",
};

const AUDIT = { verdict: "pass_with_issues", corrections: [], findings: [{ level: "advisory", category: "coverage-mismatch", target: "view-company-example", message: "覆盖较薄", evidence: null }], notes: "" };

const ANSWER = {
  answer: "综合已覆盖的材料，某公司当前以张三/某券商的看好为主[^1]。\n\n参考资料：\n[^1]: 某公司 观点页",
  citations: [{ label: "1", pageSlug: "view-company-example", title: "某公司", analyst: "张三", organization: "某券商", publishedOn: "2026-06-20", anchor: null }],
  coverage: { analysts: 1, firms: 1, reports: 1, firstReport: "2026-06-20", lastReport: "2026-06-20", note: null },
  freshness: [{ pageSlug: "view-company-example", tier: "fresh", lastReport: "2026-06-20" }],
};

const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const system = body.messages.find(message => message.role === "system")?.content ?? "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  if (system.includes("Builder")) {
    if (user.includes("FAILME")) return { choices: [{ message: { content: "这不是 JSON" } }] };
    return { choices: [{ message: { content: JSON.stringify(DRAFT) } }] };
  }
  if (system.includes("Auditor")) return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  return { choices: [{ message: { content: JSON.stringify(ANSWER) } }] };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });

test("the shared library is open to approved employees and closed to everyone else", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); await provider.close(); });
  const suffix = tag();
  const accounts = [
    { username: `wiki-a-${suffix}`, realName: "员工甲", password: "long-test-password-123" },
    { username: `wiki-b-${suffix}`, realName: "员工乙", password: "long-test-password-123" },
  ];
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  for (const account of accounts) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
    assert.equal(registered.statusCode, 201);
  }
  await sql`UPDATE member_users SET status='active' WHERE username IN (${accounts[0]!.username},${accounts[1]!.username})`;
  const cookies: string[] = [];
  for (const account of accounts) {
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!);
  }
  // A visitor is turned away before any route runs.
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/overview", headers: common })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: common })).statusCode, 401);

  const material = Buffer.from("# 某公司深度报告\n\n张三/某券商，2026-06-20：看好，目标价 100 元。\n", "utf8").toString("base64");
  const upload = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: material, title: "某公司深度报告", author: "张三", organization: "某券商", date: "2026-06-20", kind: "深度报告" },
  });
  assert.equal(upload.statusCode, 202);
  const uploaded = await upload.json() as { documentId: string; versionId: string; taskId: string; duplicate: boolean };
  assert.equal(uploaded.duplicate, false);

  // The same material again is recognised, and does not build twice.
  const again = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: material, title: "某公司深度报告" },
  });
  assert.equal(again.statusCode, 200);
  assert.equal((await again.json() as { duplicate: boolean; taskId: string | null }).duplicate, true);

  await runWikiTask(uploaded.taskId);
  const built = await sql`SELECT state, stage FROM member_wiki_tasks WHERE id = ${uploaded.taskId}`;
  assert.equal(built[0]?.state, "succeeded");
  const pages = await sql`SELECT slug, status FROM member_wiki_pages`;
  assert.deepEqual(pages.map(page => page.slug), ["view-company-example"]);
  const revisions = await sql`SELECT body_md, coverage FROM member_wiki_page_revisions`;
  assert.match(revisions[0]!.body_md, /## 观点分布/);
  assert.match(revisions[0]!.body_md, /\| 张三 \| 某券商 \| 看好 \| 2026-06-20 \|/);
  assert.equal((revisions[0]!.coverage as { analysts: number }).analysts, 1);
  const citations = await sql`SELECT label, analyst, organization FROM member_wiki_citations`;
  assert.deepEqual(citations.map(citation => citation.label), ["S1"]);
  assert.equal(citations[0]?.analyst, "张三");

  // The other employee sees the same library, and may read the original.
  const shared = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[1]!, ...common } });
  assert.equal(shared.statusCode, 200);
  assert.equal((await shared.json() as { pages: unknown[] }).pages.length, 1);
  const original = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(original.statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: common })).statusCode, 401);

  // A new version of the same material is a new build; the published page stays readable while it runs.
  const updated = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: Buffer.from("# 某公司深度报告（更新）\n\n张三/某券商，2026-08-20：维持看好。\n", "utf8").toString("base64"), documentId: uploaded.documentId },
  });
  assert.equal(updated.statusCode, 202);
  const second = await updated.json() as { versionId: string; taskId: string; versionNo: number };
  assert.equal(second.versionNo, 2);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[1]!, ...common } })).statusCode, 200);

  // A build whose model output is unusable fails, and leaves the published page alone.
  const broken = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "失败材料.md", base64: Buffer.from("FAILME 这份材料无法编译", "utf8").toString("base64") },
  });
  const brokenTask = (await broken.json() as { taskId: string }).taskId;
  await runWikiTask(brokenTask);
  const failed = await sql`SELECT state, error_code FROM member_wiki_tasks WHERE id = ${brokenTask}`;
  assert.equal(failed[0]?.state, "failed");
  assert.equal(failed[0]?.error_code, "knowledge_model_output_invalid");
  const stillPublished = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[1]!, ...common } });
  assert.equal(stillPublished.statusCode, 200, "a failed build does not take the published pages down");

  // A failed build can be run again.
  const retried = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/tasks/${brokenTask}/retry`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(retried.statusCode, 202);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/tasks/${brokenTask}/retry`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404,
    "only the uploader runs a build again");

  // An answer rests on the published pages, and says what it rests on.
  const answer = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司现在怎么看？" } });
  assert.equal(answer.statusCode, 200);
  const answered = await answer.json() as { answer: { answerMd: string; citations: Array<{ pageSlug: string }> } };
  assert.match(answered.answer.answerMd, /\/knowledge\/targets\/view-company-example/);
  assert.deepEqual(answered.answer.citations.map(citation => citation.pageSlug), ["view-company-example"]);
  const uncovered = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "完全没有覆盖的问题主题" } });
  assert.equal(uncovered.statusCode, 404);
  assert.equal((await uncovered.json() as { error: string }).error, "knowledge_no_coverage");

  // Taking a material out of the library withdraws the pages it produced.
  const withdrawn = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${uploaded.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(withdrawn.statusCode, 200);
  const afterWithdrawal = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[1]!, ...common } });
  assert.deepEqual((await afterWithdrawal.json() as { pages: unknown[] }).pages, []);
  const auditEvents = await sql`SELECT event_type FROM member_wiki_audit_events WHERE document_id = ${uploaded.documentId}`;
  assert.ok(auditEvents.some(event => event.event_type === "knowledge.document.withdrawn"));
});
