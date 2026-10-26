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

  const favicon = await app.inject({ method: "GET", url: "/favicon.ico" });
  assert.equal(favicon.statusCode, 200);
  assert.match(String(favicon.headers["content-type"]), /image\/x-icon/);

  const unauthorized = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects" });
  assert.equal(unauthorized.statusCode, 401);
  for (const url of [
    "/api/v1/membership/gp-projects?matched=yes",
    "/api/v1/membership/gp-projects?limit=abc",
    "/api/v1/membership/gp-projects?offset=1.5",
    "/api/v1/membership/gp-projects?limit=1&limit=2",
    "/api/v1/membership/gp-projects?group=other",
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
  const activeGp = randomUUID(), pausedGp = randomUUID(), candidateManager = randomUUID();
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${activeGp},${"有效GP-" + suffix},'gp-entity','gp','active','https://example.org/gp',${admin!.id}),
          (${pausedGp},${"暂停GP-" + suffix},'paused-entity','gp','paused','https://example.org/paused',${admin!.id}),
          (${candidateManager},${"非GP主体-" + suffix},'manager-entity','manager','candidate','https://example.org/company',${admin!.id})`;
  const approvedId = randomUUID(), observedId = randomUUID(), pausedInvestmentId = randomUUID(), nonGpInvestmentId = randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${approvedId},${activeGp},'approved','已核实企业',${sql.json({privateEvidence:"must not be returned"})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now()),
      (${observedId},${activeGp},'observed','待复核企业',${sql.json({})},'observed',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'baseline','历史基线企业',${sql.json({})},'baseline',ARRAY[]::text[],NULL,NULL,NULL,NULL),
      (${randomUUID()},${activeGp},'retracted','已撤回企业',${sql.json({})},'retracted',ARRAY['光伏']::text[],NULL,NULL,NULL,NULL),
      (${pausedInvestmentId},${pausedGp},'paused','暂停 GP 企业',${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-20'::date,'https://example.org/evidence',${admin!.id},now()),
      (${randomUUID()},${activeGp},'unmatched','未匹配企业',${sql.json({})},'verified',ARRAY['风电']::text[],'2026-10-17'::date,'https://example.org/unmatched',${admin!.id},now()),
      (${randomUUID()},${activeGp},'strategic','战略配售企业',${sql.json({})},'verified',ARRAY['战略配售']::text[],'2026-10-18'::date,'https://example.org/strategic',${admin!.id},now()),
      (${randomUUID()},${activeGp},'custom','自定义标签企业',${sql.json({})},'verified',ARRAY['自定义储能']::text[],'2026-10-19'::date,'https://example.org/custom',${admin!.id},now()),
      (${randomUUID()},${activeGp},'substring','标签子串企业',${sql.json({})},'verified',ARRAY['用户侧储能系统']::text[],'2026-10-18'::date,'https://example.org/substring',${admin!.id},now()),
      (${randomUUID()},${activeGp},'unknown-date','未知日期企业',${sql.json({})},'verified',ARRAY['光伏']::text[],NULL,'https://example.org/unknown-date',${admin!.id},now()),
      (${nonGpInvestmentId},${candidateManager},'non-gp','非GP主体企业',${sql.json({})},'verified',ARRAY['光伏']::text[],'2026-10-21'::date,'https://example.org/non-gp',${admin!.id},now())`;
  const secondApprovedId = randomUUID();
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,sector_tags,approved_event_date,approved_source_url,approved_by,approved_at)
    VALUES(${secondApprovedId},${activeGp},'approved-older','较早核实企业',${sql.json({})},'verified',ARRAY[]::text[],'2026-09-20'::date,'https://example.org/older',${admin!.id},now())`;
  await sql`UPDATE member_gp_investments SET mother_fund_name='母基金甲',subfund_name='子基金甲',project_province='江苏省',province_source='xinhua_company_profile',province_checked_at=now() WHERE id=${approvedId}`;
  await sql`UPDATE member_gp_investments SET mother_fund_name='母基金乙',subfund_name='子基金乙',project_province='广东省' WHERE id=${secondApprovedId}`;

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
  assert.equal(body.investments[0]?.source_url, null, "demo evidence is not linked as a provenance source");
  assert.equal(body.investments[0]?.source_placeholder, true);
  assert.equal("raw_evidence" in body.investments[0]!, false);
  assert.equal("approved_by" in body.investments[0]!, false);
  assert.equal("approved_at" in body.investments[0]!, false);
  assert.equal(body.pagination.nextOffset, 1);
  const filters=await app.inject({method:"GET",url:"/api/v1/membership/gp-projects?motherFund=%E6%AF%8D%E5%9F%BA%E9%87%91%E7%94%B2&subfund=%E5%AD%90%E5%9F%BA%E9%87%91%E7%94%B2&sector=%E5%85%89%E4%BC%8F&province=%E6%B1%9F%E8%8B%8F%E7%9C%81",headers:{cookie}});
  assert.equal(filters.statusCode,200);
  const filtered=await filters.json() as {investments:Array<{id:string;mother_fund_name:string;subfund_name:string;project_province:string;province_verified:boolean}>;filter_options:{provinces:string[]}};
  assert.deepEqual(filtered.investments.map(row=>row.id),[approvedId]);
  assert.equal(filtered.investments[0]?.mother_fund_name,"母基金甲");
  assert.equal(filtered.investments[0]?.subfund_name,"子基金甲");
  assert.equal(filtered.investments[0]?.project_province,"江苏省");
  assert.equal(filtered.investments[0]?.province_verified,true);
  assert.ok(filtered.filter_options.provinces.includes("广东省"));
  const noMatch=await app.inject({method:"GET",url:"/api/v1/membership/gp-projects?motherFund=%E6%AF%8D%E5%9F%BA%E9%87%91%E7%94%B2&province=%E5%B9%BF%E4%B8%9C%E7%9C%81",headers:{cookie}});
  assert.deepEqual((await noMatch.json() as {investments:unknown[]}).investments,[]);
  const invalidFilter=await app.inject({method:"GET",url:"/api/v1/membership/gp-projects?province="+"x".repeat(121),headers:{cookie}});
  assert.equal(invalidFilter.statusCode,400);

  const detailPath = `/api/v1/membership/gp-projects/${approvedId}`;
  assert.equal((await app.inject({ method: "GET", url: `${detailPath}?group=other`, headers: { cookie } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: detailPath })).statusCode, 401);
  for (const hiddenId of [randomUUID(), observedId, pausedInvestmentId, nonGpInvestmentId]) {
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/gp-projects/${hiddenId}`, headers: { cookie } })).statusCode, 404);
  }
  const detail = await app.inject({ method: "GET", url: detailPath, headers: { cookie } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.headers["cache-control"], "private, no-store");
  const investment = (await detail.json() as { investment: Record<string, unknown> }).investment;
  assert.equal(investment.id, approvedId);
  assert.equal(investment.investee_name, "已核实企业");
  assert.equal(investment.source_url, null);
  assert.equal(investment.source_placeholder, true);
  assert.ok(!["raw_evidence", "approved_by", "approved_at", "gp_id", "project_groups", "project_group_basis"].some(field => field in investment));

  const allianceList = "/api/v1/membership/gp-projects?group=citic-alliance";
  const leadersList = "/api/v1/membership/gp-projects?group=market-leaders";
  const names = async (url: string) => ((await (await app.inject({ method: "GET", url, headers: { cookie } })).json()) as {investments:Array<{id:string}>}).investments.map(row => row.id);
  assert.deepEqual(await names(allianceList), [], "unclassified GPs never appear in a collection");
  assert.deepEqual(await names(leadersList), []);
  assert.equal((await app.inject({ method: "GET", url: `${detailPath}?group=citic-alliance`, headers: { cookie } })).statusCode, 404);
  await sql`UPDATE member_gp_watchlist SET project_groups=ARRAY['citic-alliance']::text[],project_group_basis='人工核实的分类依据' WHERE id=${activeGp}`;
  assert.ok((await names(allianceList)).includes(approvedId));
  assert.deepEqual(await names(leadersList), []);
  assert.equal((await app.inject({ method: "GET", url: `${detailPath}?group=citic-alliance`, headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `${detailPath}?group=market-leaders`, headers: { cookie } })).statusCode, 404);
  await sql`UPDATE member_gp_watchlist SET project_groups=ARRAY['market-leaders']::text[],project_group_basis='人工核实的分类依据' WHERE id=${pausedGp}`;
  assert.deepEqual(await names(leadersList), [], "paused GP investments stay hidden despite their category");
  await sql`UPDATE member_gp_watchlist SET project_groups=ARRAY['citic-alliance','market-leaders']::text[] WHERE id=${activeGp}`;
  assert.ok((await names(leadersList)).includes(approvedId));
  assert.ok(!(await names(leadersList)).includes(observedId));

  await sql`UPDATE member_users SET status='pending' WHERE id=${member!.id}`;
  const inactive = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects", headers: { cookie } });
  assert.equal(inactive.statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: detailPath, headers: { cookie } })).statusCode, 401);
  await sql`UPDATE member_users SET status='active' WHERE id=${member!.id}`;

  await sql`INSERT INTO member_interest_tags(user_id,tag) VALUES(${member!.id},'光伏'),(${member!.id},'战略配售'),(${member!.id},'自定义储能'),(${member!.id},'储能')`;
  const matched = await app.inject({ method: "GET", url: "/api/v1/membership/gp-projects?matched=1&limit=1", headers: { cookie } });
  const matchedBody = await matched.json() as { investments: Array<Record<string, unknown>>; interest_tags: string[]; pagination: { nextOffset: number | null } };
  assert.deepEqual([...matchedBody.interest_tags].sort(), ["光伏", "战略配售", "自定义储能", "储能"].sort());
  assert.ok((await names(`${leadersList}&matched=1`)).includes(approvedId));
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
  assert.deepEqual(all.map(row => row.investee_name).sort(), ["已核实企业", "自定义标签企业", "战略配售企业", "标签子串企业", "未匹配企业", "较早核实企业", "未知日期企业"].sort());
});
