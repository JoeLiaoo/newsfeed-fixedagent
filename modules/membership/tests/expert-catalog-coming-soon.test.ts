import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { COMING_SOON_EXPERT_SLUG, SECTOR_PEER_EXPERT_SLUG } from "../experts/catalog.ts";
import { runExpertTask } from "../experts/worker.ts";
import { searchSectorPeerSources } from "@aihot/backend/providers/deepseek-search";

test("old sentiment is hidden and public search configuration errors fail the task", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const account = { username: `sector-${suffix}`, realName: "赛道甲", password: "long-test-password-123" };
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;
  const headers = { cookie, ...common };

  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${COMING_SOON_EXPERT_SLUG}, NULL, '企业舆情报告', '旧入口', '0.1.0', '旧技能', ${sql.json({ tools: [] })}, 'coming_soon', ARRAY[]::text[])
    ON CONFLICT(slug) DO UPDATE SET status='coming_soon'`;
  const catalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers })).json() as { experts: Array<{ slug: string; status: string; name: string }> }).experts;
  assert.ok(!catalog.some(expert => expert.slug === COMING_SOON_EXPERT_SLUG));
  assert.ok(catalog.some(expert => expert.slug === SECTOR_PEER_EXPERT_SLUG && expert.status === "available" && expert.name === "赛道同业竞争看板"));
  const oldRow = (await sql<{ status: string }[]>`SELECT status FROM member_experts WHERE slug=${COMING_SOON_EXPERT_SLUG}`)[0];
  assert.equal(oldRow?.status, "hidden");
  const oldSubmit = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers, payload: { slug: COMING_SOON_EXPERT_SLUG, query: "商业航天" } });
  assert.equal(oldSubmit.statusCode, 404);
  assert.equal((oldSubmit.json() as { error: string }).error, "expert_not_found");
  const user = (await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`)[0]!;
  const oldTaskId = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES (${oldTaskId},${user.id},${COMING_SOON_EXPERT_SLUG},'queued',${sql.json({ notes: "旧入口" })})`;
  await runExpertTask(oldTaskId);
  const oldTask = (await sql<{ state: string }[]>`SELECT state FROM member_expert_tasks WHERE id=${oldTaskId}`)[0]!;
  assert.equal(oldTask.state, "failed", "retired slug cannot fall through to paid text execution");

  const short = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers, payload: { slug: SECTOR_PEER_EXPERT_SLUG, query: " A " } });
  assert.equal(short.statusCode, 400);
  assert.equal((short.json() as { error: string }).error, "sector_query_required");
  const digitsOnly = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers, payload: { slug: SECTOR_PEER_EXPERT_SLUG, query: "12345" } });
  assert.equal(digitsOnly.statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: SECTOR_PEER_EXPERT_SLUG, query: "  商业航天  ", notes: "公开资料" } });
  assert.equal(created.statusCode, 202);
  const taskId = (created.json() as { id: string }).id;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "mock-search-key";
  const requests: Array<{ path: string; body: Record<string, unknown>; authorization: string | undefined }> = [];
  try {
    const research = await searchSectorPeerSources({ query: "商业航天", taskId, userId: user.id }, async (url, options) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(options?.body ?? "{}") as Record<string, unknown>;
      requests.push({ path, body, authorization: options?.headers?.authorization });
      const payload = path.endsWith("/search") ? { results: [{ title: "公开页面", url: `https://example.org/${requests.length}`, snippet: "公开检索摘要", summary: "公开页面摘要", content: "", date: "2026-10-20T00:00:00Z", site_name: "Example" }] } : { title: "抓取页面", content: "公开页面正文" };
      const bodyText = JSON.stringify(payload);
      return { status: 200, url, headers: new Headers({ "content-type": "application/json" }), body: Buffer.from(bodyText), truncated: false, text: () => bodyText };
    });
    assert.equal(research.sources.length, 4);
    assert.deepEqual(research.gaps, []);
    assert.equal(requests.filter(request => request.path.endsWith("/search")).length, 4);
    assert.equal(requests.filter(request => request.path.endsWith("/fetch")).length, 3);
    const searches = requests.filter(request => request.path.endsWith("/search"));
    assert.ok(searches.every(request => request.body.count === 5 && request.body.need_content === true));
    assert.ok(searches.every(request => String(request.body.query).length <= 128));
    assert.ok(searches.some(request => String(request.body.query).includes("lang:zh")));
    assert.ok(requests.every(request => request.authorization === "Bearer mock-search-key"));
    assert.equal(research.sources.filter(source => source.content === "公开页面正文").length, 3, "fetch cap applies even when all four search bodies are thin");
    assert.ok(research.sources.every(source => source.date === "2026-10-20T00:00:00Z"));
    const receipts = await sql<{ purpose: string; service: string; cost: string; currency: string; request: Record<string, unknown> }[]>`SELECT purpose,service,cost,currency,request FROM receipts WHERE member_task_id=${taskId} AND purpose IN ('expert_search','expert_fetch') ORDER BY purpose,id`;
    assert.equal(receipts.length, 7);
    assert.equal(receipts.filter(receipt => receipt.purpose === "expert_search").length, 4);
    assert.equal(receipts.filter(receipt => receipt.purpose === "expert_fetch").length, 3);
    assert.ok(receipts.every(receipt => receipt.service === "deepseek" && receipt.currency === "CNY" && Number(receipt.cost) === 0.005));
    assert.ok(receipts.every(receipt => !JSON.stringify(receipt.request).includes("商业航天")), "receipt summaries keep hashes rather than the raw query");

    const emptyCreated = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: SECTOR_PEER_EXPERT_SLUG, query: "新兴赛道" } });
    const emptyTaskId = (emptyCreated.json() as { id: string }).id;
    let emptySearchCalls = 0;
    const emptyResearch = await searchSectorPeerSources({ query: "新兴赛道", taskId: emptyTaskId, userId: user.id }, async (url, options) => {
      emptySearchCalls += 1;
      const bodyText = JSON.stringify({ results: [] });
      return { status: 200, url, headers: new Headers({ "content-type": "application/json" }), body: Buffer.from(bodyText), truncated: false, text: () => bodyText };
    });
    assert.equal(emptyResearch.sources.length, 0);
    assert.equal(emptyResearch.gaps.length, 4);
    assert.equal(emptySearchCalls, 4);
    const emptyReceipts = await sql<{ cost: string }[]>`SELECT cost FROM receipts WHERE member_task_id=${emptyTaskId} AND purpose='expert_search'`;
    assert.equal(emptyReceipts.length, 4);
    assert.ok(emptyReceipts.every(receipt => Number(receipt.cost) === 0), "empty successful searches are recorded as free");
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
  const previousModelSwitch = config.modelCallsEnabled;
  config.modelCallsEnabled = false;
  try { await runExpertTask(taskId); }
  finally { config.modelCallsEnabled = previousModelSwitch; }
  const task = (await sql<{ state: string; input: { query: string }; result: { format: string; html: string } }[]>`SELECT state,input,result FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(task.state, "failed");
  assert.equal(task.input.query, "  商业航天  ");
  const failed = (await sql<{ error_message: string; error_code: string }[]>`SELECT error_message,error_code FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(failed.error_code, "expert_search_unavailable");
  assert.match(failed.error_message, /公开资料检索未配置或已停用/);
  const artifact = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers });
  assert.notEqual(artifact.statusCode, 200);
});
