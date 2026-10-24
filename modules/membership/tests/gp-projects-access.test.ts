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
  const [member] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${username}`;

  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects" });
  assert.equal(unauthorized.statusCode, 401);
  for (const url of [
    "/api/v1/membership/gp-projects?matched=yes",
    "/api/v1/membership/gp-projects?limit=abc",
    "/api/v1/membership/gp-projects?offset=1.5",
    "/api/v1/membership/gp-projects?limit=1&limit=2",
  ]) {
    const invalid = await app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(invalid.statusCode, 400, url);
  }
  const empty = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual((await empty.json() as { investments: unknown[] }).investments, []);
  assert.equal(empty.headers["cache-control"], "private, no-store");
  const noInterests = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?matched=1", headers: { cookie } });
  assert.deepEqual((await noInterests.json() as { investments: unknown[]; interest_tags: string[] }).interest_tags, []);

  const [admin] = await sql<{ id: string }[]>`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${randomUUID()},${"gp-project-admin-" + suffix},'管理人员','test-hash','active','admin') RETURNING id`;
  const activeGp = randomUUID(), pausedGp = randomUUID(), activeCompany = randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${activeGp},${"有效GP-" + suffix},'gp-entity','gp','active','https://example.org/gp',${admin!.id}),
          (${pausedGp},${"暂停GP-" + suffix},'paused-entity','gp','paused','https://example.org/paused',${admin!.id}),
          (${activeCompany},${"非GP主体-" + suffix},'company-entity','company','active','https://example.org/company',${admin!.id})`;
  const approvedId = randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${approvedId},${activeGp},'approved','已核实企业',${sql.json({privateEvidence:"must not be returned"})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now()),
      (${randomUUID()},${activeGp},'observed','待复核企业',${sql.json({})},'observed',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'baseline','历史基线企业',${sql.json({})},'baseline',ARRAY[]::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'retracted','已撤回企业',${sql.json({})},'retracted',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${pausedGp},'paused','暂停 GP 企业',${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now()),
      (${randomUUID()},${activeGp},'unmatched','未匹配企业',${sql.json({})},'verified',ARRAY['风电']::text[],'2026-10-17'::date,'https://example.org/unmatched',${admin!.id},now()),
      (${randomUUID()},${activeGp},'strategic','战略配售企业',${sql.json({})},'verified',ARRAY['战略配售']::text[],'2026-10-18'::date,'https://example.org/strategic',${admin!.id},now()),
      (${randomUUID()},${activeGp},'custom','自定义标签企业',${sql.json({})},'verified',ARRAY['自定义储能']::text[],'2026-10-19'::date,'https://example.org/custom',${admin!.id},now()),
      (${randomUUID()},${activeGp},'substring','标签子串企业',${sql.json({})},'verified',ARRAY['用户侧储能系统']::text[],'2026-10-18'::date,'https://example.org/substring',${admin!.id},now()),
      (${randomUUID()},${activeGp},'unknown-date','未知日期企业',${sql.json({})},'verified',ARRAY['光伏']::text[],NULL,'https://example.org/unknown-date',${admin!.id},now()),
      (${randomUUID()},${activeCompany},'non-gp','非GP主体企业',${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-21'::date,'https://example.org/non-gp',${admin!.id},now())`;
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

  await sql`UPDATE member_users SET status='pending' WHERE id=${member!.id}`;
  const inactive = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  assert.equal(inactive.statusCode, 401);
  await sql`UPDATE member_users SET status='active' WHERE id=${member!.id}`;

  await sql`INSERT INTO member_interest_tags(user_id,tag) VALUES(${member!.id},'光伏'),(${member!.id},'战略配售'),(${member!.id},'自定义储能'),(${member!.id},'储能')`;
  const matched = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?matched=1&limit=1", headers: { cookie } });
  const matchedBody = await matched.json() as { investments: Array<Record<string, unknown>>; interest_tags: string[]; pagination: { nextOffset: number | null } };
  assert.deepEqual(matchedBody.interest_tags, ["光伏", "战略配售", "自定义储能", "储能"]);
  assert.equal(matchedBody.investments.length, 1);
  assert.equal(matchedBody.investments[0]?.id, approvedId);
  assert.equal(matchedBody.pagination.nextOffset, 1);
  const matchedNext = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?matched=1&limit=1&offset=1", headers: { cookie } });
  const nextBody = await matchedNext.json() as { investments: Array<Record<string, unknown>>; pagination: { nextOffset: number | null } };
  assert.equal(nextBody.investments.length, 1);
  assert.equal(nextBody.investments[0]?.investee_name, "自定义标签企业");
  assert.equal(nextBody.pagination.nextOffset, 2);
  const unknownDate = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?matched=1&limit=1&offset=2", headers: { cookie } });
  const unknownDateBody = await unknownDate.json() as { investments: Array<Record<string, unknown>>; pagination: { nextOffset: number | null } };
  assert.equal(unknownDateBody.investments[0]?.investee_name, "未知日期企业");
  assert.equal(unknownDateBody.investments[0]?.event_date, null);
  assert.equal(unknownDateBody.pagination.nextOffset, null);
  assert(nextBody.investments.every(row => !["raw_evidence", "approved_by", "approved_at"].some(field => field in row)));

  const full = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  const all = (await full.json() as { investments: Array<{ investee_name: string }> }).investments;
  assert.deepEqual(all.map(row => row.investee_name), ["非GP主体企业", "已核实企业", "自定义标签企业", "战略配售企业", "未匹配企业", "较早核实企业", "未知日期企业"]);
});
