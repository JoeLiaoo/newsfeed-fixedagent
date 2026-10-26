import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";

test("a single expert task is read by its owner alone, with the row the list returns", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const accounts = [
    { username: `task-a-${suffix}`, realName: "任务甲", password: "long-test-password-123" },
    { username: `task-b-${suffix}`, realName: "任务乙", password: "long-test-password-123" },
  ];
  const cookies: string[] = [];
  const userIds: string[] = [];
  for (const account of accounts) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: account });
    assert.equal(registered.statusCode, 201);
  }
  await sql`UPDATE member_users SET status='active' WHERE username IN (${accounts[0]!.username},${accounts[1]!.username})`;
  for (const account of accounts) {
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!);
    const user = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`;
    userIds.push(user[0]!.id);
  }
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };

  const experts = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie: cookies[0]!, ...common } })).json() as { experts: Array<{ slug: string; execution_mode: string }> }).experts;
  const builtin = experts.find(expert => expert.execution_mode === "xinhua_panorama");
  assert.ok(builtin, "对外投资全景图专家在目录中");

  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common }, payload: { slug: builtin.slug, companyName: "任务详情测试企业" } });
  assert.equal(created.statusCode, 202);
  const taskId = (await created.json() as { id: string }).id;

  // A visitor is not a member of anything; another employee's task is missing, not forbidden.
  const visitor = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { host: "newsfeed.test" } });
  assert.equal(visitor.statusCode, 401);
  assert.equal((await visitor.json() as { error: string }).error, "login_required");
  const other = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(other.statusCode, 404);
  const missing = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/does-not-exist-${suffix}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(missing.statusCode, 404);

  const preview = "## 核查底稿\n\n样例预览内容";
  const materialBody = Buffer.from("# 材料\n\n样例材料");
  await sql`UPDATE member_expert_tasks SET state='succeeded', stage='complete', execution_attempts=1,
      result=${sql.json({ html: "<!doctype html><html><body>报告预览</body></html>", format: "html", panorama: { incomplete: true, gapCount: 2, limits: ["主体数预算"] } })},
      updated_at=now(), finished_at=now() WHERE id=${taskId}`;
  await sql`INSERT INTO member_expert_artifacts(task_id,user_id,filename,content_type,body,sha256)
    VALUES (${taskId},${userIds[0]},'expert.md','text/markdown',${Buffer.from(preview)},${createHash("sha256").update(Buffer.from(preview)).digest("hex")})`;
  await sql`INSERT INTO member_expert_task_materials(id,task_id,user_id,filename,format,content_type,byte_size,sha256,body,extraction_status)
    VALUES (${`material-${suffix}`},${taskId},${userIds[0]},'证据材料.md','markdown','text/markdown',${materialBody.length},${createHash("sha256").update(materialBody).digest("hex")},${materialBody},'available')`;
  await sql`INSERT INTO member_expert_panorama_checkpoints(task_id,user_id,seq,node_key,depth,kind,tool,payload)
    VALUES (${taskId},${userIds[0]},1,${`node-${suffix}`},0,'read','get_company_profile',${sql.json({ ok: true })})`;

  const own = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(own.statusCode, 200);
  const task = (await own.json() as { task: Record<string, unknown> }).task;
  assert.equal(task.id, taskId);
  assert.equal(task.expertSlug, builtin.slug);
  assert.equal(task.expertName, "对外投资全景图");
  assert.equal(task.state, "succeeded");
  assert.equal(task.stage, "complete");
  assert.equal(task.executionAttempts, 1);
  assert.equal(task.errorCode, null);
  assert.equal(task.errorMessage, null);
  assert.equal(task.hasArtifact, true);
  assert.ok(!("hasCheckpoint" in task), "checkpoint state is internal and omitted from employee task data");
  assert.equal((task.result as { html: string }).html, "<!doctype html><html><body>报告预览</body></html>");
  assert.equal((task.result as { format: string }).format, "html");
  assert.equal((task.input as { companyName: string }).companyName, "任务详情测试企业");
  const materials = task.materials as Array<{ filename: string; byteSize: number; sha256: string; extractionStatus: string }>;
  assert.equal(materials.length, 1);
  assert.equal(materials[0]!.filename, "证据材料.md");
  assert.equal(materials[0]!.byteSize, materialBody.length);
  assert.equal(materials[0]!.extractionStatus, "available");
  assert.ok(typeof task.expiresAt === "string" && new Date(task.expiresAt as string).getTime() > Date.now(), "任务带到期时间");
  assert.ok(typeof task.createdAt === "string" && typeof task.updatedAt === "string");

  // The single task carries the same row as the list, so both pages read one shape.
  const listResponse = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks?limit=1&offset=0", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(listResponse.statusCode, 200);
  const listData = await listResponse.json() as { tasks: Array<Record<string, unknown>>; pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } };
  const list = listData.tasks;
  const listed = list.find(entry => entry.id === taskId);
  assert.ok(listed, "任务在列表中");
  assert.deepEqual(listData.pagination, { limit: 1, offset: 0, hasMore: false, nextOffset: null });
  assert.deepEqual(Object.keys(task).sort(), Object.keys(listed!).sort(), "单个任务与列表同一形状");
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks?limit=bad", headers: { cookie: cookies[0]!, ...common } })).statusCode, 400);

  // A failed task shows its error, and the reason is the employee's own.
  await sql`UPDATE member_expert_tasks SET state='failed', stage='failed', error_code='xinhua_no_candidates', error_message='未匹配到该名称的企业主体。' WHERE id=${taskId}`;
  const failed = (await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { cookie: cookies[0]!, ...common } })).json() as { task: Record<string, unknown> }).task;
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "xinhua_no_candidates");
  assert.equal(failed.errorMessage, "未匹配到该名称的企业主体。");

  // A generated artifact keeps its task visible even if the original task clock expires.
  await sql`UPDATE member_expert_tasks SET expires_at=now()-interval '1 second' WHERE id=${taskId}`;
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  // Once both clocks expire, the task is gone for its owner too.
  await sql`UPDATE member_expert_artifacts SET expires_at=now()-interval '1 second' WHERE task_id=${taskId}`;
  const expired = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(expired.statusCode, 404);
});
