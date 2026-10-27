import assert from "node:assert/strict";
import {test} from "node:test";
import {latencyEvent} from "../conversation/latency.ts";

test("latency logs are opt-in and restricted to measurement fields",()=>{
  const old=process.env.P3_ILINK_LATENCY_METRICS_ENABLED;
  const original=console.info;
  const lines:string[]=[];
  console.info=(line:string)=>{lines.push(line);};
  try{
    delete process.env.P3_ILINK_LATENCY_METRICS_ENABLED;
    latencyEvent({correlationId:"internal-id",stage:"model",route:"agent",status:"processed",durationMs:12.8,
      apiCalls:2,totalTokens:42,...{body:"private message",accountId:"private account",cursor:"private cursor"}});
    assert.equal(lines.length,0);
    process.env.P3_ILINK_LATENCY_METRICS_ENABLED="true";
    latencyEvent({correlationId:"internal-id",stage:"model",route:"agent",status:"processed",durationMs:12.8,
      apiCalls:2,totalTokens:42,...{body:"private message",accountId:"private account",cursor:"private cursor"}});
    assert.deepEqual(JSON.parse(lines[0]!),{event:"ilink_latency",correlationId:"internal-id",stage:"model",
      route:"agent",status:"processed",durationMs:13,apiCalls:2,totalTokens:42});
  }finally{
    console.info=original;
    if(old===undefined)delete process.env.P3_ILINK_LATENCY_METRICS_ENABLED;
    else process.env.P3_ILINK_LATENCY_METRICS_ENABLED=old;
  }
});
