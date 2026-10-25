import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { COMING_SOON_EXPERT_SLUG, SECTOR_PEER_EXPERT_SLUG } from "../experts/catalog.ts";
import { runExpertTask } from "../experts/worker.ts";

test("old sentiment is hidden and a query creates a public-data HTML shell", async t => {
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
  process.env.MODEL_CALLS_ENABLED = "false";
  await runExpertTask(taskId);
  const task = (await sql<{ state: string; input: { query: string }; result: { format: string; html: string } }[]>`SELECT state,input,result FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(task.state, "succeeded");
  assert.equal(task.input.query, "  商业航天  ");
  assert.equal(task.result.format, "html");
  for (const title of ["同业是谁", "发展到哪（公开阶段信号）", "资本市场认可（公开融资/并购/IPO 密度）"]) assert.ok(task.result.html.includes(title));
  const artifact = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers });
  assert.equal(artifact.statusCode, 200);
  assert.match(String(artifact.headers["content-type"]), /^text\/html/);
  assert.ok(artifact.body.includes("P0 空看板"));
});
