import assert from "node:assert/strict";
import { test } from "node:test";
import { requestCookie, withRequestCookie } from "../apps/web/app/lib/request-context.server.ts";

test("request cookie context survives asynchronous SSR work and stays request scoped",async()=>{
  assert.equal(requestCookie(),"");
  const cookie=await withRequestCookie("citic_member_session=session-one",async()=>{
    await new Promise(resolve=>setTimeout(resolve,0));
    return requestCookie();
  });
  assert.equal(cookie,"citic_member_session=session-one");
  assert.equal(requestCookie(),"");
});
