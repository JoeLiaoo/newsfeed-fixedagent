import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { COMING_SOON_EXPERT, COMING_SOON_EXPERT_SLUG, COMING_SOON_EXPERT_STATUS, EXPERT_SLUG, PANORAMA_EXPERT_SLUG } from "../experts/catalog.ts";
import { runExpertTask } from "../experts/worker.ts";

test("the planned expert entry stays in the catalog, starts no task and never runs", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const account = { username: `coming-${suffix}`, realName: "预告甲", password: "long-test-password-123" };
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;

  // A row that was deployed with another status flips to the planned state on the next seed.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${COMING_SOON_EXPERT_SLUG}, NULL, '企业舆情报告', '已部署的预告条目', '0.1.0', '已部署的技能文本', ${sql.json({ tools: [] })}, 'available', ARRAY[]::text[])
    ON CONFLICT(slug) DO UPDATE SET status='available'`;

  // A blocked expert of this employee, so the catalog has one entry of every state to sort.
  const user = (await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`)[0]!;
  const blockedSlug = `blocked-${suffix}`;
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${blockedSlug}, ${user.id}, '缺依赖的专家', '等待依赖接入', '0.1.0', '技能文本', ${sql.json({ tools: [] })}, 'blocked', ARRAY['missing_tool']::text[])`;

  const catalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string; name: string; status: string }> }).experts;
  const planned = catalog.find(expert => expert.slug === COMING_SOON_EXPERT_SLUG);
  assert.ok(planned, "开发中的条目对员工可见");
  assert.equal(planned?.status, COMING_SOON_EXPERT_STATUS, "开发中的条目标记为 coming_soon");
  assert.equal(planned?.name, COMING_SOON_EXPERT.name);
  assert.ok(catalog.some(expert => expert.slug === PANORAMA_EXPERT_SLUG), "对外投资全景图仍在目录中");
  assert.ok(!catalog.some(expert => expert.slug === EXPERT_SLUG), "一层对外投资核查仍不出现");
  // The catalog sorts the states: runnable first, then the planned entry, then the blocked one.
  const order = catalog.map(expert => expert.slug);
  assert.ok(order.indexOf(PANORAMA_EXPERT_SLUG) < order.indexOf(COMING_SOON_EXPERT_SLUG), "可运行的专家排在开发中的之前");
  assert.ok(order.indexOf(COMING_SOON_EXPERT_SLUG) < order.indexOf(blockedSlug), "开发中的条目排在缺少依赖的之前");

  // The seed writes the planned state and its own copy back.
  const row = (await sql<{ status: string; name: string; skill_md: string; missing_dependencies: string[] }[]>`SELECT status, name, skill_md, missing_dependencies FROM member_experts WHERE slug=${COMING_SOON_EXPERT_SLUG}`)[0]!;
  assert.equal(row.status, COMING_SOON_EXPERT_STATUS, "已部署的行在下次播种时翻成 coming_soon");
  assert.equal(row.name, COMING_SOON_EXPERT.name);
  assert.ok(row.skill_md.includes("开发中"), "技能文本说明仍在开发中");
  assert.deepEqual(row.missing_dependencies, [], "开发中的条目不写缺少依赖");

  // No task starts on the planned entry, and the refusal names the state instead of a missing dependency.
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie, ...common, "idempotency-key": randomUUID() }, payload: { slug: COMING_SOON_EXPERT_SLUG, notes: "先看看舆情" } });
  assert.equal(created.statusCode, 404);
  assert.equal((await created.json() as { error: string }).error, "expert_coming_soon");
  const tasks = await sql<{ id: string }[]>`SELECT id FROM member_expert_tasks WHERE expert_slug=${COMING_SOON_EXPERT_SLUG}`;
  assert.equal(tasks.length, 0, "开发中的条目没有任务落库");

  // An administrator sees the same entry: the planned state is platform-wide, not per employee.
  await sql`UPDATE member_users SET role='admin' WHERE username=${account.username}`;
  const adminCatalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string; status: string }> }).experts;
  assert.ok(adminCatalog.some(expert => expert.slug === COMING_SOON_EXPERT_SLUG && expert.status === COMING_SOON_EXPERT_STATUS), "管理员目录里也有这条开发中条目");
  await sql`UPDATE member_users SET role='member' WHERE username=${account.username}`;

  // Even a task that was queued by hand does not run: the executor refuses a planned expert.
  const taskId = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES (${taskId},${user.id},${COMING_SOON_EXPERT_SLUG},'queued',${sql.json({ notes: "先看看舆情" })})`;
  await runExpertTask(taskId);
  const task = (await sql<{ state: string; error_code: string | null }[]>`SELECT state, error_code FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(task.state, "failed", "开发中的条目不执行");
  assert.equal(task.error_code, "expert_execution_failed");
  const artifacts = await sql<{ id: string }[]>`SELECT id FROM member_expert_artifacts WHERE task_id=${taskId}`;
  assert.equal(artifacts.length, 0, "开发中的条目不产出报告");
});
