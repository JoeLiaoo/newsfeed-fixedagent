// The employee's source check reads a site on the name that serves the content: an apex name may
// answer with a bot wall while the `www` name serves the feed. The check reads the rewritten address
// and the source is stored with it, so the collector keeps hitting the address that answered. The
// fixture serves the aliased name, so the test never depends on the live site.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, mock, test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { tag } from "../../../tests/setup.ts";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";

/** Every address the check asked for, with the host it named. */
const requests: string[] = [];

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>测试源</title><link>http://www.36kr.com/</link>
<item><title>36氪测试文章</title><link>http://www.36kr.com/article/1</link><guid>http://www.36kr.com/article/1</guid><pubDate>Mon, 26 Oct 2026 00:00:00 GMT</pubDate><description>摘要</description></item>
</channel></rss>`;

const server = http.createServer((req, res) => {
  requests.push(`${req.headers.host}${req.url}`);
  if (req.url === "/feed") { res.writeHead(200, { "content-type": "application/rss+xml" }); res.end(feed); return; }
  res.writeHead(404);
  res.end("not found");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
// The aliased name is served by the fixture: the connection goes to the local server.
const savedConnect = net.connect;
mock.method(net, "connect", function (this: unknown, options: net.TcpNetConnectOpts, ...rest: unknown[]) {
  if (options?.host === "www.36kr.com") options = { ...options, host: "127.0.0.1", port };
  return Reflect.apply(savedConnect, this, [options, ...rest]);
});
config.allowPrivateNetworkFetch = true;
after(async () => {
  mock.restoreAll();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDb();
});

test("an employee's source on an aliased host is checked and stored on the name that serves it", async (t) => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); });

  const suffix = tag();
  const username = `member-alias-${suffix}`;
  const password = "long-test-password-123";
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: { username, realName: "员工甲", password } });
  assert.equal(registered.statusCode, 201);
  await sql`UPDATE member_users SET status = 'active' WHERE username = ${username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username, password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  assert.ok(setCookie);
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";", 1)[0]!;

  const submitted = await app.inject({
    method: "POST", url: "/api/v1/membership/sources",
    headers: { cookie, ...common },
    payload: { name: `36氪测试源-${suffix}`, sourceUrl: "http://36kr.com/feed", kind: "rss" },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);
  const created = submitted.json() as { source: { discoveredUrl: string; previewCount: number } };
  assert.equal(created.source.discoveredUrl, "http://www.36kr.com/feed", "the check read the name that serves the feed");
  assert.equal(created.source.previewCount, 1);
  assert.ok(requests.includes("www.36kr.com/feed"), `the aliased address was read: ${requests.join(", ")}`);
  assert.equal(requests.some(request => request.startsWith("36kr.com")), false, "the apex name is never read");

  const [stored] = await sql<{ config: { feedUrl: string } }[]>`SELECT config FROM sources WHERE name = ${`36氪测试源-${suffix}`}`;
  assert.ok(stored, "the source is saved");
  assert.equal(stored.config.feedUrl, "http://www.36kr.com/feed", "the stored address is the one that answered");
});
