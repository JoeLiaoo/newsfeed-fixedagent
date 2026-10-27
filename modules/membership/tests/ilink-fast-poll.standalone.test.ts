import assert from "node:assert/strict";
import {test} from "node:test";
import {fastPollEnabledFor,nextFastPollDelay,FAST_POLL_QUEUE} from "../notifications/inbox-queue.ts";

test("fast poll requires the flag and an explicit account allowlist",()=>{
  const prior=[process.env.P3_ILINK_FAST_POLL_ENABLED,process.env.P3_ILINK_FAST_POLL_USER_IDS];
  try{
    process.env.P3_ILINK_FAST_POLL_ENABLED="false";
    process.env.P3_ILINK_FAST_POLL_USER_IDS="a, b";
    assert.equal(fastPollEnabledFor("a"),false);
    process.env.P3_ILINK_FAST_POLL_ENABLED="true";
    assert.equal(fastPollEnabledFor("b"),true);
    assert.equal(fastPollEnabledFor("c"),false);
    assert.equal(FAST_POLL_QUEUE.worker.batchSize,1);
    assert.equal(FAST_POLL_QUEUE.worker.localConcurrency,20);
    assert.equal(FAST_POLL_QUEUE.worker.groupConcurrency,20);
  }finally{
    for(const [index,key] of ["P3_ILINK_FAST_POLL_ENABLED","P3_ILINK_FAST_POLL_USER_IDS"].entries()){
      if(prior[index]===undefined)delete process.env[key];else process.env[key]=prior[index];
    }
  }
});

test("empty and failed polls back off; a real long wait and inbound resume promptly",()=>{
  let empty=0;
  for(const expected of [1000,2000,4000,8000,16000,30000,30000]){
    const next=nextFastPollDelay({pollDurationMs:1,messages:[],hadInbound:false},undefined,empty,0);
    assert.equal(next.delayMs,expected);empty=next.emptyStreak;
  }
  assert.equal(nextFastPollDelay({pollDurationMs:39_000,messages:[],hadInbound:false},undefined,empty,0).delayMs,0);
  assert.equal(nextFastPollDelay({pollDurationMs:1,messages:[{}],hadInbound:true},undefined,empty,0).delayMs,0);
  let errors=0;
  for(const expected of [1000,2000,4000,8000,16000,30000,30000]){
    const next=nextFastPollDelay(undefined,new Error("network"),0,errors,()=>0);
    assert.equal(next.delayMs,expected);errors=next.errorStreak;
  }
  assert.equal(nextFastPollDelay(undefined,{ret:-14},0,errors).stop,true);
  assert.equal(nextFastPollDelay(undefined,{ret:-2,message:"session not ready"},0,errors).stop,false);
});
