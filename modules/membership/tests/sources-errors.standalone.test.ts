// The stage a failed source check stopped in: every stage has its own code, so a site that cannot be
// reached is not reported as a bad address and a bad address is not reported as an outage.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpStatusError } from "@aihot/backend/lib/http-fetch";
import { FetchError } from "@aihot/backend/sources/types";
import { SourceCheckTimeout, sourceCheckFailure } from "../sources.ts";

test("a failed source check names the stage it stopped in", () => {
  assert.equal(sourceCheckFailure(new FetchError("not an RSS/Atom document")).code, "source_not_parseable");
  assert.equal(sourceCheckFailure(new FetchError("feed parse error: bad xml")).code, "source_not_parseable");
  assert.equal(sourceCheckFailure(new FetchError("sitemap XML could not be parsed")).code, "source_not_parseable");
  assert.equal(sourceCheckFailure(new FetchError("no items matched (html)")).code, "source_no_articles");
  assert.equal(sourceCheckFailure(new FetchError("sitemap contains no article URLs")).code, "source_no_articles");
  assert.equal(sourceCheckFailure(new FetchError("原文页全部读取失败（2 页）")).code, "source_article_pages_failed");
  assert.equal(sourceCheckFailure(new HttpStatusError(404, "HTTP 404")).code, "source_not_found");
  assert.equal(sourceCheckFailure(new HttpStatusError(403, "HTTP 403")).code, "source_forbidden");
  assert.equal(sourceCheckFailure(new HttpStatusError(429, "HTTP 429")).code, "source_rate_limited");
  assert.equal(sourceCheckFailure(new HttpStatusError(503, "HTTP 503")).code, "source_upstream_error");
  assert.equal(sourceCheckFailure(new Error("boom")).code, "source_validation_failed");
  assert.equal(sourceCheckFailure(new Error("boom")).status, 422);
});

test("an unreachable or timed-out address is not reported as an unreadable one", () => {
  const unknownHost = new TypeError("fetch failed");
  (unknownHost as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  assert.equal(sourceCheckFailure(unknownHost).code, "source_unreachable");
  const refused = new TypeError("fetch failed");
  (refused as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(sourceCheckFailure(refused).code, "source_unreachable");
  const reset = new TypeError("fetch failed");
  (reset as { cause?: unknown }).cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.equal(sourceCheckFailure(reset).code, "source_unreachable");
  assert.equal(sourceCheckFailure(new SourceCheckTimeout()).code, "source_timeout");
  assert.equal(sourceCheckFailure(new Error("source_check_timeout")).code, "source_timeout");
  assert.equal(sourceCheckFailure(Object.assign(new Error("aborted"), { name: "TimeoutError" })).code, "source_timeout");
  assert.equal(sourceCheckFailure(Object.assign(new Error("aborted"), { name: "AbortError" })).code, "source_timeout");
});
