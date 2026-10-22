import assert from "node:assert/strict";
import test from "node:test";
import { HIDDEN_POLL_MS,pollDue,scanStatusText,VISIBLE_POLL_MS } from "../pages/scan-state.ts";

test("a visible page polls the scan right away",()=>{
  assert.equal(pollDue(0,0,true),true);
  assert.equal(pollDue(1000,1000,true),true);
  assert(VISIBLE_POLL_MS<5000);
});

test("a hidden page keeps polling, only less often",()=>{
  assert.equal(pollDue(1000,1000+VISIBLE_POLL_MS,false),false);
  assert.equal(pollDue(1000,1000+HIDDEN_POLL_MS,false),true);
  assert(HIDDEN_POLL_MS>VISIBLE_POLL_MS);
});

test("the scan status shows one line per state",()=>{
  assert.equal(scanStatusText("scaned"),"微信已扫码，请在手机上确认。");
  assert.equal(scanStatusText("need_verifycode"),"微信要求额外安全验证。");
  assert.equal(scanStatusText("wait"),"请用个人微信扫码，确认后网页自动完成绑定。");
});
