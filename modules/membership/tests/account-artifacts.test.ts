import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";

type Row = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string;
  input: { companyName: string | null; query?: string | null; notes: string; notesTruncated: boolean };
  createdAt: string; updatedAt: string; hasArtifact: boolean;
  materials: Array<{ id: string; filename: string; byteSize: number; extractionStatus: string }>;
};
type Page = { tasks: Row[]; pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } };

test("the employee's own task library pages, filters and keeps every task to its owner", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  const accounts = [
    { username: `artifacts-a-${suffix}`, realName: "产物甲", password: "long-test-password-123" },
    { username: `artifacts-b-${suffix}`, realName: "产物乙", password: "long-test-password-123" },
  ];
  const cookies: string[] = [];
  const userIds: string[] = [];
  for (const account of accounts) {
    await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
    await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!);
    const [user] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`;
    userIds.push(user!.id);
  }

  const visitor = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks" });
  assert.equal(visitor.statusCode, 401, "a visitor reads no task history");
  for (const url of [
    "/api/v1/membership/expert-tasks?limit=abc",
    "/api/v1/membership/expert-tasks?limit=-1",
    "/api/v1/membership/expert-tasks?offset=1.5",
    "/api/v1/membership/expert-tasks?limit=1&limit=2",
    "/api/v1/membership/expert-tasks?state=unknown",
    "/api/v1/membership/expert-tasks?expertSlug=bad%20slug",
  ]) {
    const invalid = await app.inject({ method: "GET", url, headers: { cookie: cookies[0]!, ...common } });
    assert.equal(invalid.statusCode, 400, url);
  }

  const slugA = `artifacts-expert-a-${suffix}`;
  const slugB = `artifacts-expert-b-${suffix}`;
  await sql`INSERT INTO member_experts(slug,owner_id,name,description,version,skill_md,manifest,status,missing_dependencies)
    VALUES (${slugA},${userIds[0]},'产物专家甲','测试用','1.0.0','notes',${sql.json({ tools: [] })},'available',ARRAY[]::text[]),
           (${slugB},${null},'产物专家乙','测试用','1.0.0','notes',${sql.json({ tools: [] })},'available',ARRAY[]::text[])`;

  const longNotes = "核".repeat(500);
  const taskIds: string[] = [];
  for (let index = 0; index < 25; index++) {
    const id = randomUUID();
    taskIds.push(id);
    await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,stage,input,created_at,updated_at)
      VALUES (${id},${userIds[0]},${index % 2 === 0 ? slugA : slugB},${index % 3 === 0 ? "queued" : index % 3 === 1 ? "succeeded" : "failed"},
        ${index % 3 === 0 ? "queued" : "complete"},${sql.json({ companyName: `测试企业${index}`, notes: longNotes })},
        now() - ${index} * interval '1 minute', now() - ${index} * interval '1 minute')`;
  }
  const [otherTask] = await sql<{ id: string }[]>`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,stage,input)
    VALUES (${randomUUID()},${userIds[1]},${slugA},'succeeded','complete',${sql.json({ notes: "别人的任务" })}) RETURNING id`;
  const [expiredTask] = await sql<{ id: string }[]>`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,stage,input,expires_at)
    VALUES (${randomUUID()},${userIds[0]},${slugA},'succeeded','complete',${sql.json({ notes: "过期任务" })},now()-interval '1 second') RETURNING id`;

  const materialBody = Buffer.from("# 私有材料\n");
  await sql`INSERT INTO member_expert_task_materials(id,task_id,user_id,filename,format,content_type,byte_size,sha256,body,extraction_status)
    VALUES (${randomUUID()},${taskIds[0]!},${userIds[0]},'证据.md','markdown','text/markdown',${materialBody.byteLength},${createHash("sha256").update(materialBody).digest("hex")},${materialBody},'available')`;
  const artifactBody = Buffer.from("# 报告\n");
  await sql`INSERT INTO member_expert_artifacts(task_id,user_id,filename,content_type,body,sha256)
    VALUES (${taskIds[0]!},${userIds[0]},'report.md','text/markdown',${artifactBody},${createHash("sha256").update(artifactBody).digest("hex")})`;

  const first = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["cache-control"], "private, no-store");
  const firstPage = await first.json() as Page;
  assert.equal(firstPage.tasks.length, 20, "a page carries twenty records");
  assert.equal(firstPage.pagination.limit, 20);
  assert.equal(firstPage.pagination.offset, 0);
  assert.equal(firstPage.pagination.hasMore, true);
  assert.equal(firstPage.pagination.nextOffset, 20);
  assert.equal(firstPage.tasks.filter(row => row.id === otherTask!.id).length, 0, "another employee's task never shows up");
  assert.equal(firstPage.tasks.filter(row => row.id === expiredTask!.id).length, 0, "an expired task is not in the library");

  const newest = firstPage.tasks[0]!;
  assert.equal(newest.expertSlug, slugA);
  assert.equal(newest.expertName, "产物专家甲");
  assert.equal(newest.state, "queued");
  assert.equal(newest.stage, "queued");
  assert.ok(newest.createdAt);
  assert.ok(newest.updatedAt);
  assert.equal(newest.hasArtifact, true);
  assert.equal(newest.materials.length, 1);
  assert.equal(newest.materials[0]!.filename, "证据.md");
  assert.equal(newest.materials[0]!.byteSize, materialBody.byteLength);
  assert.equal(newest.materials[0]!.extractionStatus, "available");
  assert.equal("body" in newest.materials[0]!, false, "a material row carries no file bytes");
  assert.equal(newest.input.companyName, "测试企业0");
  assert.equal(newest.input.notes.length, 200, "a row carries a short preview of the notes");
  assert.equal(newest.input.notesTruncated, true);

  const second = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks?offset=20", headers: { cookie: cookies[0]!, ...common } });
  const secondPage = await second.json() as Page;
  assert.equal(secondPage.tasks.length, 5, "the last page carries what is left");
  assert.equal(secondPage.pagination.hasMore, false);
  assert.equal(secondPage.pagination.nextOffset, null);
  assert.equal(secondPage.pagination.offset, 20);
  const firstIds = new Set(firstPage.tasks.map(row => row.id));
  assert.equal(secondPage.tasks.filter(row => firstIds.has(row.id)).length, 0, "two pages never repeat a record");

  const byExpert = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${slugA}&limit=100`, headers: { cookie: cookies[0]!, ...common } });
  const expertPage = await byExpert.json() as Page;
  assert.equal(expertPage.tasks.length, 13);
  assert.equal(expertPage.tasks.every(row => row.expertSlug === slugA), true, "the expert filter narrows the history");
  const otherExpert = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${slugB}&limit=100`, headers: { cookie: cookies[0]!, ...common } });
  const otherExpertPage = await otherExpert.json() as Page;
  assert.equal(otherExpertPage.tasks.length, 12);
  assert.equal(otherExpertPage.tasks.every(row => row.expertSlug === slugB), true);

  const byState = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks?state=succeeded&limit=100", headers: { cookie: cookies[0]!, ...common } });
  const statePage = await byState.json() as Page;
  assert.equal(statePage.tasks.every(row => row.state === "succeeded"), true);
  assert.equal(statePage.tasks.length, 8);
  const byStates = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks?state=queued,running&limit=100", headers: { cookie: cookies[0]!, ...common } });
  const statesPage = await byStates.json() as Page;
  assert.equal(statesPage.tasks.every(row => row.state === "queued" || row.state === "running"), true);

  const other = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[1]!, ...common } });
  const otherPage = await other.json() as Page;
  assert.deepEqual(otherPage.tasks.map(row => row.id), [otherTask!.id], "each employee reads only their own tasks");
  assert.equal(otherPage.pagination.hasMore, false);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskIds[0]!}/artifact`, headers: { cookie: cookies[1]!, ...common } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskIds[0]!}/artifact`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
});
