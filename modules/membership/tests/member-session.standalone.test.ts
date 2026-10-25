import assert from "node:assert/strict";
import { test } from "node:test";
import { memberSession } from "../server.ts";

test("a malformed member session cookie is treated as unauthenticated", async () => {
  const request = { headers: { cookie: "citic_member_session=%" } } as never;
  assert.equal(await memberSession(request), null);
});
