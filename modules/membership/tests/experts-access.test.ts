import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { cleanupExpertData, recoverExpertTasks, runExpertTask } from "../experts/worker.ts";

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
  const blockedSlug = `blocked-expert-${suffix}`;
  await sql`INSERT INTO member_experts(slug,owner_id,name,description,version,skill_md,manifest,status,missing_dependencies) VALUES (${blockedSlug},${userIds[0]},'Blocked','Blocked','1.0.0','blocked',${sql.json({ tools: ["unavailable"] })},'blocked',ARRAY['unavailable']::text[])`;
  const sharedCatalog = await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie: cookies[1]!, ...common } })).json() as { experts: Array<{ slug: string }> };
  assert(sharedCatalog.experts.some(expert => expert.slug === customSlug), "published experts appear in another employee's catalog");
  assert(!sharedCatalog.experts.some(expert => expert.slug === blockedSlug), "blocked imports stay out of the shared catalog");
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[1]!, ...common }, payload: { slug: blockedSlug, notes: "must not execute" } })).statusCode, 404);
  const sharedMaterial = Buffer.from("# Private task evidence\n\nOnly employee B's task may read this material.");
  const sharedTask=await app.inject({method:"POST",url:"/api/v1/membership/expert-tasks",headers:{cookie:cookies[1]!,...common},payload:{slug:customSlug,notes:"共享专家隔离测试",materials:[{fileName:"evidence.md",base64:sharedMaterial.toString("base64")}]}});
  assert.equal(sharedTask.statusCode,202,"a published expert can be executed by another employee");
  const sharedTaskId=(await sharedTask.json() as {id:string}).id;
  const tasksA=await (await app.inject({method:"GET",url:"/api/v1/membership/expert-tasks",headers:{cookie:cookies[0]!,...common}})).json() as {tasks:Array<{id:string}>};
  const tasksB=await (await app.inject({method:"GET",url:"/api/v1/membership/expert-tasks",headers:{cookie:cookies[1]!,...common}})).json() as {tasks:Array<{id:string}>};
  assert(!tasksA.tasks.some(task=>task.id===sharedTaskId));
  assert(tasksB.tasks.some(task=>task.id===sharedTaskId));
  assert.equal((await app.inject({method:"POST",url:`/api/v1/membership/expert-tasks/${sharedTaskId}/cancel`,headers:{cookie:cookies[0]!,...common}})).statusCode,404);
  const [materialRow] = await sql<{ id: string }[]>`SELECT id FROM member_expert_task_materials WHERE task_id=${sharedTaskId}`;
  const materialUrl = `/api/v1/membership/expert-tasks/${sharedTaskId}/materials/${materialRow!.id}`;
  assert.equal((await app.inject({ method: "GET", url: materialUrl, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: materialUrl, headers: { cookie: cookies[1]!, ...common } })).body, sharedMaterial.toString());

  const recoverable=randomUUID(),exhausted=randomUUID();
  for(const [id,attempts] of [[recoverable,1],[exhausted,3]] as const)
    await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,execution_attempts,lease_expires_at)
      VALUES(${id},${userIds[0]},${customSlug},'running',${sql.json({notes:"recovery fixture"})},${attempts},now()-interval '1 minute')`;
  await assert.rejects(recoverExpertTasks(async()=>{throw new Error("queue unavailable")}),/queue unavailable/);
  const afterRollback=await sql<{state:string}[]>`SELECT state FROM member_expert_tasks WHERE id=${recoverable}`;
  assert.equal(afterRollback[0]?.state,"running","state must roll back when enqueue fails");
  const enqueued:string[]=[];
  assert.deepEqual(await recoverExpertTasks(async id=>{enqueued.push(id);}),{recovered:1,exhausted:1});
  assert.deepEqual(enqueued,[recoverable]);
  const recoveredStates=await sql<{id:string;state:string;error_code:string|null}[]>`SELECT id,state,error_code FROM member_expert_tasks WHERE id IN (${recoverable},${exhausted}) ORDER BY id`;
  assert.equal(recoveredStates.find(row=>row.id===recoverable)?.state,"queued");
  assert.equal(recoveredStates.find(row=>row.id===exhausted)?.error_code,"expert_retry_exhausted");

  const concurrentId = sharedTaskId;
  const previousModelEnv = Object.fromEntries(["MODEL_CALLS_ENABLED", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].map(key => [key, process.env[key]]));
  const model = await stub((_hit, request) => {
    assert.match(request.body, /Only employee B's task may read this material/);
    return { id: "expert-mock", model: "expert-mock", choices: [{ message: { content: JSON.stringify({ result: "mock report", caveats: ["fixture"] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  });
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
  assert.equal((await sql`SELECT extraction_status FROM member_expert_task_materials WHERE id=${materialRow!.id}`)[0]?.extraction_status, "available");
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${sharedTaskId}/artifact`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${sharedTaskId}/artifact`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: materialUrl, headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: materialUrl, headers: { cookie: cookies[1]!, ...common } })).statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: materialUrl, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404);
  await sql`UPDATE member_expert_tasks SET state='failed',execution_attempts=1,last_attempt_at=now() WHERE id=${concurrentId}`;
  const retry = await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${concurrentId}/retry`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal(retry.statusCode, 202);
  await sql`UPDATE member_expert_tasks SET state='failed',execution_attempts=3 WHERE id=${concurrentId}`;
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${concurrentId}/retry`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404);

  const marker="receipt-response-marker-7d";
  await sql`INSERT INTO receipts(logical_key,service,purpose,subject,member_user_id,member_task_id,status,response,usage,cost,currency,cost_basis)
    VALUES(${"expert-expiry:"+taskId},'deepseek','expert','expert:test',${userIds[0]},${taskId},'received',${sql.json({report:marker})},${sql.json({tokens:42})},0.25,'USD','actual')`;
  const unrelatedReceipt="expert-unrelated:"+taskId;
  await sql`INSERT INTO receipts(logical_key,service,purpose,subject,status,response)
    VALUES(${unrelatedReceipt},'deepseek','expert','expert:test','received',${sql.json({report:"retain-audit-response"})})`;
  await sql`UPDATE member_expert_tasks SET expires_at=now()-interval '1 second' WHERE id=${taskId}`;
  await sql`UPDATE member_expert_artifacts SET expires_at=now()-interval '1 second' WHERE task_id=${taskId}`;
  const expiredList = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]! } });
  assert(!((await expiredList.json() as { tasks: Array<{ id: string }> }).tasks).some(task => task.id === taskId));
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers: { cookie: cookies[0]! } })).statusCode, 404);
  const retained=await cleanupExpertData();
  assert.equal(retained.expertReceiptResponsesRedacted,1);
  const redacted=await sql<{response:unknown;response_redacted_at:Date|null;usage:{tokens:number};cost:string}[]>`SELECT response,response_redacted_at,usage,cost FROM receipts WHERE logical_key=${"expert-expiry:"+taskId}`;
  assert.equal(redacted[0]?.response,null);
  assert.ok(redacted[0]?.response_redacted_at);
  assert.deepEqual(redacted[0]?.usage,{tokens:42});
  assert.equal(Number(redacted[0]?.cost),0.25);
  const unrelated=await sql<{response:{report:string}}[]>`SELECT response FROM receipts WHERE logical_key=${unrelatedReceipt}`;
  assert.equal(unrelated[0]?.response.report,"retain-audit-response");
});
