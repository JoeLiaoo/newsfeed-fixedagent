import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { runExpertTask } from "../experts/worker.ts";

test("expert tasks enforce per-user isolation, idempotency, cancellation, retry caps and expiry", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const accounts = [
    { username: `expert-a-${suffix}`, realName: "专家甲", password: "long-test-password-123" },
    { username: `expert-b-${suffix}`, realName: "专家乙", password: "long-test-password-123" },
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
  const expertsResponse = await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(expertsResponse.statusCode, 200);
  const experts = (await expertsResponse.json() as { experts: Array<{ slug: string; execution_mode: string }> }).experts;
  const builtin = experts.find(expert => expert.execution_mode === "xinhua_trial");
  assert.ok(builtin);

  const key = randomUUID();
  const create = () => app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common, "idempotency-key": key }, payload: { slug: builtin.slug, companyName: "测试企业" } });
  const first = await create();
  const duplicate = await create();
  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.statusCode, 202);
  assert.equal((await first.json() as { id: string }).id, (await duplicate.json() as { id: string }).id);
  const taskId = (await first.json() as { id: string }).id;
  const retention = await sql<{ days: number }[]>`SELECT round(extract(epoch FROM (expires_at-created_at))/86400)::int AS days FROM member_expert_tasks WHERE id=${taskId}`;
  assert.equal(retention[0]?.days, 7);
  const ownership = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[1]!, ...common } });
  assert.deepEqual((await ownership.json() as { tasks: unknown[] }).tasks, []);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${taskId}/cancel`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404);

  const artifactBody = Buffer.from("private artifact");
  await sql`INSERT INTO member_expert_artifacts(task_id,user_id,filename,content_type,body,sha256) VALUES (${taskId},${userIds[0]},'private.md','text/markdown',${artifactBody},${createHash("sha256").update(artifactBody).digest("hex")})`;
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers: { cookie: cookies[1]! } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers: { cookie: cookies[0]! } })).statusCode, 200);

  const second = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common }, payload: { slug: builtin.slug, companyName: "另一个测试企业" } });
  assert.equal(second.statusCode, 202);
  const limited = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common }, payload: { slug: builtin.slug, companyName: "第三个测试企业" } });
  assert.equal(limited.statusCode, 429);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${taskId}/cancel`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  const secondTaskId = (await second.json() as { id: string }).id;
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${secondTaskId}/cancel`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  for (let index = 0; index < 8; index++) {
    const rateLimitedCandidate: Awaited<ReturnType<typeof app.inject>> = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common }, payload: { slug: builtin.slug, companyName: `频率测试${index}` } });
    assert.equal(rateLimitedCandidate.statusCode, 202);
    const id = (await rateLimitedCandidate.json() as { id: string }).id;
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${id}/cancel`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common }, payload: { slug: builtin.slug, companyName: "超过每小时额度" } })).statusCode, 429);

  const customSlug = `test-expert-${suffix}`;
  await sql`INSERT INTO member_experts(slug,owner_id,name,description,version,skill_md,manifest,status,missing_dependencies) VALUES (${customSlug},${userIds[0]},'Test','Test','1.0.0','---\nname: Test\ndescription: Test\n---\n',${sql.json({ tools: [], skills: [] })},'available',ARRAY[]::text[])`;
  const concurrentId = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES (${concurrentId},${userIds[0]},${customSlug},'queued',${sql.json({ notes: "mocked retry boundary" })})`;
  const previousModelEnv = Object.fromEntries(["MODEL_CALLS_ENABLED", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].map(key => [key, process.env[key]]));
  const model = await stub(() => ({ id: "expert-mock", model: "expert-mock", choices: [{ message: { content: JSON.stringify({ result: "mock report", caveats: ["fixture"] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  Object.assign(process.env, { MODEL_CALLS_ENABLED: "true", LLM_BASE_URL: `${model.url}/v1`, LLM_API_KEY: "mock-key", LLM_MODEL: "expert-mock" });
  try { await Promise.all([runExpertTask(concurrentId), runExpertTask(concurrentId)]); }
  finally {
    await model.close();
    for (const [key, value] of Object.entries(previousModelEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const concurrency = await sql<{ execution_attempts: number; state: string }[]>`SELECT execution_attempts,state FROM member_expert_tasks WHERE id=${concurrentId}`;
  assert.equal(concurrency[0]?.execution_attempts, 1);
  assert.equal(concurrency[0]?.state, "succeeded");
  assert.equal(model.hits(), 1);
  await sql`UPDATE member_expert_tasks SET state='failed',execution_attempts=1,last_attempt_at=now() WHERE id=${concurrentId}`;
  const retry = await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${concurrentId}/retry`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(retry.statusCode, 202);
  await sql`UPDATE member_expert_tasks SET state='failed',execution_attempts=3 WHERE id=${concurrentId}`;
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${concurrentId}/retry`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);

  await sql`UPDATE member_expert_tasks SET expires_at=now()-interval '1 second' WHERE id=${taskId}`;
  await sql`UPDATE member_expert_artifacts SET expires_at=now()-interval '1 second' WHERE task_id=${taskId}`;
  const expiredList = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]! } });
  assert(!((await expiredList.json() as { tasks: Array<{ id: string }> }).tasks).some(task => task.id === taskId));
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers: { cookie: cookies[0]! } })).statusCode, 404);
});
