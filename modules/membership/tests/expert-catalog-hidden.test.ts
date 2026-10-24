import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { EXPERT_SLUG, PANORAMA_EXPERT_SLUG } from "../experts/catalog.ts";
import { runExpertTask } from "../experts/worker.ts";

const THREE_TOOL_SKILL = [
  "---",
  "name: 三工具核查",
  "description: 声明主体检索、企业画像与一层直接投资三个平台工具的自定义技能。",
  "dependencies:",
  "  tools:",
  "    - fuzzy_search_company_list",
  "    - get_company_profile",
  "    - get_direct_investment",
  "---",
  "",
  "# 三工具核查",
].join("\n");

test("the one-layer builtin is hidden while the panorama and the three-tool skill stay", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const account = { username: `hidden-${suffix}`, realName: "隐藏甲", password: "long-test-password-123" };
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;

  // An already deployed row still carries `available`; the seed flips it to hidden on the next call.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${EXPERT_SLUG}, NULL, '企业一层对外投资核查', '已部署的一层专家', '0.1.0', '已部署的技能文本', ${sql.json({ tools: ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] })}, 'available', ARRAY[]::text[])
    ON CONFLICT(slug) DO UPDATE SET status='available'`;

  const experts = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string; name: string; status: string; execution_mode: string }> }).experts;
  assert.ok(!experts.some(expert => expert.slug === EXPERT_SLUG), "一层对外投资核查不再是目录入口");
  assert.ok(experts.some(expert => expert.slug === PANORAMA_EXPERT_SLUG), "对外投资全景图仍在目录中");
  assert.ok(!experts.some(expert => expert.execution_mode === "xinhua_trial"), "目录里没有一层模式的内置专家");

  // The row and its skill text stay; only the status says the catalog does not offer it.
  const rows = await sql<{ status: string; skill_md: string }[]>`SELECT status, skill_md FROM member_experts WHERE slug=${EXPERT_SLUG}`;
  assert.equal(rows[0]?.status, "hidden");
  assert.ok(rows[0]?.skill_md.includes("企业一层对外投资核查"), "隐藏的专家仍保留技能文本");

  // No new task starts on the hidden slug, and the refusal reads as absent rather than broken.
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie, ...common, "idempotency-key": randomUUID() }, payload: { slug: EXPERT_SLUG, companyName: "本方主体" } });
  assert.equal(created.statusCode, 404);
  assert.equal((await created.json() as { error: string }).error, "expert_not_found");

  // An administrator sees the same catalog: the entry is hidden platform-wide.
  await sql`UPDATE member_users SET role='admin' WHERE username=${account.username}`;
  const adminCatalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string }> }).experts;
  assert.ok(!adminCatalog.some(expert => expert.slug === EXPERT_SLUG), "管理员目录里也没有一层对外投资核查");
  await sql`UPDATE member_users SET role='member' WHERE username=${account.username}`;

  // A custom skill that declares the three base tools keeps the one-layer capability mode.
  const imported = await app.inject({ method: "POST", url: "/api/v1/membership/experts/import", headers: { cookie, ...common }, payload: { fileName: "three-tools.md", base64: Buffer.from(THREE_TOOL_SKILL, "utf8").toString("base64") } });
  assert.equal(imported.statusCode, 201);
  const importedExpert = (await imported.json() as { expert: { slug: string; status: string; executionMode: string } }).expert;
  assert.equal(importedExpert.executionMode, "xinhua_trial");
  assert.equal(importedExpert.status, "available");
  const afterImport = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string; execution_mode: string }> }).experts;
  assert.ok(!afterImport.some(expert => expert.slug === EXPERT_SLUG), "导入不把一层专家放回目录");
  assert.ok(afterImport.some(expert => expert.slug === importedExpert.slug && expert.execution_mode === "xinhua_trial"), "只声明三个基础工具的自定义技能仍是一层对外投资核查模式");

  // A task that was created before the expert was hidden still runs: the worker does not refuse it.
  const user = (await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`)[0]!;
  const taskId = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES (${taskId},${user.id},${EXPERT_SLUG},'queued',${sql.json({ companyName: "本方主体" })})`;
  await runExpertTask(taskId);
  const task = (await sql<{ state: string; error_code: string | null }[]>`SELECT state, error_code FROM member_expert_tasks WHERE id=${taskId}`)[0]!;
  assert.equal(task.state, "failed", "没有配置企业信息查询服务，任务失败而不是被拒绝");
  assert.equal(task.error_code, "xinhua_not_configured", "隐藏的专家仍然执行了任务");
});
