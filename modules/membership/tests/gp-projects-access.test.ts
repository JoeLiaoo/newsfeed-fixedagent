import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";

test("GP project list requires an active member and only exposes approved active GP investments", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const username = `gp-projects-${suffix}`;
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: { username, realName: "项目测试", password: "long-test-password-123" } });
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username, password: "long-test-password-123" } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;

  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects" });
  assert.equal(unauthorized.statusCode, 401);
  const empty = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual((await empty.json() as { investments: unknown[] }).investments, []);
  assert.equal(empty.headers["cache-control"], "private, no-store");

  const [admin] = await sql<{ id: string }[]>`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${randomUUID()},${"gp-project-admin-" + suffix},'管理人员','test-hash','active','admin') RETURNING id`;
  const activeGp = randomUUID(), pausedGp = randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${activeGp},${"有效GP-" + suffix},'gp-entity','gp','active','https://example.org/gp',${admin!.id}),
          (${pausedGp},${"暂停GP-" + suffix},'paused-entity','gp','paused','https://example.org/paused',${admin!.id})`;
  const approvedId = randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${approvedId},${activeGp},'approved','已核实企业',${sql.json({privateEvidence:"must not be returned"})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now()),
      (${randomUUID()},${activeGp},'observed','待复核企业',${sql.json({})},'observed',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'baseline','历史基线企业',${sql.json({})},'baseline',ARRAY[]::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'retracted','已撤回企业',${sql.json({})},'retracted',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${pausedGp},'paused','暂停 GP 企业',${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now())`;
  const secondApprovedId = randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${secondApprovedId},${activeGp},'approved-older','较早核实企业',${sql.json({})},'verified',ARRAY[]::text[],'2026-09-20'::date,'https://example.org/older',${admin!.id},now())`;

  const page = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?limit=1", headers: { cookie } });
  assert.equal(page.statusCode, 200);
  const body = await page.json() as { investments: Array<Record<string, unknown>>; pagination: { nextOffset: number | null } };
  assert.equal(body.investments.length, 1);
  assert.equal(body.investments[0]?.id, approvedId);
  assert.equal(body.investments[0]?.gp_name, `有效GP-${suffix}`);
  assert.equal(body.investments[0]?.investee_name, "已核实企业");
  assert.equal(body.investments[0]?.event_date, "2026-10-20");
  assert.deepEqual(body.investments[0]?.sector_tags, ["光伏"]);
  assert.equal(body.investments[0]?.status, "verified");
  assert.equal("raw_evidence" in body.investments[0]!, false);
  assert.equal("approved_by" in body.investments[0]!, false);
  assert.equal("approved_at" in body.investments[0]!, false);
  assert.equal(body.pagination.nextOffset, 1);

  const full = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  const all = (await full.json() as { investments: Array<{ investee_name: string }> }).investments;
  assert.deepEqual(all.map(row => row.investee_name), ["已核实企业", "较早核实企业"]);
});
