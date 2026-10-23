// The employee source check shares one budget. A check that runs out of time while its article pages
// are being read is not an article failure: the reason it stopped travels on, the reads stop, and the
// caller reports the timeout. A page the site refuses stays a warning the check reports. Without a
// database.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { enrichDetails, type CollectionCandidate } from "@aihot/backend/sources/collect";
import type { SourceRow } from "@aihot/backend/sources/types";
import { SourceCheckTimeout, sourceCheckTimeoutMs, throwIfCheckAborted } from "../sources.ts";

/** Every path the check read. */
const reads: string[] = [];
/** The pages whose read was cancelled instead of answered. */
const cancelled: string[] = [];
/** Called when a page that never answers is reached: the check's deadline stops that read. */
let onHangingPage: (() => void) | null = null;
/** Waits for the next cancelled page. */
const cancelWaiters: Array<() => void> = [];
const nextCancel = () => new Promise<void>(resolve => { cancelWaiters.push(resolve); });

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  reads.push(path);
  if (path.startsWith("/article/")) {
    if (path.endsWith("/refused")) { res.writeHead(403); res.end("refused"); return; }
    // A page that never answers: the read stays in flight until the check's deadline stops it.
    onHangingPage?.();
    req.on("close", () => {
      if (res.writableEnded) return;
      cancelled.push(path);
      for (const waiter of cancelWaiters.splice(0)) waiter();
    });
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(`<ul><li><a href="/article/hang">An article whose page never answers</a></li>
    <li><a href="/article/hang-two">Another article whose page never answers</a></li></ul>`);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const source: SourceRow = {
  id: "source-check-abort",
  name: "Source check abort",
  kind: "web_list",
  config: { url: `${base}/listing`, parseMode: "html", detail: { maxFetches: 3 } },
  tier: "T2",
  participation_mode: "editorial",
  first_party: false,
  interval_minutes: 30,
  enabled: true,
  cursor: null,
  fail_count: 0,
};

const candidates: CollectionCandidate[] = [
  { url: `${base}/article/hang`, title: "An article whose page never answers", identityKey: "url:hang" },
  { url: `${base}/article/hang-two`, title: "Another article whose page never answers", identityKey: "url:hang-two" },
];

test("a check that runs out of time while its article pages are read stops the reads and keeps its reason", async () => {
  reads.length = 0;
  cancelled.length = 0;
  const controller = new AbortController();
  const timeout = new SourceCheckTimeout();
  onHangingPage = () => controller.abort(timeout);
  const cancelledRead = nextCancel();
  await assert.rejects(
    enrichDetails(candidates, source, new Map(), { budget: 3, datedOut: {}, admits: () => true, signal: controller.signal }),
    (error) => error === timeout,
  );
  assert.equal(reads.filter(path => path.startsWith("/article/")).length, 1, "the reads stop at the page the deadline stopped");
  await Promise.race([cancelledRead, new Promise<void>(resolve => setTimeout(resolve, 2_000))]);
  assert.deepEqual(cancelled, ["/article/hang"], "the page read was cancelled");
  onHangingPage = null;
});

test("an article page the site refuses is a warning, not a failed check", async () => {
  reads.length = 0;
  const result = await enrichDetails(
    [{ url: `${base}/article/refused`, title: "An article whose page is refused", identityKey: "url:refused" }],
    source, new Map(), { budget: 3, datedOut: {}, admits: () => true },
  );
  assert.equal(result.attempts, 1);
  assert.equal(result.failures.length, 1, "the refused page is reported as a failure of that page");
  assert.match(result.failures[0]!.error, /403/);
  assert.equal(result.pending, 0, "a page the site refuses is not read again under the same rules");
});

test("the check's budget is forty seconds unless the environment asks for another, and a stopped check keeps its reason", () => {
  const before = process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS;
  try {
    delete process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS;
    assert.equal(sourceCheckTimeoutMs(), 40_000);
    process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS = "1500";
    assert.equal(sourceCheckTimeoutMs(), 1500);
    process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS = "not a number";
    assert.equal(sourceCheckTimeoutMs(), 40_000, "a budget that is not a number falls back to the default");
  } finally {
    if (before === undefined) delete process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS;
    else process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS = before;
  }
  const controller = new AbortController();
  assert.doesNotThrow(() => throwIfCheckAborted(controller.signal));
  const timeout = new SourceCheckTimeout();
  controller.abort(timeout);
  assert.throws(() => throwIfCheckAborted(controller.signal), (error) => error === timeout);
});
