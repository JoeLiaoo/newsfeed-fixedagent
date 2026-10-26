import assert from "node:assert/strict";
import {test} from "node:test";
import {ilinkKeepaliveThresholdHours,keepaliveNudgeEligible,keepaliveNudgeId} from "../notifications/inbox.ts";

const now=new Date("2026-10-26T12:00:00.000Z");
const stale=new Date(now.getTime()-20*60*60*1000);
const eligible={channelState:"active",hasContext:true,lastInboundAt:stale,nudgedAt:null,now};

test("iLink keepalive eligibility uses the configurable 20-hour default",()=>{
  assert.equal(ilinkKeepaliveThresholdHours(undefined),20);
  assert.equal(ilinkKeepaliveThresholdHours("18"),18);
  assert.equal(ilinkKeepaliveThresholdHours("24"),20);
  assert.equal(keepaliveNudgeEligible({...eligible,thresholdHours:20}),true);
  assert.equal(keepaliveNudgeEligible({...eligible,lastInboundAt:new Date(now.getTime()-19*60*60*1000),thresholdHours:20}),false);
});

test("a successful nudge deduplicates only its inbound window",()=>{
  assert.equal(keepaliveNudgeEligible({...eligible,nudgedAt:new Date(stale.getTime()+1)}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,lastInboundAt:new Date(stale.getTime()+1),nudgedAt:new Date(stale.getTime()+1),now:new Date(now.getTime()+1)}),true);
  assert.equal(keepaliveNudgeId("member-1",stale),keepaliveNudgeId("member-1",stale));
  assert.notEqual(keepaliveNudgeId("member-1",stale),keepaliveNudgeId("member-2",stale));
  assert.notEqual(keepaliveNudgeId("member-1",stale),keepaliveNudgeId("member-1",new Date(stale.getTime()+1)));
});

test("keepalive skips disabled delivery and inactive, expired, or contextless channels",()=>{
  assert.equal(keepaliveNudgeEligible({...eligible,deliveryEnabled:false}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,channelState:"needs_interaction"}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,channelState:"requires_rebind"}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,channelState:"paused"}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,hasContext:false}),false);
  assert.equal(keepaliveNudgeEligible({...eligible,lastInboundAt:null}),false);
});
