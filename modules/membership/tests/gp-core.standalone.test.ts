import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeInvestment,uniqueInvestments,validSectorTags,matchInterests,offDay,splitMessageLines } from "../gp/core.ts";

test("data source update time is not treated as deal date",()=>{
  const row=normalizeInvestment({company_name:"Example",company_id:"abc",include_date:"2026-10-22"});
  assert.equal(row?.investmentDate,null);
  assert.equal(row?.updatedAt,"2026-10-22");
});
test("duplicate investees collapse, unidentifiable evidence fails completeness",()=>{
  const result=uniqueInvestments([{company_name:"甲",company_id:"1"},{company_name:"甲",company_id:"1"},{update_time:"today"}]);
  assert.equal(result.records.length,1);
  assert.equal(result.missing,1);
});
test("GP taxonomy does not match strategic-placement-only interests",()=>{
  assert.equal(matchInterests(["基础模型"],["基础模型"]),true);
  assert.equal(matchInterests(["基础模型"],["战略投资者与基石投资"]),false);
  assert.equal(validSectorTags(["战略投资者与基石投资"]),null);
  assert.deepEqual(validSectorTags(["基础模型","基础模型"]),["基础模型"]);
});
test("configured Chinese holiday and makeup workday override weekends",()=>{
  assert.equal(offDay("2026-10-24",[],[]),true);
  assert.equal(offDay("2026-10-24",[],["2026-10-24"]),false);
  assert.equal(offDay("2026-10-22",["2026-10-22"],[]),true);
});
test("long messages are split without dropping any part",()=>{
  const data="一".repeat(3100);
  assert.equal(splitMessageLines([data],1000).join(""),data);
});
