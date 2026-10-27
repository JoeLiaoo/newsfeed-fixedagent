import assert from "node:assert/strict";
import {test} from "node:test";
import {parseUsage,withinBudget} from "../conversation/usage.ts";
import {readingIntent} from "../conversation/intent.ts";

test("WX-B counts paid auxiliary calls and unknown prices without inventing cost",()=>{
  const usage=parseUsage({cost_status:"unknown",estimated_cost_usd:0,api_calls:1,total_tokens:18,
    auxiliary:{by_task:{title_generation:{api_calls:1}}},
    total_including_auxiliary:{api_calls:2,total_tokens:36,estimated_cost_usd:0}});
  assert.deepEqual(usage,{apiCalls:2,totalTokens:36,model:null,provider:null,costStatus:"unknown",estimatedCostUsd:null});
  assert.equal(withinBudget(28,98,1998),true);
  assert.equal(withinBudget(29,98,1998),false);
  assert.equal(withinBudget(28,99,1998),false);
});

test("WX-A reading commands remain deterministic before agent free text",()=>{
  for(const text of ["深读 2","其他","全部","下一页","主题：储能"])
    assert.notEqual(readingIntent(text).kind,"unknown");
  assert.equal(readingIntent("这周储能市场有什么变化？").kind,"unknown");
});
