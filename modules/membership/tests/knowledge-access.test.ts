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

// The second organisation's material about the same target: the same subject, another viewpoint.
const SECOND_DRAFT = {
  pages: [{
    pageType: "view",
    slug: "view-company-example-other",
    title: "某公司",
    targetType: "公司",
    targetName: "某公司",
    track: "食品饮料",
    consensus: "基于 1 家机构 1 位分析师 1 篇材料：需求恢复或慢于预期。",
    divergences: [{ point: "动销恢复节奏", sides: [{ attribution: "王五/另一券商", argument: "终端动销偏弱", date: "2026-07-01" }] }],
    marginalChanges: [{ date: "2026-07-01", attribution: "王五/另一券商", note: "维持中性" }],
    stances: [{ analyst: "王五", institution: "另一券商", stance: "中性", date: "2026-07-01", argument: "动销恢复偏慢", sourceRef: "S1" }],
    expectations: [],
    risks: [{ threshold: "终端动销持续低于预期", interpretation: "需求恢复证伪", attribution: "王五/另一券商", date: "2026-07-01" }],
    timeline: [{ date: "2026-07-01", headline: "另一家维持中性", notes: [], sourceRefs: ["S1"] }],
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
  sources: [{ ref: "S1", institution: "另一券商", authors: ["王五"], date: "2026-07-01", dateBasis: "首页", kind: "点评" }],
  notes: "测试用草稿（另一家机构）",
};

const AUDIT = { verdict: "pass_with_issues", corrections: [], findings: [{ level: "advisory", category: "coverage-mismatch", target: "view-company-example", message: "覆盖较薄", evidence: null }], notes: "" };

const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const system = body.messages.find(message => message.role === "system")?.content ?? "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  if (system.includes("Builder")) {
    if (user.includes("FAILME")) return { choices: [{ message: { content: "这不是 JSON" } }] };
    if (user.includes("另一券商")) return { choices: [{ message: { content: JSON.stringify(SECOND_DRAFT) } }] };
    return { choices: [{ message: { content: JSON.stringify(DRAFT) } }] };
  }
  if (system.includes("Auditor")) return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  // The answer may only cite the citations it was given, and it may not say who said it: the
  // library reads the attribution from its own record.
  const payload = JSON.parse(user) as { availablePages: Array<{ slug: string; availableCitations: Array<{ citationId: string }> }> };
  const page = payload.availablePages[0];
  const citation = page?.availableCitations[0];
  const citationId = user.includes("BADCITATION") ? "00000000-0000-0000-0000-000000000000" : citation?.citationId ?? "";
  return {
    choices: [{ message: { content: JSON.stringify({
      answer: "综合已覆盖的材料，某公司当前以张三/某券商的看好为主[^1]。\n\n参考资料：\n[^1]: 某公司 观点页",
      citations: [{ label: "1", pageSlug: page?.slug ?? "", citationId, analyst: "编造的分析师", organization: "编造的机构" }],
    }) } }],
  };
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
    { username: `wiki-c-${suffix}`, realName: "员工丙", password: "long-test-password-123" },
  ];
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  for (const account of accounts) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
    assert.equal(registered.statusCode, 201);
  }
  await sql`UPDATE member_users SET status='active' WHERE username IN (${accounts[0]!.username},${accounts[1]!.username},${accounts[2]!.username})`;
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

  // A second organisation's material about the same target joins the page instead of replacing it.
  const secondUpload = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[1]!, ...common },
    payload: { fileName: "某公司点评.md", base64: Buffer.from("# 某公司点评\n\n另一券商，2026-07-01：中性，动销恢复偏慢。\n", "utf8").toString("base64"), title: "某公司点评", author: "王五", organization: "另一券商", date: "2026-07-01", kind: "点评" },
  });
  assert.equal(secondUpload.statusCode, 202);
  const second = await secondUpload.json() as { documentId: string; versionId: string; taskId: string };
  await runWikiTask(second.taskId);
  const merged = await sql`SELECT body_md, coverage FROM member_wiki_page_revisions ORDER BY revision DESC LIMIT 1`;
  assert.match(merged[0]!.body_md, /\| 张三 \| 某券商 \| 看好 \| 2026-06-20 \|/, "前一份材料的观点仍在");
  assert.match(merged[0]!.body_md, /\| 王五 \| 另一券商 \| 中性 \| 2026-07-01 \|/, "后一份材料的观点也进来了");
  assert.equal((merged[0]!.coverage as { analysts: number }).analysts, 2, "两位分析师");
  const pageCount = await sql`SELECT count(*)::int AS count FROM member_wiki_pages`;
  assert.equal(pageCount[0]?.count, 1, "同一标的只有一页");
  const contributions = await sql`SELECT status, document_id FROM member_wiki_contributions ORDER BY version_no`;
  assert.equal(contributions.length, 2, "两份材料各留一份贡献");
  assert.ok(contributions.every(row => row.status === "active"));

  // Two builds that publish at the same time keep both materials' contributions.
  const third = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "另一份点评.md", base64: Buffer.from("# 另一份点评\n\n另一券商，2026-07-02：中性，渠道反馈一般。\n", "utf8").toString("base64"), title: "另一份点评", author: "王五", organization: "另一券商", date: "2026-07-02", kind: "点评" },
  });
  const fourth = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[1]!, ...common },
    payload: { fileName: "第三份点评.md", base64: Buffer.from("# 第三份点评\n\n另一券商，2026-07-03：中性，需求恢复偏慢。\n", "utf8").toString("base64"), title: "第三份点评", author: "王五", organization: "另一券商", date: "2026-07-03", kind: "点评" },
  });
  const thirdTask = (await third.json() as { taskId: string; documentId: string }).taskId;
  const fourthTask = (await fourth.json() as { taskId: string; documentId: string }).taskId;
  const thirdDocument = (await third.json() as { documentId: string }).documentId;
  const fourthDocument = (await fourth.json() as { documentId: string }).documentId;
  await Promise.all([runWikiTask(thirdTask), runWikiTask(fourthTask)]);
  const concurrent = await sql`SELECT count(*)::int AS count FROM member_wiki_contributions WHERE status='active'`;
  assert.equal(concurrent[0]?.count, 4, "并发的构建各留一份贡献，谁也没有覆盖谁");
  const concurrentBody = await sql`SELECT body_md FROM member_wiki_page_revisions ORDER BY revision DESC LIMIT 1`;
  assert.match(concurrentBody[0]!.body_md, /另一券商/);

  // A new version of the same material is a new build; the published page stays readable while it runs.
  const updated = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: Buffer.from("# 某公司深度报告（更新）\n\n张三/某券商，2026-08-20：维持看好。\n", "utf8").toString("base64"), documentId: uploaded.documentId },
  });
  assert.equal(updated.statusCode, 202);
  const second2 = await updated.json() as { versionId: string; taskId: string; versionNo: number };
  assert.equal(second2.versionNo, 2);
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
  const answered = answer.json() as Promise<{ answer: { answerMd: string; citations: Array<{ pageSlug: string; analyst: string | null; organization: string | null }>; coverage: { analysts: number; reports: number } } }>;
  assert.match((await answered).answer.answerMd, /\/knowledge\/targets\/view-company-example/);
  assert.deepEqual((await answered).answer.citations.map(citation => citation.pageSlug), ["view-company-example"]);
  assert.ok((await answered).answer.citations.every(citation => citation.analyst !== "编造的分析师"), "归因来自库的记录，不是模型写的");
  assert.ok((await answered).answer.citations.some(citation => citation.analyst === "张三"));
  assert.ok((await answered).answer.coverage.analysts >= 1);
  assert.ok((await answered).answer.coverage.reports >= 1);
  const uncovered = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "完全没有覆盖的问题主题" } });
  assert.equal(uncovered.statusCode, 404);
  assert.equal((await uncovered.json() as { error: string }).error, "knowledge_no_coverage");

  // An answer that cites something the library never offered is refused.
  const unverifiable = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司 BADCITATION 怎么看？" } });
  assert.equal(unverifiable.statusCode, 502);
  assert.equal((await unverifiable.json() as { error: string }).error, "knowledge_answer_unverified");

  // Taking a material out of the library withdraws what it contributed; the other materials stay.
  const withdrawn = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${uploaded.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(withdrawn.statusCode, 200);
  const afterWithdrawal = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[1]!, ...common } });
  assert.equal((await afterWithdrawal.json() as { pages: unknown[] }).pages.length, 1, "另一份材料还在，页面仍在");
  const afterBody = await sql`SELECT body_md FROM member_wiki_page_revisions ORDER BY revision DESC LIMIT 1`;
  assert.doesNotMatch(afterBody[0]!.body_md, /张三/, "撤回的材料不再出现在页面里");
  assert.match(afterBody[0]!.body_md, /王五/, "其他机构的观点仍在");
  const withdrawnOriginal = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(withdrawnOriginal.statusCode, 404, "共享库不再提供撤回材料的原件");
  const outsiderOriginal = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: { cookie: cookies[2]!, ...common } });
  assert.equal(outsiderOriginal.statusCode, 404, "没有上传过的员工也读不到撤回材料");
  const auditorOriginal = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(auditorOriginal.statusCode, 410, "上传者本人看得到它已撤回");
  const auditEvents = await sql`SELECT event_type FROM member_wiki_audit_events WHERE document_id = ${uploaded.documentId}`;
  assert.ok(auditEvents.some(event => event.event_type === "knowledge.document.withdrawn"));

  // The last materials leave: the page goes down with them.
  const remaining = [
    { documentId: second.documentId, cookie: cookies[1]! },
    { documentId: thirdDocument, cookie: cookies[0]! },
    { documentId: fourthDocument, cookie: cookies[1]! },
  ];
  for (const entry of remaining) {
    const lastWithdrawn = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${entry.documentId}/withdraw`, headers: { cookie: entry.cookie, ...common } });
    assert.equal(lastWithdrawn.statusCode, 200);
  }
  const gone = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[0]!, ...common } });
  assert.deepEqual((await gone.json() as { pages: unknown[] }).pages, []);
  const gonePage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[2]!, ...common } });
  assert.equal(gonePage.statusCode, 404, "下架的知识页对其他员工不再可读");
  const auditorPage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(auditorPage.statusCode, 410, "上传者本人看得到它已下架");
});
