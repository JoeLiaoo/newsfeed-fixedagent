// The podcast expert end to end: the employee submits a topic, the worker reads the public library,
// and the task ends with an article in the card and a Markdown file to download.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { FRONTIER_PODCAST_EXPERT_SLUG } from "../experts/catalog.ts";
import { seedBuiltinExperts } from "../experts/seed.ts";
import { runExpertTask } from "../experts/worker.ts";

const SEARCH = {
  q: "具身智能",
  count: 1,
  partial: true,
  searched_recent: 300,
  results: [{
    slug: "latetalk-182",
    title: "182: 对话梁琛奇",
    shows: { name: "晚点聊 LateTalk" },
    date: "2026-09-24",
    published_at: "2026-09-23T23:00:00+00:00",
    duration_min: 202,
    lang: "ZH",
    dek: "推理成本下降，AI 娱乐窗口已开启。",
    source_url: "https://podcast.latepost.com/182",
    source_label: "Podcast",
    chips: ["person:梁琛奇"],
    tag_sectors: ["ai_software"],
    tag_focus: ["technical"],
  }],
};

const EPISODE = {
  ...SEARCH.results[0],
  lang_alt: "EN",
  tldr_md: "- **第一点要点。** 展开说明。",
  digest_md: "### 1. 小节标题\n- 摘要第一行。",
};

/** The library as a stub: the search answers, and the episodes answer or fail as the test says. */
function stubLibrary(failing = false) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/api/v1/search")) return new Response(JSON.stringify(SEARCH), { status: 200, headers: { "content-type": "application/json" } });
    if (failing) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify(EPISODE), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function member(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  const account = { username: `podcast-${suffix}`, realName: "播客甲", password: "long-test-password-123" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;
  return { cookie, ...common };
}

test("a podcast task ends with the article in the card and the Markdown file to download", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const headers = await member(app, tag());
  await seedBuiltinExperts();

  const catalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers })).json() as { experts: Array<{ slug: string; execution_mode: string; name: string }> }).experts;
  const expert = catalog.find(row => row.slug === FRONTIER_PODCAST_EXPERT_SLUG);
  assert.ok(expert, "前沿播客在目录中");
  assert.equal(expert.execution_mode, "podcast_search");

  const short = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: FRONTIER_PODCAST_EXPERT_SLUG, query: "  " } });
  assert.equal(short.statusCode, 400);
  assert.equal((short.json() as { error: string }).error, "podcast_query_required");

  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: FRONTIER_PODCAST_EXPERT_SLUG, query: "具身智能" } });
  assert.equal(created.statusCode, 202);
  const taskId = (created.json() as { id: string }).id;

  const original = globalThis.fetch;
  globalThis.fetch = stubLibrary() as typeof fetch;
  try { await runExpertTask(taskId); }
  finally { globalThis.fetch = original; }

  const task = (await sql<{ state: string; result: { format: string; html: string; podcast: { episodes: number; partial: boolean } } }[]>`SELECT state,result FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(task.state, "succeeded");
  assert.equal(task.result.format, "html");
  assert.equal(task.result.podcast.episodes, 1);
  assert.equal(task.result.podcast.partial, true);
  for (const part of ["前沿播客", "ra-hero", "ra-toc", "182: 对话梁琛奇", "晚点聊 LateTalk", "https://podcast.latepost.com/182", "结果不完整"]) {
    assert.ok(task.result.html.includes(part), part);
  }
  assert.ok(!task.result.html.includes("<script"), "the article carries no script");

  const artifact = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers });
  assert.equal(artifact.statusCode, 200);
  assert.match(String(artifact.headers["content-type"]), /^text\/markdown/);
  assert.ok(artifact.body.includes("# 前沿播客 · 具身智能"));
  assert.ok(artifact.body.includes("- 来源：Podcast · https://podcast.latepost.com/182"));

  // A library that cannot answer leaves the task failed with a readable reason.
  const failing = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: FRONTIER_PODCAST_EXPERT_SLUG, query: "半导体" } });
  const failingId = (failing.json() as { id: string }).id;
  globalThis.fetch = stubLibrary(true) as typeof fetch;
  try { await runExpertTask(failingId); }
  finally { globalThis.fetch = original; }
  const failed = (await sql<{ state: string; error_code: string; error_message: string }[]>`SELECT state,error_code,error_message FROM member_expert_tasks WHERE id=${failingId}`)[0]!;
  assert.equal(failed.state, "failed");
  assert.equal(failed.error_code, "podcast_source_unavailable");
  assert.match(failed.error_message, /公开播客文字库/);
  assert.ok(!/http/i.test(failed.error_message), "the raw service text is not shown to the employee");
});
