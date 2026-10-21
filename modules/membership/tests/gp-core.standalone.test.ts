import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeInvestment,uniqueInvestments,validSectorTags,matchInterests,offDay,splitMessageLines,canReviewInvestment,dueNotificationKinds } from "../gp/core.ts";

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

test("historical baseline and retracted observations are never new approved investments",()=>{
  assert.equal(canReviewInvestment("baseline","verified"),false);
  assert.equal(canReviewInvestment("retracted","verified"),false);
  assert.equal(canReviewInvestment("observed","verified"),true);
  assert.equal(canReviewInvestment("verified","verified"),true); // edits keep the first approval timestamp
});
test("late daily cron runs still include already-due channels",()=>{
  assert.deepEqual(dueNotificationKinds(8,false),[]);
  assert.deepEqual(dueNotificationKinds(9,false),["news"]);
  assert.deepEqual(dueNotificationKinds(14,false),["news","gp"]);
  assert.deepEqual(dueNotificationKinds(11,true),["news"]);
  assert.deepEqual(dueNotificationKinds(16,true),["news","gp"]);
});
