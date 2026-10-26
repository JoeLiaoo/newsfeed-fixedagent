// A site may answer on its apex name with a bot wall and serve its feed on the `www` name: the
// employee's source is read on the name that serves the content, and stored with that name, so the
// collector keeps hitting the address that answered.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteHostAlias } from "@aihot/backend/lib/url";
import { memberSourceAddress } from "../sources.ts";

test("a source on a host with a known alias is read on the name that serves the content", () => {
  assert.equal(memberSourceAddress("https://36kr.com/feed")?.toString(), "https://www.36kr.com/feed");
  assert.equal(memberSourceAddress("https://36kr.com/feed?page=2")?.toString(), "https://www.36kr.com/feed?page=2");
  assert.equal(memberSourceAddress("http://36kr.com/feed")?.toString(), "http://www.36kr.com/feed");
  assert.equal(rewriteHostAlias(new URL("https://36kr.com/newsflashes")).toString(), "https://www.36kr.com/newsflashes");
});

test("an address without a known alias stays as it was given", () => {
  assert.equal(memberSourceAddress("https://example.org/feed")?.toString(), "https://example.org/feed");
  assert.equal(memberSourceAddress("https://www.36kr.com/feed")?.toString(), "https://www.36kr.com/feed");
  assert.equal(rewriteHostAlias(new URL("https://example.org/feed")).toString(), "https://example.org/feed");
});

test("an address that cannot be read is refused", () => {
  for (const address of ["", "   ", "not an address", "ftp://36kr.com/feed", "https://user:secret@36kr.com/feed"]) {
    assert.equal(memberSourceAddress(address), null, address);
  }
});
