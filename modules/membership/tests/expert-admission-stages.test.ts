import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { PANORAMA_EXPERT_SLUG, XINHUA_ALLOWED_TOOLS, XINHUA_BASE_TOOLS } from "../experts/catalog.ts";
import { recoverExpertTasks, runExpertTask } from "../experts/worker.ts";

test("entity search and confirmed execution have separate bounded claims", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); });
  const username = `expert-stages-${tag()}`;
  const headers = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/membership/register", headers, payload: { username, realName: "测试员工", password: "long-test-password-123" } })).statusCode, 201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const [{ id: userId }] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers, payload: { username, password: "long-test-password-123" } });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0]!;
  await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { ...headers, cookie } });
  const oldKey = process.env.XINHUA_MCP_API_KEY;
  process.env.XINHUA_MCP_API_KEY = "";
  t.after(() => { if (oldKey === undefined) delete process.env.XINHUA_MCP_API_KEY; else process.env.XINHUA_MCP_API_KEY = oldKey; });

  for (const [slug, tools] of [[`three-${tag()}`, [...XINHUA_BASE_TOOLS]], [`eight-${tag()}`, [...XINHUA_ALLOWED_TOOLS]]] as const) {
    await sql`INSERT INTO member_experts(slug,owner_id,name,description,version,skill_md,manifest,status,missing_dependencies)
      VALUES(${slug},${userId},'测试专家','测试','1.0.0','测试',${sql.json({ tools })},'available',ARRAY[]::text[])`;
  }
  const slugs = [PANORAMA_EXPERT_SLUG, ...((await sql<{ slug: string }[]>`SELECT slug FROM member_experts WHERE owner_id=${userId} ORDER BY slug`).map(row => row.slug))];
  for (const [index, slug] of slugs.entries()) {
    const id = randomUUID();
    const searchAttempts = index === 1 ? 1 : 3;
    await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,execution_attempts,last_attempt_at)
      VALUES(${id},${userId},${slug},'failed',${sql.json({ companyName: "示例企业" })},${index === 0 ? 1 : searchAttempts},now()-interval '2 hours')`;
    if (index === 0) {
      // Two failed searches can be retried; the third claim finds candidates.
      for (const attempts of [1, 2]) {
        await sql`UPDATE member_expert_tasks SET state='failed',execution_attempts=${attempts} WHERE id=${id}`;
        assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${id}/retry`, headers: { ...headers, cookie } })).statusCode, 202);
      }
    }
    await sql`UPDATE member_expert_tasks SET state='waiting_input',stage='choose_entity',execution_attempts=${searchAttempts},
      result=${sql.json({ candidates: [{ id: "entity-1", name: "示例企业" }] })} WHERE id=${id}`;
    const confirm = await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${id}/entity`, headers: { ...headers, cookie }, payload: { companyId: "entity-1" } });
    assert.equal(confirm.statusCode, 202, slug);
    await runExpertTask(id);
    const [result] = await sql<{ state: string; execution_attempts: number; confirmed_attempts: number; error_code: string | null }[]>`SELECT state,execution_attempts,confirmed_attempts,error_code FROM member_expert_tasks WHERE id=${id}`;
    assert.equal(result?.state, "failed", "provider unavailable must be an explicit failure after confirmation");
    assert.equal(result?.execution_attempts, searchAttempts + 1);
    assert.equal(result?.confirmed_attempts, 1);
    assert.equal(result?.error_code, "xinhua_not_configured");
    const detail = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${id}`, headers: { ...headers, cookie } });
    assert.equal((await detail.json() as { task: { confirmedAttempts: number } }).task.confirmedAttempts, 1);
  }

  const noBudget = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,result,execution_attempts,confirmed_attempts)
    VALUES(${noBudget},${userId},${PANORAMA_EXPERT_SLUG},'waiting_input','{}'::jsonb,
      ${sql.json({ candidates: [{ id: "entity-1" }] })},3,3)`;
  const refused = await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${noBudget}/entity`, headers: { ...headers, cookie }, payload: { companyId: "entity-1" } });
  assert.equal(refused.statusCode, 409);
  assert.equal((await sql<{ state: string; error_code: string }[]>`SELECT state,error_code FROM member_expert_tasks WHERE id=${noBudget}`)[0]?.error_code, "expert_retry_exhausted");

  const cancelled = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,execution_attempts) VALUES(${cancelled},${userId},${PANORAMA_EXPERT_SLUG},'waiting_input','{}'::jsonb,1)`;
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${cancelled}/cancel`, headers: { ...headers, cookie } })).statusCode, 200);
  assert.equal((await sql<{ state: string }[]>`SELECT state FROM member_expert_tasks WHERE id=${cancelled}`)[0]?.state, "cancelled");

  const stale = randomUUID(), exhausted = randomUUID();
  for (const [id, confirmedAttempts] of [[stale, 1], [exhausted, 3]] as const) {
    await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,selected_entity,execution_attempts,confirmed_attempts,lease_expires_at)
      VALUES(${id},${userId},${PANORAMA_EXPERT_SLUG},'running','{}'::jsonb,${sql.json({ id: "entity-1" })},${3 + confirmedAttempts},${confirmedAttempts},now()-interval '1 minute')`;
  }
  const requeued: string[] = [];
  await recoverExpertTasks(async id => { requeued.push(id); });
  assert.ok(requeued.includes(stale));
  assert.equal((await sql<{ state: string }[]>`SELECT state FROM member_expert_tasks WHERE id=${exhausted}`)[0]?.state, "failed");

  const stranded = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,selected_entity,execution_attempts)
    VALUES(${stranded},${userId},${PANORAMA_EXPERT_SLUG},'queued','{}'::jsonb,${sql.json({ id: "entity-1" })},3)`;
  await recoverExpertTasks(async id => { requeued.push(id); });
  assert.ok(requeued.includes(stranded), "old queued tasks are rescheduled in a bounded recovery batch");
  await recoverExpertTasks(async id => { requeued.push(id); });
  assert.equal(requeued.filter(id => id === stranded).length, 1, "legacy recovery does not enqueue the same row every minute");
  const unclaimable = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,execution_attempts)
    VALUES(${unclaimable},${userId},${PANORAMA_EXPERT_SLUG},'queued','{}'::jsonb,3)`;
  await runExpertTask(unclaimable);
  assert.equal((await sql<{ error_code: string }[]>`SELECT error_code FROM member_expert_tasks WHERE id=${unclaimable}`)[0]?.error_code, "expert_retry_exhausted");
});

test("manual retry shares the two-active-task admission lock with create", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const username = `expert-admission-${tag()}`;
  const headers = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/membership/register", headers, payload: { username, realName: "测试员工", password: "long-test-password-123" } })).statusCode, 201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const [{ id: userId }] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers, payload: { username, password: "long-test-password-123" } });
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0]!;
  await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { ...headers, cookie } });
  const failed = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,execution_attempts,last_attempt_at)
    VALUES(${failed},${userId},${PANORAMA_EXPERT_SLUG},'failed','{}'::jsonb,1,now()-interval '2 hours')`;
  const active = [randomUUID(), randomUUID()];
  for (const id of active) await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES(${id},${userId},${PANORAMA_EXPERT_SLUG},'queued','{}'::jsonb)`;
  const retry = () => app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${failed}/retry`, headers: { ...headers, cookie } });
  const jobsBefore = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pgboss.job WHERE data->>'taskId'=${failed}`;
  assert.equal((await retry()).statusCode, 429);
  const [unchanged] = await sql<{ state: string; execution_attempts: number; count: number }[]>`SELECT state,execution_attempts,(SELECT count(*)::int FROM pgboss.job WHERE data->>'taskId'=${failed}) AS count FROM member_expert_tasks WHERE id=${failed}`;
  assert.equal(unchanged?.state, "failed");
  assert.equal(unchanged?.execution_attempts, 1);
  assert.equal(unchanged?.count, jobsBefore[0]?.count);

  await sql`UPDATE member_expert_tasks SET state='cancelled' WHERE id=${active[1]}`;
  const create = () => app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, cookie }, payload: { slug: PANORAMA_EXPERT_SLUG, companyName: "示例企业" } });
  const [created, retried] = await Promise.all([create(), retry()]);
  assert.deepEqual([created.statusCode, retried.statusCode].sort(), [202, 429]);
  const [capacity] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${userId} AND state IN ('queued','running','waiting_input') AND expires_at>now()`;
  assert.equal(capacity?.count, 2);
});
