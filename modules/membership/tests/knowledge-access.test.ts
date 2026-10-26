// The shared library under two employees and a visitor: who may see what, what an upload does to the
// library, what a failed build leaves behind, and what an answer is allowed to rest on.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { checksum, runWikiTask, recoverWikiTasks } from "../knowledge/worker.ts";
import { TASK_ERRORS } from "../knowledge/catalog.ts";
import sharp from "sharp";

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

let auditHook: (() => Promise<void>) | null = null;
let answerHook: (() => Promise<void>) | null = null;
const provider = await stub(async (_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const system = body.messages.find(message => message.role === "system")?.content ?? "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  if (system.includes("Builder")) {
    if (user.includes("FAILME")) return { choices: [{ message: { content: "这不是 JSON" } }] };
    // Answers that are not a draft at all: the build must fail before it publishes anything.
    if (user.includes("BADROOT")) return { choices: [{ message: { content: "{}" } }] };
    if (user.includes("ERRORROOT")) return { choices: [{ message: { content: JSON.stringify({ error: "provider returned a different response" }) } }] };
    if (user.includes("PAGESNOTARRAY")) return { choices: [{ message: { content: JSON.stringify({ pages: "not an array" }) } }] };
    if (user.includes("另一券商")) return { choices: [{ message: { content: JSON.stringify(SECOND_DRAFT) } }] };
    return { choices: [{ message: { content: JSON.stringify(DRAFT) } }] };
  }
  if (system.includes("Auditor")) {
    // Reviews that gave no verdict, and a review that failed: none of them may pass a build.
    if (user.includes("NOVERDICT")) return { choices: [{ message: { content: "{}" } }] };
    if (user.includes("BADVERDICT")) return { choices: [{ message: { content: JSON.stringify({ verdict: "maybe" }) } }] };
    if (user.includes("FAILVERDICT")) return { choices: [{ message: { content: JSON.stringify({ verdict: "FAIL" }) } }] };
    const hook = auditHook;
    auditHook = null;
    await hook?.();
    return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  }
  const hook = answerHook;
  answerHook = null;
  await hook?.();
  // The answer may only cite the citations it was given, and it may not say who said it: the
  // library reads the attribution from its own record.
  const payload = JSON.parse(user) as { availablePages: Array<{ slug: string; availableCitations: Array<{ citationId: string; sourceLabel: string; analyst: string | null }> }> };
  const page = payload.availablePages[0];
  const citation = page?.availableCitations.find(item => item.analyst === "张三") ?? page?.availableCitations[0];
  const citationId = user.includes("BADCITATION") ? "00000000-0000-0000-0000-000000000000" : citation?.citationId ?? "";
  // An answer that quotes the label of the source instead of the number of the turn.
  if (user.includes("SOURCELABEL")) {
    const sourceLabel = citation?.sourceLabel ?? "S1";
    return { choices: [{ message: { content: JSON.stringify({
      answer: `综合已覆盖的材料，某公司当前以张三/某券商的看好为主[^${sourceLabel}]。\n\n参考资料：\n[^${sourceLabel}]: 某公司 观点页`,
      citations: [{ label: sourceLabel, pageSlug: page?.slug ?? "", citationId }],
    }) } }] };
  }
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
  const [publishedPage] = await sql<{ id: string }[]>`SELECT id FROM member_wiki_pages WHERE slug='view-company-example'`;
  await sql`INSERT INTO member_wiki_quality_issues(id,page_id,level,category,target,message)
    VALUES (${randomUUID()},${publishedPage!.id},'P1','related-target-missing','view-company-example','Related Pages 指向不存在的页面：view-company-example。'),
           (${randomUUID()},${publishedPage!.id},'P1','related-target-missing','view-company-example','Related Pages 指向不存在的页面：not-published。')`;
  const pageDetail = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[1]!, ...common } });
  assert.equal(pageDetail.statusCode, 200);
  assert.deepEqual((await pageDetail.json() as { issues: Array<{ category: string; message: string }> }).issues.filter(issue => issue.category === "related-target-missing").map(issue => issue.message), ["Related Pages 指向不存在的页面：not-published。"]);

  // The other employee sees the same library, and may read the original.
  const shared = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[1]!, ...common } });
  assert.equal(shared.statusCode, 200);
  assert.equal((await shared.json() as { pages: unknown[] }).pages.length, 1);
  const detail = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/documents/${uploaded.documentId}`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(detail.statusCode, 200);
  assert.match((await detail.json() as { versions: Array<{ bodyMd: string | null }> }).versions[0]?.bodyMd ?? "", /# 某公司深度报告\n\n张三\/某券商/);
  const original = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(original.statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/original`, headers: common })).statusCode, 401);
  const figureId = randomUUID();
  const syntheticFigure = await sharp({ create: { width: 240, height: 120, channels: 3, background: "white" } }).jpeg().toBuffer();
  await sql`UPDATE member_wiki_document_versions SET figure_manifest=${sql.json({ pipelineVersion: 1, htmlSha256: "synthetic", candidates: [], candidatesTruncated: false })} WHERE id=${uploaded.versionId}`;
  await sql`INSERT INTO member_wiki_figure_assets(id,version_id,ordinal,locator,caption,original_sha256,normalized_sha256,original_body,normalized_body,media_type,width,height)
    VALUES (${figureId},${uploaded.versionId},1,${sql.json({ kind: "html", label: "图 1" })},'合成图','synthetic-original','synthetic-normalized',${syntheticFigure},${syntheticFigure},'image/jpeg',240,120)`;
  const figurePath = `/api/v1/membership/knowledge/versions/${uploaded.versionId}/figures/${figureId}/content`;
  assert.equal((await app.inject({ method: "GET", url: figurePath, headers: common })).statusCode, 401);
  const figureResponse = await app.inject({ method: "GET", url: figurePath, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(figureResponse.statusCode, 200);
  assert.equal(figureResponse.headers["cache-control"], "private, no-store");
  assert.equal(figureResponse.headers["x-content-type-options"], "nosniff");
  assert.equal(figureResponse.headers["content-type"], "image/jpeg");
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${uploaded.versionId}/figures`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 200);

  // A second organisation's material about the same target joins the page instead of replacing it.
  const secondUpload = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[1]!, ...common },
    payload: { fileName: "某公司点评.md", base64: Buffer.from("# 某公司点评\n\n另一券商，2026-07-01：中性，动销恢复偏慢。\n", "utf8").toString("base64"), title: "某公司点评", author: "王五", organization: "另一券商", date: "2026-07-01", kind: "点评" },
  });
  assert.equal(secondUpload.statusCode, 202);
  const second = await secondUpload.json() as { documentId: string; versionId: string; taskId: string };
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/versions/${second.versionId}/figures/${figureId}/content`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404, "a figure cannot be read through another version");
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

  const targetResponse = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[1]!, ...common } });
  assert.equal(targetResponse.statusCode, 200);
  const target = await targetResponse.json() as { materials: Array<{ documentId: string; sourceAuthor: string | null; sourceOrg: string | null; sourceDate: string | null; freshness: string }>; revisions: Array<{ revision: number }> };
  assert.equal(target.materials.length, 2, "target detail exposes both independent materials");
  assert.deepEqual(new Set(target.materials.map(material => material.documentId)), new Set([uploaded.documentId, second.documentId]));
  assert.equal(target.revisions.length, 2, "target detail exposes each published revision");
  assert.ok(target.materials.some(material => material.sourceAuthor === "张三" && material.sourceOrg === "某券商" && material.sourceDate === "2026-06-20"));

  // Missing upload metadata remains null in the employee API; presentation supplies the visible 未知 label.
  await sql`UPDATE member_wiki_document_versions SET source_title=NULL, source_author=NULL, source_org=NULL, source_date=NULL, source_kind=NULL WHERE id=${second.versionId}`;
  const unknownTarget = await (await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[1]!, ...common } })).json() as typeof target;
  const unknownMaterial = unknownTarget.materials.find(material => material.documentId === second.documentId)!;
  assert.equal(unknownMaterial.sourceAuthor, null);
  assert.equal(unknownMaterial.sourceOrg, null);
  assert.equal(unknownMaterial.sourceDate, null);
  assert.equal(unknownMaterial.freshness, "undated");
  await sql`UPDATE member_wiki_document_versions SET source_title='另一券商', source_author='王五', source_org='另一券商', source_date='2026-07-01', source_kind='点评' WHERE id=${second.versionId}`;

  // The build list is read a page at a time: it is never cut at an arbitrary number of rows.
  const firstTaskPage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/tasks?limit=1", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(firstTaskPage.statusCode, 200);
  const firstTasks = firstTaskPage.json() as Promise<{ tasks: Array<{ id: string }>; hasMore: boolean; nextOffset: number | null }>;
  assert.equal((await firstTasks).tasks.length, 1);
  assert.equal((await firstTasks).hasMore, true);
  assert.equal((await firstTasks).nextOffset, 1);
  const secondTaskPage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/tasks?limit=1&offset=1", headers: { cookie: cookies[0]!, ...common } });
  const secondTasks = secondTaskPage.json() as Promise<{ tasks: Array<{ id: string }>; hasMore: boolean; nextOffset: number | null }>;
  assert.notEqual((await secondTasks).tasks[0]?.id, (await firstTasks).tasks[0]?.id, "the second page holds other builds");
  assert.equal((await secondTasks).hasMore, false);
  assert.equal((await secondTasks).nextOffset, null);
  // A page size beyond the cap is clamped rather than refused.
  const clampedTasks = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/tasks?limit=500", headers: { cookie: cookies[0]!, ...common } });
  const clamped = clampedTasks.json() as Promise<{ tasks: unknown[]; hasMore: boolean; nextOffset: number | null }>;
  assert.ok((await clamped).tasks.length <= 100);
  assert.equal((await clamped).hasMore, false);
  assert.equal((await clamped).nextOffset, null);
  // A visitor reads no build list.
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/tasks", headers: common })).statusCode, 401);

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
  const firstWindow = await (await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/documents?limit=2", headers: { cookie: cookies[0]!, ...common } })).json() as { documents: unknown[]; hasMore: boolean; nextOffset: number | null };
  assert.equal(firstWindow.documents.length, 2);
  assert.equal(firstWindow.hasMore, true);
  assert.equal(firstWindow.nextOffset, 2);
  const secondWindow = await (await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/documents?limit=2&offset=${firstWindow.nextOffset}`, headers: { cookie: cookies[0]!, ...common } })).json() as { documents: unknown[]; hasMore: boolean; nextOffset: number | null };
  assert.ok(secondWindow.documents.length > 0);
  assert.ok(secondWindow.nextOffset === null || secondWindow.nextOffset > firstWindow.nextOffset);
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

  await runWikiTask(second2.taskId);
  const replaced = await sql`SELECT version_id FROM member_wiki_contributions WHERE document_id=${uploaded.documentId} AND status='active'`;
  assert.deepEqual(replaced.map(row => row.version_id), [second2.versionId], "the new version replaces this material's old contribution");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE document_id <> ${uploaded.documentId} AND status='active'`)[0]?.n, 3, "other materials survive the update");

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
  const answered = answer.json() as Promise<{ answer: { answerMd: string; citations: Array<{ pageSlug: string; analyst: string | null; organization: string | null; documentId: string; versionId: string }>; coverage: { analysts: number; reports: number } } }>;
  assert.match((await answered).answer.answerMd, /\/knowledge\/targets\/view-company-example/);
  assert.deepEqual((await answered).answer.citations.map(citation => citation.pageSlug), ["view-company-example"]);
  assert.ok((await answered).answer.citations.every(citation => citation.analyst !== "编造的分析师"), "归因来自库的记录，不是模型写的");
  assert.ok((await answered).answer.citations.some(citation => citation.analyst === "张三"));
  assert.ok((await answered).answer.coverage.analysts >= 1);
  assert.ok((await answered).answer.coverage.reports >= 1);
  // Every citation leads back to the material it was read from, and to the file behind it.
  const citedMaterials = await sql<{ document_id: string; version_id: string }[]>`
    SELECT d.id AS document_id, v.id AS version_id
    FROM member_wiki_citations c
    JOIN member_wiki_document_versions v ON v.id = c.version_id
    JOIN member_wiki_documents d ON d.id = v.document_id`;
  for (const citation of (await answered).answer.citations) {
    assert.ok(citation.documentId, "引用带着材料标识");
    assert.ok(citation.versionId, "引用带着原件标识");
    assert.ok(citedMaterials.some(row => row.document_id === citation.documentId && row.version_id === citation.versionId),
      "引用指向库里的材料与原件");
  }
  assert.ok((await answered).answer.citations.some(citation => citation.documentId === uploaded.documentId), "第一份材料在引用里");
  const uncovered = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "完全没有覆盖的问题主题" } });
  assert.equal(uncovered.statusCode, 422);
  const uncoveredBody = uncovered.json() as { error: string; message: string; answer?: unknown; citations?: unknown };
  assert.equal(uncoveredBody.error, "knowledge_no_coverage");
  assert.equal(uncoveredBody.message, TASK_ERRORS.knowledge_no_coverage, "没有覆盖时说的是没有覆盖");
  assert.equal(uncoveredBody.answer, undefined, "没有覆盖时不给出任何回答");
  assert.equal(uncoveredBody.citations, undefined, "没有覆盖时不给出任何引用");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_answers WHERE question='完全没有覆盖的问题主题'`)[0]?.n, 0, "没有覆盖时不留下回答记录");

  // An answer that cites something the library never offered is refused. The request was understood
  // and the answer was not: it is not a gateway failure.
  const unverifiable = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司 BADCITATION 怎么看？" } });
  assert.equal(unverifiable.statusCode, 422);
  assert.equal((await unverifiable.json() as { error: string }).error, "knowledge_answer_unverified");

  // The refused answer is not handed back to the employee: the next attempt pays for a fresh one.
  const hitsBeforeRetry = provider.hits();
  const askedAgain = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司 BADCITATION 怎么看？" } });
  assert.ok(provider.hits() > hitsBeforeRetry, "the refused answer was replayed instead of asked for again");
  assert.equal(askedAgain.statusCode, 422);

  // An answer that quotes the label of the source instead of the number of the turn is accepted.
  const quoted = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司 SOURCELABEL 怎么看？" } });
  assert.equal(quoted.statusCode, 200);
  const quotedAnswer = await quoted.json() as { answer: { answerMd: string; citations: Array<{ label: string; analyst: string | null }> } };
  assert.match(quotedAnswer.answer.citations[0]?.label ?? "", /^S\d+$/, "脚注用的是页面自己的来源编号");
  assert.equal(quotedAnswer.answer.citations[0]?.analyst, "张三", "归因仍来自库里的记录");
  assert.match(quotedAnswer.answer.answerMd, /\/knowledge\/targets\//);

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
  assert.equal((await app.inject({ method: "GET", url: figurePath, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404, "withdrawn figure bytes are no longer shared");
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

  // Ready checkpoints keep these tests independent of model wording and upload throttles. The
  // actual worker, transactions, leases, routes and PostgreSQL rows still run normally.
  const [owner] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${accounts[0]!.username}`;
  const basePage = structuredClone(DRAFT.pages[0]!);
  const extraPage = { ...basePage, slug: "view-another-company", title: "另一公司", targetName: "另一公司" };
  async function seed(pages: typeof DRAFT.pages, options: { documentId?: string; versionNo?: number; audit?: boolean; draft?: boolean; text?: string } = {}) {
    const documentId = options.documentId ?? randomUUID();
    const versionId = randomUUID();
    const taskId = randomUUID();
    if (!options.documentId) await sql`INSERT INTO member_wiki_documents(id,uploader_id,title) VALUES (${documentId},${owner!.id},'checkpoint fixture')`;
    await sql`INSERT INTO member_wiki_document_versions(id,document_id,version_no,uploader_id,file_name,media_type,format,byte_size,sha256,body,extracted_text,extraction_status)
      VALUES (${versionId},${documentId},${options.versionNo ?? 1},${owner!.id},'checkpoint.md','text/markdown','markdown',7,${versionId},${Buffer.from('fixture')},${options.text ?? `fixture ${versionId}`},'available')`;
    const draft = { ...DRAFT, pages };
    await sql`INSERT INTO member_wiki_tasks(id,document_id,version_id,uploader_id,draft,audit)
      VALUES (${taskId},${documentId},${versionId},${owner!.id},${options.draft === false ? null : sql.json(draft)},${options.audit === false ? null : sql.json(AUDIT)})`;
    return { documentId, versionId, taskId };
  }
  const multi = await seed([basePage, extraPage]);
  await runWikiTask(multi.taskId);
  const multiRows = await sql`SELECT * FROM member_wiki_contributions WHERE version_id=${multi.versionId} AND status='active'`;
  assert.equal(multiRows.length, 2, "one material may contribute to several targets");
  const updatedMulti = await seed([extraPage], { documentId: multi.documentId, versionNo: 2 });
  await runWikiTask(updatedMulti.taskId);
  const removedPage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-company-example", headers: { cookie: cookies[2]!, ...common } });
  assert.equal(removedPage.statusCode, 404, "a removed target must not retain the old version's page");
  const activeMulti = await sql`SELECT version_id, slug FROM member_wiki_contributions WHERE document_id=${multi.documentId} AND status='active'`;
  assert.deepEqual(activeMulti.map(row => row.version_id), [updatedMulti.versionId]);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages/view-another-company", headers: { cookie: cookies[2]!, ...common } })).statusCode, 200);
  const emptyVersion = await seed([], { documentId: multi.documentId, versionNo: 3 });
  await runWikiTask(emptyVersion.taskId);
  await sql`UPDATE member_wiki_tasks SET state='queued' WHERE id=${multi.taskId}`;
  await runWikiTask(multi.taskId);
  const stale = await sql`SELECT state,error_code FROM member_wiki_tasks WHERE id=${multi.taskId}`;
  assert.equal(stale[0]?.error_code, "knowledge_publish_stale", "even an empty newer publication fences out the old worker");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE document_id=${multi.documentId} AND status='active'`)[0]?.n, 0);

  const concurrentA = await seed([basePage, extraPage]);
  const concurrentB = await seed([extraPage, basePage]);
  await Promise.all([runWikiTask(concurrentA.taskId), runWikiTask(concurrentB.taskId)]);
  const concurrentStates = await sql`SELECT state FROM member_wiki_tasks WHERE id IN (${concurrentA.taskId},${concurrentB.taskId})`;
  assert.ok(concurrentStates.every(row => row.state === "succeeded"), "opposite draft order does not deadlock multi-target publication");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE document_id IN (${concurrentA.documentId},${concurrentB.documentId}) AND status='active'`)[0]?.n, 4);
  await Promise.all([concurrentA, concurrentB].map(async entry => {
    const response = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${entry.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
    assert.equal(response.statusCode, 200);
  }));

  const cancelled = await seed([basePage], { audit: false });
  let cancellationObserved = false;
  auditHook = async () => {
    cancellationObserved = true;
    const response = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${cancelled.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
    assert.equal(response.statusCode, 200);
  };
  await runWikiTask(cancelled.taskId);
  assert.equal(cancellationObserved, true, "the model boundary was actually crossed");
  assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${cancelled.taskId}`)[0]?.state, "cancelled");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE document_id=${cancelled.documentId}`)[0]?.n, 0, "an in-flight model result cannot revive a withdrawn document");

  const recovered = await seed([basePage], { audit: false });
  let recoveryObserved = false;
  auditHook = async () => {
    recoveryObserved = true;
    // Recovery resumes the persisted audit checkpoint, while the old worker still has its result
    // in flight. A unique material prevents another test's paid-request receipt being reused.
    await sql`UPDATE member_wiki_tasks SET audit=${sql.json(AUDIT)}, lease_expires_at=now()-interval '1 minute' WHERE id=${recovered.taskId}`;
    const recovery = await recoverWikiTasks(async taskId => { assert.equal(taskId, recovered.taskId); });
    assert.equal(recovery.recovered, 1);
    await runWikiTask(recovered.taskId);
  };
  await runWikiTask(recovered.taskId);
  assert.equal(recoveryObserved, true, "recovery must execute, not reuse an earlier receipt");
  assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${recovered.taskId}`)[0]?.state, "succeeded");
  const beforeDuplicate = await sql`SELECT count(*)::int AS n FROM member_wiki_page_revisions WHERE task_id=${recovered.taskId}`;
  assert.equal(beforeDuplicate[0]?.n, 1, "the recovered worker publishes once; the old lease publishes nothing");
  await runWikiTask(recovered.taskId);
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_page_revisions WHERE task_id=${recovered.taskId}`)[0]?.n, 1, "duplicate wakeups do not publish twice");

  answerHook = async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${recovered.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
    assert.equal(response.statusCode, 200);
  };
  const staleAnswer = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司撤回期间怎么看？" } });
  assert.equal(staleAnswer.statusCode, 409, "an answer cannot publish evidence withdrawn while the model was running");
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_answers WHERE question='某公司撤回期间怎么看？'`)[0]?.n, 0);

  // Exercise the browser's blank date through the real upload route and database.
  const uploadCounts = async () => (await sql`SELECT
    (SELECT count(*)::int FROM member_wiki_documents) AS documents,
    (SELECT count(*)::int FROM member_wiki_document_versions) AS versions,
    (SELECT count(*)::int FROM member_wiki_tasks) AS tasks,
    (SELECT count(*)::int FROM member_wiki_audit_events) AS events,
    (SELECT count(*)::int FROM pgboss.job WHERE name='membership.knowledge') AS jobs`)[0];
  const beforeInvalidDate = await uploadCounts();
  for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "0000-01-01", "2026-01-01-extra", 20260101, false, {}]) {
    const rejected = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[2]!, ...common },
      payload: { fileName: "invalid-date.md", base64: Buffer.from("# Invalid date fixture").toString("base64"), date } });
    assert.equal(rejected.statusCode, 400, JSON.stringify(date));
    assert.equal(rejected.json().error, "knowledge_date_invalid");
  }
  assert.deepEqual(await uploadCounts(), beforeInvalidDate, "invalid dates leave no version, task, audit or queue side effects");
  for (const [index, date] of [undefined, null, "", "   ", "2024-02-29"].entries()) {
    const accepted = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[2]!, ...common },
      payload: { fileName: `optional-date-${index}.md`, base64: Buffer.from(`# Optional date fixture ${index}`).toString("base64"), ...(date === undefined ? {} : { date }) } });
    assert.equal(accepted.statusCode, 202, `optional date ${index}: ${accepted.body}`);
    const result = accepted.json() as { documentId: string; versionId: string; taskId: string };
    const [version] = await sql<{ source_date: string | null }[]>`SELECT source_date::text FROM member_wiki_document_versions WHERE id=${result.versionId}`;
    assert.equal(version?.source_date, date === "2024-02-29" ? date : null);
    assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${result.taskId}`)[0]?.state, "queued");
    await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${result.documentId}/withdraw`, headers: { cookie: cookies[2]!, ...common } });
  }

  const exhausted = await seed([basePage]);
  await sql`UPDATE member_wiki_tasks SET state='running', attempt_count=5, lease_expires_at=now()-interval '1 minute' WHERE id=${exhausted.taskId}`;
  assert.deepEqual(await recoverWikiTasks(async () => { assert.fail("exhausted task must not be enqueued"); }), { recovered: 0 });
  const [exhaustedRow] = await sql`SELECT state,error_code,finished_at,draft,audit FROM member_wiki_tasks WHERE id=${exhausted.taskId}`;
  assert.equal(exhaustedRow?.state, "failed");
  assert.equal(exhaustedRow?.error_code, "knowledge_retry_exhausted");
  assert.ok(exhaustedRow?.finished_at);
  assert.ok(exhaustedRow?.draft && exhaustedRow.audit, "recovery preserves checkpoints");
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/tasks/${exhausted.taskId}/retry`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);

  // An answer that is not a draft fails the build before the publish transaction: the version that is
  // already published keeps its contribution, and its page stays published.
  const failClosedPage = { ...basePage, slug: "view-fail-closed-company", title: "失败封闭公司", targetName: "失败封闭公司" };
  const failClosed = await seed([failClosedPage], { text: `第一版 ${randomUUID()}` });
  await runWikiTask(failClosed.taskId);
  assert.equal((await sql`SELECT status FROM member_wiki_contributions WHERE version_id=${failClosed.versionId}`)[0]?.status, "active", "the first version is published");
  assert.equal((await sql`SELECT status FROM member_wiki_pages WHERE slug='view-fail-closed-company'`)[0]?.status, "published");
  let failClosedVersion = 1;
  for (const marker of ["BADROOT", "ERRORROOT", "PAGESNOTARRAY"]) {
    failClosedVersion += 1;
    const broken = await seed([], { documentId: failClosed.documentId, versionNo: failClosedVersion, draft: false, text: `${marker} ${randomUUID()}` });
    await runWikiTask(broken.taskId);
    const failed = await sql`SELECT state, error_code FROM member_wiki_tasks WHERE id=${broken.taskId}`;
    assert.equal(failed[0]?.state, "failed", marker);
    assert.equal(failed[0]?.error_code, "knowledge_model_output_invalid", marker);
    const active = await sql`SELECT version_id FROM member_wiki_contributions WHERE document_id=${failClosed.documentId} AND status='active'`;
    assert.deepEqual(active.map(row => row.version_id), [failClosed.versionId], `${marker}: the published version keeps its contribution`);
    assert.equal((await sql`SELECT status FROM member_wiki_pages WHERE slug='view-fail-closed-company'`)[0]?.status, "published", marker);
    assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_audit_events WHERE task_id=${broken.taskId} AND event_type='knowledge.build.published'`)[0]?.n, 0, marker);
  }

  // A review that gave no verdict is not a review: the build fails and publishes nothing. A review
  // that failed stops the build the same way.
  for (const [marker, expected] of [["NOVERDICT", "knowledge_model_output_invalid"], ["BADVERDICT", "knowledge_model_output_invalid"], ["FAILVERDICT", "knowledge_audit_failed"]] as const) {
    const noReview = await seed([failClosedPage], { audit: false, text: `${marker} ${randomUUID()}` });
    await runWikiTask(noReview.taskId);
    const failed = await sql`SELECT state, error_code FROM member_wiki_tasks WHERE id=${noReview.taskId}`;
    assert.equal(failed[0]?.state, "failed", marker);
    assert.equal(failed[0]?.error_code, expected, marker);
    assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE version_id=${noReview.versionId}`)[0]?.n, 0, `${marker}: a build without a real review publishes nothing`);
    assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_audit_events WHERE task_id=${noReview.taskId} AND event_type='knowledge.build.published'`)[0]?.n, 0, marker);
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_contributions WHERE version_id=${failClosed.versionId} AND status='active'`)[0]?.n, 1, "the published version is untouched by the failed builds");

  // A failed task stays failed after withdrawal, and even a stale queue wakeup cannot call the model.
  const withdrawnFailure = await seed([], { draft: false, text: `FAILME ${randomUUID()}` });
  await runWikiTask(withdrawnFailure.taskId);
  assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${withdrawnFailure.taskId}`)[0]?.state, "failed");
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${withdrawnFailure.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  const beforeRejectedRetry = await sql`SELECT count(*)::int AS n FROM member_wiki_audit_events WHERE task_id=${withdrawnFailure.taskId} AND event_type='knowledge.build.retried'`;
  const beforeRejectedQueue = await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name='membership.knowledge'`;
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/tasks/${withdrawnFailure.taskId}/retry`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM member_wiki_audit_events WHERE task_id=${withdrawnFailure.taskId} AND event_type='knowledge.build.retried'`, beforeRejectedRetry);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name='membership.knowledge'`, beforeRejectedQueue);
  await sql`UPDATE member_wiki_tasks SET state='queued' WHERE id=${withdrawnFailure.taskId}`;
  const hitsBeforeWithdrawnWakeup = provider.hits();
  await runWikiTask(withdrawnFailure.taskId);
  assert.equal(provider.hits(), hitsBeforeWithdrawnWakeup, "a queued task for withdrawn material cannot reach the model");
  assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${withdrawnFailure.taskId}`)[0]?.state, "queued");
  await sql`UPDATE member_wiki_tasks SET state='running', lease_expires_at=now()-interval '1 minute' WHERE id=${withdrawnFailure.taskId}`;
  assert.deepEqual(await recoverWikiTasks(async () => { assert.fail("withdrawn material must not be requeued"); }), { recovered: 0 });
  assert.equal((await sql`SELECT state FROM member_wiki_tasks WHERE id=${withdrawnFailure.taskId}`)[0]?.state, "cancelled");

  // The old SHA remains in the audit trail, but an identical upload creates a visible new material.
  await sql`UPDATE member_wiki_tasks SET state='failed', created_at=now()-interval '2 hours' WHERE uploader_id=${owner!.id} AND state IN ('queued','running')`;
  await sql`UPDATE member_wiki_tasks SET created_at=now()-interval '2 hours' WHERE uploader_id=${owner!.id}`;
  await sql`UPDATE member_wiki_audit_events SET created_at=now()-interval '2 hours' WHERE actor_id=${owner!.id} AND event_type='knowledge.build.retried'`;
  const reupload = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: material, title: "重新上传的材料" } });
  assert.equal(reupload.statusCode, 202);
  const reuploaded = reupload.json() as { documentId: string; taskId: string; duplicate: boolean };
  assert.equal(reuploaded.duplicate, false);
  assert.notEqual(reuploaded.documentId, uploaded.documentId);
  assert.ok(reuploaded.taskId);
  const visibleReupload = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/documents?limit=100", headers: { cookie: cookies[0]!, ...common } });
  const listed = (visibleReupload.json() as { documents: Array<{ id: string }> }).documents;
  assert.ok(listed.some(document => document.id === reuploaded.documentId));
  assert.ok(!listed.some(document => document.id === uploaded.documentId));
  assert.equal((await sql`SELECT status FROM member_wiki_documents WHERE id=${uploaded.documentId}`)[0]?.status, "withdrawn");
  await app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${reuploaded.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } });
  await sql`UPDATE member_wiki_tasks SET created_at=now()-interval '2 hours' WHERE id=${reuploaded.taskId}`;

  // Retry admissions share the upload limits: two active builds, then ten total admissions/hour.
  const retryCandidates = await Promise.all(Array.from({ length: 11 }, () => seed([basePage])));
  const candidateIds = retryCandidates.map(candidate => candidate.taskId);
  await sql`UPDATE member_wiki_tasks SET state='failed', created_at=now()-interval '2 hours' WHERE id IN ${sql(candidateIds)}`;
  const retry = (taskId: string) => app.inject({ method: "POST", url: `/api/v1/membership/knowledge/tasks/${taskId}/retry`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal((await retry(candidateIds[0]!)).statusCode, 202);
  assert.equal((await retry(candidateIds[1]!)).statusCode, 202);
  const queueBeforeFullRetry = await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name='membership.knowledge'`;
  const checkpointBeforeFullRetry = await sql`SELECT state, attempt_count, draft, audit FROM member_wiki_tasks WHERE id=${candidateIds[2]!}`;
  const fullRetry = await retry(candidateIds[2]!);
  assert.equal(fullRetry.statusCode, 429, "a third active build is refused");
  assert.equal(fullRetry.json().error, "knowledge_upload_rate_limited");
  assert.match(fullRetry.json().message, /2.*10/);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name='membership.knowledge'`, queueBeforeFullRetry);
  assert.deepEqual(await sql`SELECT state, attempt_count, draft, audit FROM member_wiki_tasks WHERE id=${candidateIds[2]!}`, checkpointBeforeFullRetry);
  const duplicateBytes = Buffer.from(`# Existing ${randomUUID()}`);
  await sql`UPDATE member_wiki_document_versions SET body=${duplicateBytes}, byte_size=${duplicateBytes.length}, sha256=${checksum(duplicateBytes)} WHERE id=${retryCandidates[0]!.versionId}`;
  const beforeFullDuplicate = await sql`SELECT count(*)::int AS n FROM member_wiki_tasks WHERE uploader_id=${owner!.id}`;
  const fullDuplicate = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "existing.md", base64: duplicateBytes.toString("base64") } });
  assert.equal(fullDuplicate.statusCode, 200, "an existing active material does not consume admission capacity");
  assert.equal(fullDuplicate.json().duplicate, true);
  assert.equal(fullDuplicate.json().documentId, retryCandidates[0]!.documentId);
  const fullVersionDuplicate = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "existing.md", base64: duplicateBytes.toString("base64"), documentId: retryCandidates[0]!.documentId } });
  assert.equal(fullVersionDuplicate.statusCode, 200);
  assert.equal(fullVersionDuplicate.json().versionId, retryCandidates[0]!.versionId);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM member_wiki_tasks WHERE uploader_id=${owner!.id}`, beforeFullDuplicate);
  const differentMaterial = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "new.md", base64: Buffer.from(`# New ${randomUUID()}`).toString("base64") } });
  assert.equal(differentMaterial.statusCode, 429, "new work still needs admission capacity");
  await sql`UPDATE member_wiki_tasks SET state='failed' WHERE id IN (${candidateIds[0]!},${candidateIds[1]!})`;
  for (const taskId of candidateIds.slice(2, 10)) {
    assert.equal((await retry(taskId)).statusCode, 202);
    await sql`UPDATE member_wiki_tasks SET state='failed' WHERE id=${taskId}`;
  }
  const beforeHourlyLimit = await sql`SELECT state, attempt_count, draft, audit FROM member_wiki_tasks WHERE id=${candidateIds[10]!}`;
  assert.equal((await retry(candidateIds[10]!)).statusCode, 429, "an eleventh retry in an hour is refused");
  assert.deepEqual(await sql`SELECT state, attempt_count, draft, audit FROM member_wiki_tasks WHERE id=${candidateIds[10]!}`, beforeHourlyLimit);
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_audit_events WHERE actor_id=${owner!.id} AND event_type='knowledge.build.retried' AND created_at > now()-interval '1 hour'`)[0]?.n, 10);
  const limitedUpload = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "quota.md", base64: Buffer.from(`# New material ${randomUUID()}`).toString("base64") } });
  assert.equal(limitedUpload.statusCode, 429, "recent retries also use the upload admission budget");
  await sql`UPDATE member_wiki_audit_events SET created_at=now()-interval '2 hours' WHERE actor_id=${owner!.id} AND event_type='knowledge.build.retried'`;
  assert.equal((await retry(candidateIds[10]!)).statusCode, 202, "an expired hourly window permits another retry");
  await sql`UPDATE member_wiki_tasks SET state='failed' WHERE id=${candidateIds[10]!}`;

  const concurrentCandidates = await Promise.all([seed([basePage]), seed([basePage])]);
  await sql`UPDATE member_wiki_tasks SET state='failed', created_at=now()-interval '2 hours' WHERE id IN (${concurrentCandidates[0]!.taskId},${concurrentCandidates[1]!.taskId})`;
  const concurrentAdmissions = await Promise.all([
    retry(concurrentCandidates[0]!.taskId), retry(concurrentCandidates[1]!.taskId),
    app.inject({ method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
      payload: { fileName: "concurrent.md", base64: Buffer.from(`# Concurrent ${randomUUID()}`).toString("base64") } }),
  ]);
  assert.deepEqual(concurrentAdmissions.map(response => response.statusCode).sort(), [202, 202, 429]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM member_wiki_tasks WHERE uploader_id=${owner!.id} AND state IN ('queued','running')`)[0]?.n, 2);

  const racing = await seed([basePage]);
  await sql`UPDATE member_wiki_tasks SET state='failed', created_at=now()-interval '2 hours' WHERE id=${racing.taskId}`;
  await sql`UPDATE member_wiki_tasks SET state='failed' WHERE uploader_id=${owner!.id} AND state='queued'`;
  const [raceRetry, raceWithdraw] = await Promise.all([
    retry(racing.taskId),
    app.inject({ method: "POST", url: `/api/v1/membership/knowledge/documents/${racing.documentId}/withdraw`, headers: { cookie: cookies[0]!, ...common } }),
  ]);
  assert.ok([202, 404].includes(raceRetry.statusCode));
  assert.equal(raceWithdraw.statusCode, 200);
  const hitsBeforeRaceWakeup = provider.hits();
  await runWikiTask(racing.taskId);
  assert.equal(provider.hits(), hitsBeforeRaceWakeup);
  assert.ok(!["queued", "running"].includes((await sql`SELECT state FROM member_wiki_tasks WHERE id=${racing.taskId}`)[0]?.state));

});
