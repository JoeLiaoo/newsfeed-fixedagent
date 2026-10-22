import assert from "node:assert/strict";
import { test } from "node:test";
import { collectProviderPages, investmentRowIdentity } from "../provider-pages.ts";

const rows=(start:number,count:number)=>Array.from({length:count},(_,index)=>({company_id:`company-${start+index}`}));
test("provider inventory pages require stable identity and internally consistent completion evidence",async()=>{
  const valid=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async(offset)=>offset===0?{rows:rows(0,100),total:120,hasMore:true}:{rows:rows(100,20),total:120,hasMore:false},
  });
  assert.equal(valid.complete,true);
  assert.equal(valid.rows.length,120);
  assert.equal(valid.fetched,120);

  const repeated=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async(offset)=>({rows:rows(0,100),total:200,hasMore:offset===0}),
  });
  assert.equal(repeated.complete,false);
  assert.equal(repeated.reason,"repeated_page");

  const partialOverlap=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async(offset)=>offset===0?{rows:rows(0,100),total:200,hasMore:true}:{rows:[...rows(50,50),...rows(100,50)],total:200,hasMore:false},
  });
  assert.equal(partialOverlap.complete,false);
  assert.equal(partialOverlap.reason,"count_mismatch");

  const changingTotal=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async(offset)=>offset===0?{rows:rows(0,100),total:150,hasMore:true}:{rows:rows(100,50),total:151,hasMore:false},
  });
  assert.equal(changingTotal.reason,"total_changed");

  const missingId=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async()=>({rows:[{company_name:"name only"}],total:1,hasMore:false}),
  });
  assert.equal(missingId.complete,false);
  assert.equal(missingId.reason,"missing_identity");

  const emptyHasMore=await collectProviderPages({
    pageSize:100,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async()=>({rows:[],total:10,hasMore:true}),
  });
  assert.equal(emptyHasMore.reason,"empty_before_end");

  const truncated=await collectProviderPages({
    pageSize:2,maxPages:1,identity:investmentRowIdentity,
    fetchPage:async()=>({rows:rows(0,2),total:4,hasMore:true}),
  });
  assert.equal(truncated.reason,"page_limit");
});
