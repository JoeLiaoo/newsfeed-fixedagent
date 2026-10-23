// The subject search: the provider's answer is read as it is, a name is tried in its shorter forms
// when the provider matches nothing, and the profile is read over the whole record.
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateSearchOutcome, mapCompanyCandidates, querySelectedCompanyProfile, relaxedCompanyKeywords, XINHUA_ALL_TIME } from "../experts/data.ts";

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
