import assert from "node:assert/strict";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";

const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };

test("a registration waits for an admin unless the switch skips the approval step", async (t) => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  const prior = process.env.MEMBERSHIP_AUTO_APPROVE;
  t.after(async () => {
    if (prior === undefined) delete process.env.MEMBERSHIP_AUTO_APPROVE;
    else process.env.MEMBERSHIP_AUTO_APPROVE = prior;
    await app.close();
    await closeDb();
  });
  const suffix = tag();

  // Without the switch the account waits, and the pages read the policy without a session.
  delete process.env.MEMBERSHIP_AUTO_APPROVE;
  const policy = await app.inject({ method: "GET", url: "/api/v1/membership/registration-policy" });
  assert.equal(policy.statusCode, 200, "the policy is public: the pages need it before anyone signs in");
  assert.deepEqual(await policy.json(), { autoApprove: false });

  const waiting = { username: `wait-${suffix}`, realName: "待审甲", password: "long-test-password-123" };
  const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: waiting });
  assert.equal(registered.statusCode, 201);
  assert.deepEqual(await registered.json(), { status: "pending_approval" });
  const waitingRow = (await sql<{ status: string; approved_at: Date | null; approved_by: string | null }[]>`SELECT status, approved_at, approved_by FROM member_users WHERE username = ${waiting.username}`)[0]!;
  assert.equal(waitingRow.status, "pending");
  assert.equal(waitingRow.approved_at, null);
  const denied = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: waiting.username, password: waiting.password } });
  assert.equal(denied.statusCode, 403);
  assert.equal((await denied.json() as { error: string }).error, "pending_approval");

  // The admin's review still works: the pending list and the decision.
  const adminAccount = { username: `admin-${suffix}`, realName: "管理员甲", password: "long-test-password-123" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: adminAccount });
  await sql`UPDATE member_users SET status = 'active', role = 'admin' WHERE username = ${adminAccount.username}`;
  const adminLogin = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: adminAccount.username, password: adminAccount.password } });
  assert.equal(adminLogin.statusCode, 200);
  const setCookie = adminLogin.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;
  const pending = (await (await app.inject({ method: "GET", url: "/api/v1/membership/admin/pending", headers: { cookie, ...common } })).json() as { users: Array<{ username: string }> }).users;
  assert.ok(pending.some(user => user.username === waiting.username), "the account waits in the admin's list");
  const waitingId = (await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username = ${waiting.username}`)[0]!.id;
  const decision = await app.inject({ method: "POST", url: `/api/v1/membership/admin/${waitingId}/decision`, headers: { cookie, ...common }, payload: { decision: "approve" } });
  assert.equal(decision.statusCode, 200);
  const approved = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: waiting.username, password: waiting.password } });
  assert.equal(approved.statusCode, 200, "the account signs in after the admin's decision");

  // With the switch on the account may sign in at once and no admin reviews it.
  process.env.MEMBERSHIP_AUTO_APPROVE = "true";
  const onPolicy = await app.inject({ method: "GET", url: "/api/v1/membership/registration-policy" });
  assert.deepEqual(await onPolicy.json(), { autoApprove: true });
  const ready = { username: `ready-${suffix}`, realName: "直登乙", password: "long-test-password-123" };
  const auto = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: ready });
  assert.equal(auto.statusCode, 201);
  assert.deepEqual(await auto.json(), { status: "active" }, "the answer says the account may sign in");
  const readyRow = (await sql<{ status: string; approved_at: Date | null; approved_by: string | null }[]>`SELECT status, approved_at, approved_by FROM member_users WHERE username = ${ready.username}`)[0]!;
  assert.equal(readyRow.status, "active");
  assert.ok(readyRow.approved_at, "the account carries the time it became usable");
  assert.equal(readyRow.approved_by, null, "nobody reviewed the account");
  const readyLogin = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: ready.username, password: ready.password } });
  assert.equal(readyLogin.statusCode, 200, "the account signs in without an admin");
  const pendingAfter = (await (await app.inject({ method: "GET", url: "/api/v1/membership/admin/pending", headers: { cookie, ...common } })).json() as { users: Array<{ username: string }> }).users;
  assert.ok(!pendingAfter.some(user => user.username === ready.username), "the account never reaches the admin's list");
});
