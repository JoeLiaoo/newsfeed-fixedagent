import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { classifyChild, DEFAULT_PANORAMA_BUDGET, isFundLike, isInvestmentLike, rowPredatesSubject, type PanoramaProfile, type PanoramaRelation, type PanoramaSubject } from "../experts/panorama.ts";
import { runPanorama, type PanoramaRunResult } from "../experts/panorama-run.ts";
import { mapProfile, mapRelations, mapShareholders } from "../experts/panorama-fields.ts";
import { renderPanorama } from "../experts/panorama-markdown.ts";
import { executionMode } from "../experts/import.ts";
import { BUILTIN_EXPERT, PANORAMA_EXPERT, PANORAMA_EXPERT_SLUG, XINHUA_ALLOWED_TOOLS } from "../experts/catalog.ts";
import type { XinhuaCall } from "../experts/xinhua.ts";

type Relation = Partial<PanoramaRelation>;

function relation(over: Relation): PanoramaRelation {
  return {
    recordId: "r", companyId: null, name: "被投主体", pct: null, subscribed: null, subscribedUnit: null,
    subscribedDate: null, capitalDate: null, dataDate: null, investorName: null, investorType: null, deleted: false,
    ...over,
  };
}

function profile(over: Partial<PanoramaProfile> = {}): PanoramaProfile {
  return {
    companyId: null, creditCode: null, name: null, status: "存续", typeName: "企业", econKind: null,
    scope: null, startDate: "2010-01-01", registCapital: null, operatorName: null, originalName: null, ...over,
  };
}

const graph: PanoramaSubject[] = [{ key: "company:root", name: "本方主体", companyId: "root", aliases: [] }];

test("the control caliber decides a chain: control drills, first shareholder drills, minority stops", () => {
  const control = classifyChild({
    relation: relation({ name: "控股子公司", pct: "60.000000" }), profile: profile(), shareholders: null,
    related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(control.rule, "rule2_control");
  assert.equal(control.drill, true);

  const reference = classifyChild({
    relation: relation({ name: "第一大股东参股公司", pct: "36.477100" }), profile: profile(),
    shareholders: [{ companyId: null, name: "本方主体", pct: "36.477100", type: "企业股东", subscribed: null, subscribedUnit: null, subscribedDate: null },
      { companyId: null, name: "其他投资人", pct: "13.522900", type: "自然人股东", subscribed: null, subscribedUnit: null, subscribedDate: null }],
    related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(reference.rule, "rule2_reference_control");
  assert.equal(reference.drill, true);

  const minority = classifyChild({
    relation: relation({ name: "小额参股公司", pct: "5.000000" }), profile: profile(),
    shareholders: [{ companyId: null, name: "本方主体", pct: "5.000000", type: "企业股东", subscribed: null, subscribedUnit: null, subscribedDate: null },
      { companyId: null, name: "其他投资人", pct: "90.000000", type: "企业股东", subscribed: null, subscribedUnit: null, subscribedDate: null }],
    related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(minority.rule, "rule1_minority");
  assert.equal(minority.drill, false);
});

test("the stop conditions stop the chain and say what could not be confirmed", () => {
  const listed = classifyChild({
    relation: relation({ name: "某上市股份公司", pct: "10.000000" }),
    profile: profile({ econKind: "股份有限公司(上市、自然人投资或控股)" }), shareholders: null,
    related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(listed.rule, "rule5_listed");
  assert.equal(listed.drill, false);
  assert.ok(listed.gaps.some(gap => gap.includes("证券代码")), "上市身份只能按弱信号处理并标注待核");

  const companyFund = classifyChild({
    relation: relation({ name: "某产业投资基金有限公司", pct: "100.000000" }), profile: profile({ scope: "股权投资;基金管理" }),
    shareholders: null, related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(companyFund.rule, "rule6_company_fund");
  assert.equal(companyFund.drill, false);
  assert.ok(companyFund.gaps.some(gap => gap.includes("备案")));

  const filedFund = classifyChild({
    relation: relation({ name: "某创业投资基金（有限合伙）", pct: "30.000000" }), profile: profile({ typeName: "合伙企业" }),
    shareholders: null, related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(filedFund.rule, "rule3_fund");
  assert.equal(filedFund.drill, false);
});

test("an unregistered share chain is walked to a company, and an investment subject is an exception", () => {
  const unregistered = classifyChild({
    relation: relation({ name: "某持股平台合伙企业（有限合伙）", pct: "100.000000" }), profile: profile({ typeName: "合伙企业" }),
    shareholders: null, related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(unregistered.rule, "rule3_unregistered");
  assert.equal(unregistered.drill, true);
  assert.ok(unregistered.gaps.some(gap => gap.includes("备案")), "备案状态未确认必须留在缺口里");

  const exitCompany = classifyChild({
    relation: relation({ name: "某实业公司", pct: "100.000000" }), profile: profile(), shareholders: null,
    related: graph, inPartnershipBranch: true, budgetLeft: true,
  });
  assert.equal(exitCompany.rule, "rule3_exit_company");
  assert.equal(exitCompany.drill, false);

  const exception = classifyChild({
    relation: relation({ name: "某产业投资有限公司", pct: "10.000000" }), profile: profile({ scope: "实业投资;股权投资" }),
    shareholders: [{ companyId: null, name: "本方主体", pct: "10.000000", type: "企业股东", subscribed: null, subscribedUnit: null, subscribedDate: null },
      { companyId: null, name: "其他投资人", pct: "80.000000", type: "企业股东", subscribed: null, subscribedUnit: null, subscribedDate: null }],
    related: graph, inPartnershipBranch: false, budgetLeft: true,
  });
  assert.equal(exception.rule, "rule2_exception2");
  assert.equal(exception.drill, true);
  assert.ok(isInvestmentLike("某产业投资有限公司", null) && isFundLike("某产业投资基金有限公司", null));
});

test("a chain stops at the run's limits and says which limit it reached", () => {
  const stopped = classifyChild({
    relation: relation({ name: "某控股子公司", pct: "60.000000" }), profile: profile(), shareholders: null,
    related: graph, inPartnershipBranch: false, budgetLeft: false,
  });
  assert.equal(stopped.drill, true, "a limited chain keeps its control decision");
  const beyond = classifyChild({
    relation: relation({ name: "某持股平台合伙企业（有限合伙）", pct: "100.000000" }), profile: profile({ typeName: "合伙企业" }),
    shareholders: null, related: graph, inPartnershipBranch: false, budgetLeft: false,
  });
  assert.equal(beyond.rule, "budget");
  assert.equal(beyond.drill, false);
});

test("a row of another shareholder or a row dated before the subject existed is not its investment", () => {
  assert.equal(rowPredatesSubject(relation({ subscribedDate: "2005-01-01" }), "2010-01-01"), true);
  assert.equal(rowPredatesSubject(relation({ subscribedDate: "2015-01-01" }), "2010-01-01"), false);
  assert.equal(rowPredatesSubject(relation({ subscribedDate: null }), "2010-01-01"), false);
});

type Fixture = {
  profiles: Record<string, unknown>;
  investments: Record<string, unknown[]>;
  shareholders?: Record<string, unknown[]>;
  annualBase?: Record<string, unknown>;
  annualInvestment?: Record<string, unknown[]>;
};

function provider(fixture: Fixture) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const call = async (tool: string, args: Record<string, unknown>) => {
    calls.push({ tool, args });
    const query = String(args.query ?? "");
    if (tool === "get_company_profile") return fixture.profiles[query] ?? { not_found: true };
    if (tool === "get_direct_investment") {
      const rows = fixture.investments[query] ?? [];
      return { direct_investment_info: rows, pagination: { count: rows.length, has_more: false, next_offset: null } };
    }
    if (tool === "get_company_shareholder") {
      const rows = fixture.shareholders?.[query] ?? [];
      return { shareholder_info: rows, pagination: { count: rows.length } };
    }
    if (tool === "get_company_can_rev") return { company_can_rev_info: [] };
    if (tool === "get_history_company_name") return { history_company_name_info: [] };
    if (tool === "get_company_annual_report_base_info") return { company_annual_report_base_info: fixture.annualBase?.[query] ?? [] };
    if (tool === "get_company_annual_report_investment_info") return { company_annual_report_investment_info: fixture.annualInvestment?.[query] ?? [] };
    throw new Error(`unexpected tool ${tool}`);
  };
  return { call: call as unknown as XinhuaCall, calls };
}

function panoramaFixture(): Fixture {
  return {
    profiles: {
      "本方主体": { company_id: "root", company_name: "本方主体", credit_code: "91330000MA000ROOT", company_status_name: "存续", start_date: "2001-01-01", scope: "产业投资;企业管理" },
      "91330000MA000ROOT": { company_id: "root", company_name: "本方主体", credit_code: "91330000MA000ROOT", company_status_name: "存续", start_date: "2001-01-01", scope: "产业投资;企业管理" },
      "控股子公司": { company_id: "child-a", company_name: "控股子公司", credit_code: "91330000MA000A", company_status_name: "存续", start_date: "2008-01-01", scope: "实业投资;股权投资" },
      "91330000MA000A": { company_id: "child-a", company_name: "控股子公司", credit_code: "91330000MA000A", company_status_name: "存续", start_date: "2008-01-01", scope: "实业投资;股权投资" },
      "第一大股东参股公司": { company_id: "child-b", company_name: "第一大股东参股公司", credit_code: "91330000MA000B", company_status_name: "存续", start_date: "2012-01-01" },
      "91330000MA000B": { company_id: "child-b", company_name: "第一大股东参股公司", credit_code: "91330000MA000B", company_status_name: "存续", start_date: "2012-01-01" },
      "小额参股公司": { company_id: "child-c", company_name: "小额参股公司", credit_code: "91330000MA000C", company_status_name: "存续", start_date: "2013-01-01" },
      "91330000MA000C": { company_id: "child-c", company_name: "小额参股公司", credit_code: "91330000MA000C", company_status_name: "存续", start_date: "2013-01-01" },
      "某产业投资基金有限公司": { company_id: "child-fund", company_name: "某产业投资基金有限公司", credit_code: "91330000MA000D", company_status_name: "存续", start_date: "2016-01-01", scope: "股权投资;基金管理" },
      "91330000MA000D": { company_id: "child-fund", company_name: "某产业投资基金有限公司", credit_code: "91330000MA000D", company_status_name: "存续", start_date: "2016-01-01", scope: "股权投资;基金管理" },
      "某持股平台合伙企业（有限合伙）": { company_id: "child-lp", company_name: "某持股平台合伙企业（有限合伙）", credit_code: "91330000MA000E", company_status_name: "存续", start_date: "2017-01-01", type_name: "合伙企业" },
      "91330000MA000E": { company_id: "child-lp", company_name: "某持股平台合伙企业（有限合伙）", credit_code: "91330000MA000E", company_status_name: "存续", start_date: "2017-01-01", type_name: "合伙企业" },
      "某实业公司": { company_id: "child-f", company_name: "某实业公司", credit_code: "91330000MA000F", company_status_name: "存续", start_date: "2018-01-01" },
      "91330000MA000F": { company_id: "child-f", company_name: "某实业公司", credit_code: "91330000MA000F", company_status_name: "存续", start_date: "2018-01-01" },
      "某空壳平台": { company_id: "child-g", company_name: "某空壳平台", credit_code: "91330000MA000G", company_status_name: "存续", start_date: "2019-01-01" },
      "91330000MA000G": { company_id: "child-g", company_name: "某空壳平台", credit_code: "91330000MA000G", company_status_name: "存续", start_date: "2019-01-01" },
    },
    investments: {
      "91330000MA000ROOT": [
        { record_id: "r1", company_id: "child-a", company_name: "控股子公司", stock_percent: "60.000000", should_capi: "100000.000000", should_capi_unit: "万人民币元", shoud_date: "2015-03-31", stock_name: "本方主体", dates: "20260413" },
        { record_id: "r2", company_id: "child-c", company_name: "小额参股公司", stock_percent: "5.000000", shoud_date: "2016-05-06", stock_name: "本方主体", dates: "20260413" },
        { record_id: "r3", company_id: "child-fund", company_name: "某产业投资基金有限公司", stock_percent: "100.000000", shoud_date: "2017-05-06", stock_name: "本方主体", dates: "20260413" },
        { record_id: "r4", company_id: "child-lp", company_name: "某持股平台合伙企业（有限合伙）", stock_percent: "100.000000", shoud_date: "2018-05-06", stock_name: "本方主体", dates: "20260413" },
      ],
      "91330000MA000A": [
        { record_id: "r5", company_id: "child-b", company_name: "第一大股东参股公司", stock_percent: "36.477100", shoud_date: "2019-05-06", stock_name: "控股子公司", dates: "20260413" },
        { record_id: "r8", company_id: "child-g", company_name: "某空壳平台", stock_percent: "100.000000", shoud_date: "2019-05-06", stock_name: "控股子公司", dates: "20260413" },
      ],
      "91330000MA000B": [
        { record_id: "r6", company_id: "child-f", company_name: "某实业公司", stock_percent: "100.000000", shoud_date: "2020-05-06", stock_name: "第一大股东参股公司", dates: "20260413" },
      ],
      "91330000MA000E": [
        { record_id: "r7", company_id: "child-f", company_name: "某实业公司", stock_percent: "100.000000", shoud_date: "2020-05-06", stock_name: "某持股平台合伙企业（有限合伙）", dates: "20260413" },
      ],
    },
    shareholders: {
      "91330000MA000B": [
        { stock_name: "控股子公司", stock_percent: "36.477100", stock_type: "企业股东" },
        { stock_name: "其他投资人", stock_percent: "13.522900", stock_type: "自然人股东" },
      ],
      "91330000MA000C": [
        { stock_name: "本方主体", stock_percent: "5.000000", stock_type: "企业股东" },
        { stock_name: "其他投资人", stock_percent: "90.000000", stock_type: "企业股东" },
      ],
      "91330000MA000E": [
        { stock_name: "本方主体", stock_percent: "100.000000", stock_type: "企业股东", should_capi: "30000.000000", should_capi_unit: "万人民币元" },
      ],
    },
    annualBase: {
      "91330000MA000F": [{ report_year: "2024", publish_date: "2025-06-06", company_status_name: "开业", is_invested: 0 }],
      "91330000MA000G": [{ report_year: "2024", publish_date: "2025-06-06", company_status_name: "开业", is_invested: 0 }],
    },
    annualInvestment: {
      "91330000MA000F": [{ report_year: "2022", publish_date: "2023-06-06", investee_company_name: "历史被投企业" }],
      "91330000MA000G": [{ report_year: "2022", publish_date: "2023-06-06", investee_company_name: "历史被投企业" }],
    },
  };
}

async function runFixture(budget = DEFAULT_PANORAMA_BUDGET) {
  const fixture = panoramaFixture();
  const providerStub = provider(fixture);
  const run = await runPanorama({
    call: providerStub.call,
    root: { key: "company:root", name: "本方主体", companyId: "root", aliases: [] },
    budget,
  });
  return { run, calls: providerStub.calls };
}

test("the panorama walks more than one layer with the tools the platform is allowed to call", async () => {
  const { run, calls } = await runFixture();
  const tools = new Set(calls.map(call => call.tool));
  assert.ok(tools.has("get_direct_investment"), "对外直接投资是下钻主链");
  assert.ok(tools.has("get_company_shareholder"), "股东名单用于判断控股与第一大股东");
  assert.ok(tools.has("get_company_annual_report_base_info"), "年报用于交叉核验在投为空的主体");
  assert.ok(calls.every(call => (XINHUA_ALLOWED_TOOLS as readonly string[]).includes(call.tool)), "不得调用允许清单之外的工具");
  const investmentCalls = calls.filter(call => call.tool === "get_direct_investment");
  assert.ok(investmentCalls.length >= 3, "多层穿透需要对多个主体读取对外直接投资");
  assert.equal(run.stats.depth, 3, "底稿应覆盖三层下钻");
  const names = run.nodes.map(node => node.name);
  for (const name of ["控股子公司", "第一大股东参股公司", "小额参股公司", "某产业投资基金有限公司", "某持股平台合伙企业（有限合伙）", "某实业公司"]) {
    assert.ok(names.includes(name), `底稿应包含 ${name}`);
  }
});

test("the stop conditions decide the chain in the draft and the gaps stay visible", async () => {
  const { run } = await runFixture();
  const edgeBetween = (parent: string, child: string) => {
    const parentNode = run.nodes.find(node => node.name === parent);
    const edge = run.edges.find(entry => entry.parentKey === parentNode?.key && (run.nodes.find(node => node.key === entry.childKey)?.name ?? entry.relation.name) === child);
    return edge;
  };
  assert.equal(edgeBetween("本方主体", "小额参股公司")?.verdict.rule, "rule1_minority");
  assert.equal(edgeBetween("本方主体", "某产业投资基金有限公司")?.verdict.rule, "rule6_company_fund");
  assert.equal(edgeBetween("本方主体", "某持股平台合伙企业（有限合伙）")?.verdict.rule, "rule3_unregistered");
  assert.equal(edgeBetween("控股子公司", "第一大股东参股公司")?.verdict.rule, "rule2_reference_control");
  // The same subject can stop on one chain and continue on another: the rule belongs to the relation.
  assert.equal(edgeBetween("某持股平台合伙企业（有限合伙）", "某实业公司")?.verdict.rule, "rule3_exit_company");
  assert.equal(edgeBetween("第一大股东参股公司", "某实业公司")?.verdict.rule, "rule2_control");

  const { markdown } = renderPanorama({
    run, root: { name: "本方主体", id: "root" }, queriedAt: "2026-10-24T00:00:00.000Z",
    toolLabels: ["企业基础画像", "对外直接投资"], narrative: { summary: "本次按确认主体逐层核查。[S1]", openQuestions: ["复核合并口径。"] },
  });
  assert.ok(markdown.includes("规则1·参股尽头"), "底稿要写明停止规则");
  assert.ok(markdown.includes("规则6·公司制基金即止"));
  assert.ok(markdown.includes("基金备案状态"), "备案能力缺口必须出现在底稿");
  assert.ok(markdown.includes("退出性质"), "退出能力缺口必须出现在底稿");
  assert.ok(markdown.includes("关联方关系证据没有对等工具"), "关联方合并口径的缺口必须出现在底稿");
  assert.ok(markdown.includes("[S1]"), "摘要引用证据编号");
  assert.ok(!markdown.includes("未提供的引用编号 S1"), "存在的证据编号不能被改写");
  assert.ok(markdown.includes("## 七、缺口与待核清单"));
  assert.ok(markdown.includes("## 八、采集台账（断点续跑）"));
});

test("a summary that cites an evidence number the draft does not have is marked as missing", async () => {
  const { run } = await runFixture();
  const { markdown } = renderPanorama({
    run, root: { name: "本方主体", id: "root" }, queriedAt: "2026-10-24T00:00:00.000Z", toolLabels: [],
    narrative: { summary: "引用 [S99]。", openQuestions: [] },
  });
  assert.ok(markdown.includes("[未提供的引用编号 S99]"));
});

test("the run stops at its limits and says the result is incomplete", async () => {
  const { run, calls } = await runFixture({ maxDepth: 4, maxNodes: 25, maxCalls: 3, maxChildrenPerNode: 20 });
  assert.ok(run.stats.limits.includes("调用次数上限"), "触及调用上限要记录");
  assert.ok(calls.length <= 3, "不得越过调用上限");
  const { markdown } = renderPanorama({
    run, root: { name: "本方主体", id: "root" }, queriedAt: "2026-10-24T00:00:00.000Z", toolLabels: [],
  });
  assert.ok(markdown.includes("结果不完整"), "触及上限的底稿要标注为不完整");
  assert.ok(markdown.includes("触及上限"), "底稿要写明触及了哪个上限");
});

test("using exactly the per-subject relationship budget is complete", async () => {
  const { run } = await runFixture({ ...DEFAULT_PANORAMA_BUDGET, maxChildrenPerNode: 4 });
  assert.ok(!run.stats.limits.includes("单节点处理上限"), "刚好处理完预算数量不应误报截断");
  assert.equal(run.stats.untreated, 0);
});

test("provider failures become generic gaps and make the report incomplete", async () => {
  const fixture = panoramaFixture();
  const providerStub = provider(fixture);
  const run = await runPanorama({
    call: async (tool, args) => {
      if (tool === "get_direct_investment" && args.query === "91330000MA000ROOT") throw new Error("private provider detail");
      return providerStub.call(tool, args);
    },
    root: { key: "company:root", name: "本方主体", companyId: "root", aliases: [] },
  });
  assert.equal(run.stats.incomplete, true);
  assert.ok(run.gaps.some(gap => gap.text.includes("未覆盖")));
  assert.ok(!JSON.stringify(run.nodes).includes("private provider detail"));
  const { markdown } = renderPanorama({ run, root: { name: "本方主体", id: "root" }, queriedAt: "2026-10-24T00:00:00.000Z", toolLabels: [] });
  assert.ok(markdown.includes("完整性：结果不完整"));
});

test("a node the provider cannot answer is a gap, not a missing row and not a failure", async () => {
  const fixture = panoramaFixture();
  fixture.profiles["控股子公司"] = { not_found: true };
  fixture.profiles["91330000MA000A"] = { not_found: true };
  const providerStub = provider(fixture);
  const run = await runPanorama({
    call: providerStub.call,
    root: { key: "company:root", name: "本方主体", companyId: "root", aliases: [] },
    budget: DEFAULT_PANORAMA_BUDGET,
  });
  const child = run.nodes.find(node => node.name === "控股子公司");
  assert.ok(child, "读不到画像的主体仍要出现在底稿里");
  assert.ok(child!.gaps.some(gap => gap.includes("画像未取到")), "读不到画像要写成缺口");
  const { markdown } = renderPanorama({
    run, root: { name: "本方主体", id: "root" }, queriedAt: "2026-10-24T00:00:00.000Z", toolLabels: [],
  });
  assert.ok(markdown.includes("画像未取到"));
});

test("the provider's own fields are read as they are, without a unit or date conversion", () => {
  const rows = mapRelations([{ record_id: "r1", company_name: "被投企业", stock_percent: 12.5, should_capi: 3000, should_capi_unit: "万人民币元", shoud_date: "2015-03-31", dates: "20260413", is_del: 0 }]);
  assert.equal(rows[0]?.pct, "12.5");
  assert.equal(rows[0]?.subscribed, "3000");
  assert.equal(rows[0]?.subscribedUnit, "万人民币元");
  assert.equal(rows[0]?.subscribedDate, "2015-03-31");
  assert.equal(rows[0]?.dataDate, "20260413");
  assert.equal(rows[0]?.deleted, false);
  const picture = mapProfile({ company_id: "c1", company_name: "被投企业", company_status_name: "存续", scope: "股权投资", regist_capi: "1000.000000" });
  assert.equal(picture.status, "存续");
  assert.equal(picture.scope, "股权投资");
  assert.equal(picture.registCapital, "1000.000000");
  assert.deepEqual(mapShareholders({ shareholder_info: [{ stock_name: "某股东", stock_percent: "30" }] })[0], {
    companyId: null, name: "某股东", pct: "30", type: null, subscribed: null, subscribedUnit: null, subscribedDate: null,
  });
});

test("a skill that declares every platform capability runs the multi-layer runner", () => {
  assert.equal(executionMode({ tools: [...XINHUA_ALLOWED_TOOLS] }), "xinhua_panorama");
  assert.equal(executionMode({ tools: ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] }), "xinhua_trial");
  assert.equal(executionMode({ tools: [] }), "text_only");
});

test("a run that already read a subject resumes from the ledger instead of paying for it again", async () => {
  const fixture = panoramaFixture();
  const providerStub = provider(fixture);
  const ledger = new Map<string, unknown>();
  const checkpoint = {
    async get(nodeKey: string, kind: string) {
      const key = `${nodeKey}:${kind}`;
      if (!ledger.has(key)) return null;
      return { seq: ledger.size, nodeKey, depth: 0, kind, tool: "get_company_profile", payload: ledger.get(key) };
    },
    async put(line: { nodeKey: string; kind: string; payload: unknown }) {
      ledger.set(`${line.nodeKey}:${line.kind}`, line.payload);
    },
  };
  const first = await runPanorama({
    call: providerStub.call, root: { key: "company:root", name: "本方主体", companyId: "root", aliases: [] },
    budget: DEFAULT_PANORAMA_BUDGET, checkpoint,
  });
  const callsAfterFirst = providerStub.calls.length;
  const second = await runPanorama({
    call: providerStub.call, root: { key: "company:root", name: "本方主体", companyId: "root", aliases: [] },
    budget: { ...DEFAULT_PANORAMA_BUDGET, maxCalls: 1 }, checkpoint,
  });
  assert.equal(providerStub.calls.length, callsAfterFirst, "断点续跑不得重复调用已读的主体");
  assert.equal(second.nodes.length, first.nodes.length);
  assert.equal(second.stats.calls, 0, "从台账恢复的读取不消耗本轮供应商调用预算");
});

test("the employee-facing copy names capabilities, not data sources or models", () => {
  const files = [
    "../experts/catalog.ts", "../experts/panorama.ts", "../experts/panorama-run.ts", "../experts/panorama-markdown.ts",
    "../pages/experts.tsx", "../pages/expert-detail.tsx", "../pages/expert-new.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/悟道|新华财经|DeepSeek|wudao/i.test(source), `${file} 不得出现供应商品牌名`);
  }
  assert.ok(PANORAMA_EXPERT.name.includes("对外投资全景图"));
  assert.ok(BUILTIN_EXPERT.name.includes("一层对外投资核查"));
  assert.ok(PANORAMA_EXPERT.description.length > 0 && !/悟道|新华财经|DeepSeek/i.test(PANORAMA_EXPERT.description));
  assert.ok(!/悟道|新华财经|DeepSeek|wudao/i.test(PANORAMA_EXPERT.skillMd), "内置专家的技能文本也要按能力表述");
  assert.equal(PANORAMA_EXPERT.slug, PANORAMA_EXPERT_SLUG);
});
