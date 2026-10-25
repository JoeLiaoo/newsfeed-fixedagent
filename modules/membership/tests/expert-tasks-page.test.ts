import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";

type TaskPage = { tasks: Array<{ id: string; expertSlug: string; expertName: string; state: string; hasArtifact: boolean; materials: unknown[] }>; pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } };

test("the employee task list pages one expert's own history", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  const accounts = [
    { username: `expert-page-a-${suffix}`, realName: "员工甲", password: "long-test-password-123" },
    { username: `expert-page-b-${suffix}`, realName: "员工乙", password: "long-test-password-123" },
  ];
  const cookies: string[] = [];
  const userIds: string[] = [];
  for (const account of accounts) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
    assert.equal(registered.statusCode, 201);
  }
  await sql`UPDATE member_users SET status='active' WHERE username IN (${accounts[0]!.username},${accounts[1]!.username})`;
  for (const account of accounts) {
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!);
    const [user] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${account.username}`;
    userIds.push(user!.id);
  }
  const [owner, other] = userIds as [string, string];

  // The catalog endpoint seeds the builtins; the panorama is the employee-facing builtin.
  const catalog = await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(catalog.statusCode, 200);
  const builtin = (await catalog.json() as { experts: Array<{ slug: string }> }).experts.find(expert => expert.slug === "outbound-investment-panorama");
  assert.ok(builtin, "对外投资全景图专家在目录中");

  const customSlug = `page-expert-${suffix}`;
  await sql`INSERT INTO member_experts(slug,owner_id,name,description,version,skill_md,manifest,status,missing_dependencies)
    VALUES (${customSlug},${owner},'分页测试专家','分页测试专家','1.0.0','---\nname: Page\ndescription: Page\n---\n',${sql.json({ tools: [], skills: [] })},'available',ARRAY[]::text[])`;

  const oldest = randomUUID(), middle = randomUUID(), newest = randomUUID(), onBuiltin = randomUUID(), onOtherExpert = randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,created_at,updated_at) VALUES
    (${oldest},${owner},${customSlug},'succeeded',${sql.json({ notes: "最早一条" })},now()-interval '30 minutes',now()-interval '30 minutes'),
    (${middle},${owner},${customSlug},'succeeded',${sql.json({ notes: "中间一条" })},now()-interval '20 minutes',now()-interval '20 minutes'),
    (${newest},${owner},${customSlug},'succeeded',${sql.json({ notes: "最新一条" })},now()-interval '10 minutes',now()-interval '10 minutes'),
    (${onBuiltin},${owner},${builtin!.slug},'succeeded',${sql.json({ notes: "另一个专家" })},now()-interval '5 minutes',now()-interval '5 minutes'),
    (${onOtherExpert},${other},${customSlug},'succeeded',${sql.json({ notes: "别人的任务" })},now()-interval '1 minute',now()-interval '1 minute')`;

  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks" });
  assert.equal(unauthorized.statusCode, 401, "访客读不到任务列表");
  for (const url of [
    "/api/v1/membership/expert-tasks?limit=abc",
    "/api/v1/membership/expert-tasks?offset=-1",
    "/api/v1/membership/expert-tasks?limit=1&limit=2",
    "/api/v1/membership/expert-tasks?expertSlug=not%20a%20slug",
  ]) {
    const invalid = await app.inject({ method: "GET", url, headers: { cookie: cookies[0]! } });
    assert.equal(invalid.statusCode, 400, url);
  }

  const firstPage = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}&limit=1`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(firstPage.statusCode, 200);
  assert.equal(firstPage.headers["cache-control"], "private, no-store");
  const first = await firstPage.json() as TaskPage;
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0]?.id, newest, "该专家的最新任务排在最前");
  assert.equal(first.tasks[0]?.expertSlug, customSlug);
  assert.equal(first.tasks[0]?.expertName, "分页测试专家");
  assert.equal(first.tasks[0]?.state, "succeeded");
  assert.equal(first.tasks[0]?.hasArtifact, false);
  assert.deepEqual(first.tasks[0]?.materials, []);
  assert.deepEqual(first.pagination, { limit: 1, offset: 0, hasMore: true, nextOffset: 1 });

  const second = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}&limit=1&offset=1`, headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.equal(second.tasks.length, 1);
  assert.equal(second.tasks[0]?.id, middle);
  assert.deepEqual(second.pagination, { limit: 1, offset: 1, hasMore: true, nextOffset: 2 });

  const last = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}&limit=1&offset=2`, headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.equal(last.tasks[0]?.id, oldest);
  assert.deepEqual(last.pagination, { limit: 1, offset: 2, hasMore: false, nextOffset: null });

  const beyond = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}&limit=1&offset=3`, headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.deepEqual(beyond.tasks, []);
  assert.deepEqual(beyond.pagination, { limit: 1, offset: 3, hasMore: false, nextOffset: null });

  const filtered = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}`, headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.deepEqual(filtered.tasks.map(task => task.id), [newest, middle, oldest], "按专家过滤只返回该专家的任务");
  assert.equal(filtered.pagination.hasMore, false);

  const otherExpert = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${builtin!.slug}`, headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.deepEqual(otherExpert.tasks.map(task => task.id), [onBuiltin], "换一个专家读到的就是那个专家的任务");

  const all = await (await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[0]!, ...common } })).json() as TaskPage;
  assert.deepEqual(all.tasks.map(task => task.id), [onBuiltin, newest, middle, oldest], "不按专家过滤时读的是本人的全部任务");
  assert.equal(all.pagination.limit, 20, "默认一页 20 条");

  const otherList = await (await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks?expertSlug=${customSlug}`, headers: { cookie: cookies[1]!, ...common } })).json() as TaskPage;
  assert.deepEqual(otherList.tasks.map(task => task.id), [onOtherExpert], "另一个员工只读到自己在这个专家下的任务");
  const otherAll = await (await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie: cookies[1]!, ...common } })).json() as TaskPage;
  assert.deepEqual(otherAll.tasks.map(task => task.id), [onOtherExpert], "任务列表不泄露其他员工的任务");
});
