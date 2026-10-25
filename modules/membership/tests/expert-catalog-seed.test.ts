import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { COMING_SOON_EXPERT_SLUG, SECTOR_PEER_EXPERT_SLUG } from "../experts/catalog.ts";

test("the catalog converges on the platform's own rows, in the release setup and on the page", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const account = { username: `catalog-seed-${suffix}`, realName: "目录甲", password: "long-test-password-123" };
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;
  const headers = { cookie, ...common };

  // What an earlier release left behind: the new card still carries the retired badge, and the retired
  // entry is still marked as coming soon. No request has asked the catalog for them yet.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${SECTOR_PEER_EXPERT_SLUG}, NULL, '赛道同业竞争看板', '旧状态', '0.1.0', '旧技能', ${sql.json({ tools: [] })}, 'coming_soon', ARRAY[]::text[])
    ON CONFLICT(slug) DO UPDATE SET status='coming_soon'`;
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${COMING_SOON_EXPERT_SLUG}, NULL, '企业舆情报告', '旧入口', '0.1.0', '旧技能', ${sql.json({ tools: [] })}, 'coming_soon', ARRAY[]::text[])
    ON CONFLICT(slug) DO UPDATE SET status='coming_soon'`;

  // The release setup runs scripts/seed.ts before the api starts, so the catalog is converged there and
  // not by the first employee who happens to open it.
  execFileSync(process.execPath, [fileURLToPath(new URL("../../../scripts/seed.ts", import.meta.url))], { stdio: "ignore" });
  const rows = await sql<{ slug: string; status: string }[]>`SELECT slug, status FROM member_experts WHERE slug IN (${SECTOR_PEER_EXPERT_SLUG}, ${COMING_SOON_EXPERT_SLUG}) ORDER BY slug`;
  const statusOf = new Map(rows.map((row) => [row.slug, row.status]));
  assert.equal(statusOf.get(SECTOR_PEER_EXPERT_SLUG), "available", "the sector-peer card is available by contract");
  assert.equal(statusOf.get(COMING_SOON_EXPERT_SLUG), "hidden", "the retired entry keeps its row and leaves the catalog");

  // The catalog an employee reads lists the new card and drops the retired one.
  const catalog = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers })).json() as { experts: Array<{ slug: string; status: string }> }).experts;
  assert.ok(catalog.some(expert => expert.slug === SECTOR_PEER_EXPERT_SLUG && expert.status === "available"));
  assert.ok(!catalog.some(expert => expert.slug === COMING_SOON_EXPERT_SLUG));

  // The new card starts a task: a row left at the retired badge would be refused as coming soon.
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { ...headers, "idempotency-key": randomUUID() }, payload: { slug: SECTOR_PEER_EXPERT_SLUG, query: "商业航天" } });
  assert.equal(created.statusCode, 202);
});
