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

test("provider pagination follows explicit next offsets and uses record IDs before investee IDs",async()=>{
  assert.equal(investmentRowIdentity({record_id:"record-1",company_id:"investee-1"}),"record_id:record-1");
  const offsets:number[]=[];
  const result=await collectProviderPages({
    pageSize:50,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async(offset)=>{
      offsets.push(offset);
      return offset===0
        ? {rows:[{record_id:"record-1",company_id:"investee-1"}],total:null,hasMore:true,nextOffset:7}
        : {rows:[{record_id:"record-2",company_id:"investee-2"}],total:null,hasMore:false,nextOffset:null};
    },
  });
  assert.deepEqual(offsets,[0,7]);
  assert.equal(result.complete,true);

  const invalid=await collectProviderPages({
    pageSize:50,maxPages:10,identity:investmentRowIdentity,
    fetchPage:async()=>({rows:[{record_id:"record-1"}],total:null,hasMore:true,nextOffset:0}),
  });
  assert.equal(invalid.reason,"invalid_next_offset");
});
