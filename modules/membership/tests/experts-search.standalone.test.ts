// The subject search: the provider's answer is read as it is, a name is tried in its shorter forms
// when the provider matches nothing, and the profile is read over the whole record.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { candidateSearchOutcome, carriesQuery, companyRelationLabel, hasNotFoundMarker, isBranchType, mapCompanyCandidates, markBranchRelations, parentNameCandidates, parseInvestmentPage, querySelectedCompanyProfile, rankCompanyCandidates, relaxedCompanyKeywords, XINHUA_ALL_TIME } from "../experts/data.ts";
import { searchCompanyCandidates } from "../experts/worker.ts";

const expertDetailSource = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");

test("the candidate search reads the provider's list and knows an answer without one", () => {
  const live = candidateSearchOutcome({ result: { total: 2, results: [{ company_id: "a", company_name: "甲" }], pagination: { limit: 10, offset: 0, count: 2, has_more: false, next_offset: null } } });
  assert.equal(live.present, true);
  assert.equal(live.rows.length, 1);
  const empty = candidateSearchOutcome({ result: { total: 0, results: [] } });
  assert.equal(empty.present, true, "an empty list is the provider's answer, not a missing one");
  assert.equal(empty.rows.length, 0);
  assert.equal(candidateSearchOutcome({ result: { total: 0 } }).present, false);
  assert.equal(candidateSearchOutcome("not json").present, false);
  assert.equal(candidateSearchOutcome({ rows: [{ company_id: "b" }] }).present, false);
});

test("a candidate without a subject ID is not offered", () => {
  const candidates = mapCompanyCandidates([{ company_name: "甲" }, { company_id: "b", company_name: "乙" }], "兜底");
  assert.equal(candidates[0]?.id, "");
  assert.equal(candidates[0]?.name, "甲");
  assert.equal(candidates[1]?.id, "b");
});

test("a typed name is tried in its shorter forms when the provider matches nothing", () => {
  assert.deepEqual(relaxedCompanyKeywords("某基金管理有限公司"), ["某基金管理"]);
  assert.deepEqual(relaxedCompanyKeywords("某基金合伙企业（有限合伙）"), ["某基金合伙企业", "某基金"]);
  assert.deepEqual(relaxedCompanyKeywords("某基金管理有限责任公司"), ["某基金管理"]);
  assert.deepEqual(relaxedCompanyKeywords("短"), []);
  assert.deepEqual(relaxedCompanyKeywords("某基金管理"), []);
});

test("the profile is read over the whole record, not the tool's default three years", async () => {
  const requests: Array<Record<string, unknown>> = [];
  await querySelectedCompanyProfile(async (_tool, args) => {
    requests.push(args);
    return { company_id: "company-A", company_name: "同名企业" };
  }, { id: "company-A", name: "同名企业", status: null, creditCode: null, address: null, startDate: null });
  assert.deepEqual(requests[0]?.time, XINHUA_ALL_TIME);
  assert.equal((requests[0]?.time as { start: string }).start, "1900-01-01");
});

test("a listed company is found behind its branches, and the parent is offered first", async () => {
  const branch = "宁德时代新能源科技股份有限公司宁德时代创新实验室";
  const parent = "宁德时代新能源科技股份有限公司";
  const pages: Record<string, unknown[]> = {
    "宁德时代": [
      { company_id: "b1", company_name: branch, credit_code: "91350900MA33F5967F" },
      { company_id: "b2", company_name: `${parent}福建分公司` },
    ],
  };
  const requests: Array<{ keyword: string; offset: number }> = [];
  const call = async (tool: string, args: Record<string, unknown>) => {
    assert.equal(tool, "fuzzy_search_company_list");
    const keyword = String(args.keyword);
    requests.push({ keyword, offset: Number(args.offset) });
    if (keyword === "宁德时代") {
      // The first page holds only branches; the parent sits behind it.
      if (Number(args.offset) === 0) return { results: Array.from({ length: 10 }, (_, index) => ({ company_id: `p${index}`, company_name: `${parent}第${index}分公司` })) };
      return { results: [{ company_id: "parent", company_name: parent, credit_code: "91350900MA33F5967F" }] };
    }
    return { results: pages[keyword] ?? [] };
  };
  const found = await searchCompanyCandidates(call as never, "宁德时代");
  assert.equal(found.candidates[0]?.name, parent, "母公司排在分支机构之前");
  assert.equal(found.approximate, false, "找到了与查询词完全一致的主体");
  assert.ok(requests.some(request => request.offset === 10), "第一页装不下时继续翻页");
  assert.ok(requests.length <= 5, "候选检索的调用次数有上限");
});

test("a branch-only answer asks for the name the branch is built on", async () => {
  const branch = "宁德时代新能源科技股份有限公司宁德时代创新实验室";
  const parent = "宁德时代新能源科技股份有限公司";
  const asked: string[] = [];
  const call = async (_tool: string, args: Record<string, unknown>) => {
    const keyword = String(args.keyword);
    asked.push(keyword);
    if (keyword === "宁德时代") return { results: [{ company_id: "b1", company_name: branch, credit_code: "91350900MA33F5967F" }] };
    if (keyword === parent) return { results: [{ company_id: "parent", company_name: parent }] };
    return { results: [] };
  };
  const found = await searchCompanyCandidates(call as never, "宁德时代");
  assert.ok(asked.includes(parent), "分支的名字带着母公司的登记名，母公司的名字也要问一次");
  assert.equal(found.candidates[0]?.name, parent);
  assert.equal(found.approximate, false);
});

test("a search that finds nothing carrying the name says the candidates are near matches", async () => {
  const call = async (_tool: string, args: Record<string, unknown>) => ({
    results: [{ company_id: "b1", company_name: `无关公司${String(args.offset)}` }],
  });
  const found = await searchCompanyCandidates(call as never, "宁德时代");
  assert.equal(found.approximate, true, "没有名称包含查询词的主体时要说清楚");
  assert.ok(found.candidates.length > 0);
});

test("the registered name of a branch is read from its legal form", () => {
  assert.deepEqual(parentNameCandidates(["宁德时代新能源科技股份有限公司宁德时代创新实验室"]), ["宁德时代新能源科技股份有限公司"]);
  assert.deepEqual(parentNameCandidates(["某基金管理有限公司"]), [], "名称本身就是法律形式时没有更上层的登记名");
  assert.deepEqual(parentNameCandidates(["某基金管理有限公司北京分公司"]), ["某基金管理有限公司"]);
  assert.deepEqual(parentNameCandidates(["无法律形式的名称"]), []);
});

test("a candidate that carries the typed name is told apart from one that does not", () => {
  assert.equal(carriesQuery("宁德时代新能源科技股份有限公司", "宁德时代"), true);
  assert.equal(carriesQuery("宁德时代", "宁德时代"), true);
  assert.equal(carriesQuery("别家公司", "宁德时代"), false);
});

test("a branch is told from the parent it hangs on", () => {
  const candidates = markBranchRelations([
    { id: "p", name: "宁德时代新能源科技股份有限公司", status: null, creditCode: null, address: null, startDate: null, typeName: "股份有限公司", branchOf: null },
    { id: "b", name: "宁德时代新能源科技股份有限公司宁德时代创新实验室", status: null, creditCode: null, address: null, startDate: null, typeName: "分公司", branchOf: null },
    { id: "o", name: "其他公司", status: null, creditCode: null, address: null, startDate: null, typeName: null, branchOf: null },
  ]);
  assert.equal(candidates.find(candidate => candidate.id === "b")?.branchOf, "宁德时代新能源科技股份有限公司");
  assert.equal(candidates.find(candidate => candidate.id === "p")?.branchOf, null);
  assert.equal(isBranchType("分公司"), true);
  assert.equal(isBranchType("有限责任公司"), false);
  assert.equal(isBranchType(null), false);
});

test("宁德时代 parent candidate ranks ahead of a branch-heavy result and gets visible relations", async () => {
  const parentName = "宁德时代新能源科技股份有限公司";
  const parent = { company_id: "parent", company_name: parentName, credit_code: "91350900587527783P", company_type_name: "股份有限公司" };
  const branches = Array.from({ length: 12 }, (_, index) => ({ company_id: `branch-${index}`, company_name: `${parentName}${index + 1}号分公司`, company_type_name: "分公司" }));
  const call = async (_tool: string, args: Record<string, unknown>) => {
    const keyword = String(args.keyword);
    const offset = Number(args.offset);
    if (keyword === "宁德时代" && offset === 0) return { results: branches.slice(0, 10) };
    if (keyword === "宁德时代" && offset === 10) return { results: branches.slice(10) };
    if (keyword === parentName) return { results: [parent] };
    return { results: [] };
  };
  const found = await searchCompanyCandidates(call as never, "宁德时代");
  assert.equal(found.candidates[0]?.creditCode, "91350900587527783P", "母公司必须排在分支候选之前");
  assert.equal(found.candidates.length, 12, "候选数仍按页面上限截取");
  assert.equal(companyRelationLabel(found.candidates[0]!, found.candidates), "母公司候选");
  assert.equal(companyRelationLabel(found.candidates[1]!, found.candidates), "分支机构");
  assert.match(expertDetailSource, /companyRelationLabel\(candidate, task\.result\?\.candidates/, "候选选择器渲染关系标签");
});

test("ranking promotes an identified parent above branches when registry names include punctuation", () => {
  const related = markBranchRelations([
    { id: "p", name: "宁德时代新能源科技股份有限公司", status: null, creditCode: "91350900587527783P", address: null, startDate: null, typeName: "股份有限公司", branchOf: null },
    { id: "b", name: " 宁德时代新能源科技股份有限公司 · 福州分公司 ", status: null, creditCode: null, address: null, startDate: null, typeName: "分公司", branchOf: null },
  ]);
  const ranked = rankCompanyCandidates(related, "宁德时代");
  assert.equal(ranked[0]?.id, "p");
  assert.equal(ranked[1]?.branchOf, "宁德时代新能源科技股份有限公司");
});

test("the provider's 'no such record' answer is read as an answer, not as a missing list", () => {
  assert.equal(hasNotFoundMarker({ not_found: true }), true);
  assert.equal(hasNotFoundMarker({ result: { not_found: true } }), true);
  assert.equal(hasNotFoundMarker({ direct_investment_info: [] }), false);
  assert.equal(parseInvestmentPage({ not_found: true }).notFound, true);
  assert.equal(parseInvestmentPage({ direct_investment_info: [] }).notFound, false);
});
