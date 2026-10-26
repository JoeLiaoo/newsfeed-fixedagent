// The employee source check shares one budget: a check that runs out of time while its article pages
// are being read reports the timeout, saves nothing and leaves no read running; a page the site
// refuses is a warning the source is saved with. On the real route, with a database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { after, test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { tag } from "../../../tests/setup.ts";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";

/** Every article page the check read. */
const articleReads: string[] = [];
/** The article pages whose read was cancelled instead of answered. */
const cancelledReads: string[] = [];
/** Waits for the next cancelled page. */
const cancelWaiters: Array<() => void> = [];
const nextCancel = () => new Promise<void>(resolve => { cancelWaiters.push(resolve); });

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path.startsWith("/article-hang/")) {
    articleReads.push(path);
    // A page that never answers: the check's deadline has to stop this read.
    req.on("close", () => {
      if (res.writableEnded) return;
      cancelledReads.push(path);
      for (const waiter of cancelWaiters.splice(0)) waiter();
    });
    return;
  }
  if (path.startsWith("/article-refused/")) {
    articleReads.push(path);
    res.writeHead(403);
    res.end("refused");
    return;
  }
  if (path === "/listing-hang") {
    res.setHeader("content-type", "text/html");
    res.end(`<ul>${[1, 2, 3].map(n => `<li><a href="/article-hang/${n}">An article whose page never answers ${n}</a></li>`).join("")}</ul>`);
    return;
  }
  if (path === "/listing-refused") {
    res.setHeader("content-type", "text/html");
    res.end(`<ul><li><a href="/article-refused/1">An article whose page is refused</a></li></ul>`);
    return;
  }
  if (path.startsWith("/listing-plain/")) {
    res.setHeader("content-type", "text/html");
    res.end(`<ul><li><a href="/article-plain/${path.split("/").pop()}">An article whose page reads</a></li></ul>`);
    return;
  }
  if (path.startsWith("/article-plain/")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><head><title>An article</title></head><body><h1>An article</h1><p>${"The article page reads fine. ".repeat(20)}</p></body></html>`);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDb();
});

/** The id the route gives a source: the address' digest. */
const sourceId = (address: string) => `member-source-${createHash("sha256").update(address).digest("hex").slice(0, 20)}`;

test("a check that runs out of time reports the timeout and saves nothing; a refused page is only a warning", async (t) => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); });

  const suffix = tag();
  const username = `member-source-${suffix}`;
  const password = "long-test-password-123";
  const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { username, realName: "员工甲", password } });
  assert.equal(registered.statusCode, 201);
  await sql`UPDATE member_users SET status = 'active' WHERE username = ${username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { username, password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  assert.ok(setCookie);
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";", 1)[0]!;
  const submit = (name: string, sourceUrl: string) => app.inject({
    method: "POST", url: "/api/v1/membership/sources",
    headers: { cookie, host: "newsfeed.test", origin: "http://newsfeed.test" },
    payload: { name, sourceUrl, kind: "web_list" },
  });

  // The check runs out of time while its first article page is being read.
  const before = process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS;
  process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS = "3000";
  t.after(() => {
    if (before === undefined) delete process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS;
    else process.env.MEMBER_SOURCE_CHECK_TIMEOUT_MS = before;
  });
  const cancelledRead = nextCancel();
  const timedOut = await submit("Timeout source", `${base}/listing-hang`);
  assert.equal(timedOut.statusCode, 422);
  assert.deepEqual(timedOut.json(), { error: "source_timeout" });
  const saved = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sources WHERE id = ${sourceId(`${base}/listing-hang`)}`;
  assert.equal(saved[0]!.n, 0, "a check that ran out of time saves nothing");
  assert.equal(articleReads.filter(path => path.startsWith("/article-hang/")).length, 1, "the reads stop at the page the deadline stopped");
  await Promise.race([cancelledRead, new Promise<void>(resolve => setTimeout(resolve, 2_000))]);
  assert.deepEqual(cancelledReads, ["/article-hang/1"], "the page read was cancelled");

  // The check that ran out of time left its slot free: the next check is answered, not rate-limited.
  const missing = await submit("Missing source", `${base}/missing`);
  assert.equal(missing.statusCode, 422);
  assert.equal((missing.json() as { error: string }).error, "source_not_found");

  // A page the site refuses is a warning: the listing was read, so the source is saved with it.
  const refused = await submit("Refused pages source", `${base}/listing-refused`);
  assert.equal(refused.statusCode, 201);
  assert.equal((refused.json() as { source: { detailFailures: number } }).source.detailFailures, 1);
  const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sources WHERE id = ${sourceId(`${base}/listing-refused`)}`;
  assert.equal(kept[0]!.n, 1, "a listing whose article page is refused is still saved");

  // There is no hourly quota: the checks above already used three, and these two are still checked
  // instead of answered with a rate limit.
  for (const n of [1, 2]) {
    const again = await submit(`Another source ${n}`, `${base}/listing-plain/${n}`);
    assert.equal(again.statusCode, 201, `the ${n}th check after three was not rate-limited`);
    assert.equal((again.json() as { source: { detailFailures: number } }).source.detailFailures, 0);
  }
});
