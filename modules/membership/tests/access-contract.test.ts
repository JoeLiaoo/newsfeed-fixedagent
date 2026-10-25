import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { tag } from "../../../tests/setup.ts";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";

test("employee content boundary, member isolation, and immutable daily digest snapshots", async (t) => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await closeDb(); });

  const anonymous = await app.inject({ method: "GET", url: "/api/site/pool", headers: { origin: "https://outside.example" } });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers["cache-control"], "private, no-store");
  assert.equal(anonymous.headers["access-control-allow-origin"], undefined);
  assert.equal((await app.inject({ method: "GET", url: "/feed.xml" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/items/private-article/markdown" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/og/story/private-story.png" })).statusCode, 401);
  const malformedSession = await app.inject({ method: "GET", url: "/api/v1/membership/me", headers: { cookie: "citic_member_session=%" } });
  assert.equal(malformedSession.statusCode, 401, "a malformed cookie is treated as no session");

  const suffix = tag();
  const accounts = [
    { username: `member-a-${suffix}`, realName: "员工甲", password: "long-test-password-123", interest: "光伏" },
    { username: `member-b-${suffix}`, realName: "员工乙", password: "long-test-password-123", interest: "半导体与集成电路" },
  ];
  for (const { username, realName, password } of accounts) {
    const response = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { username, realName, password } });
    assert.equal(response.statusCode, 201);
  }
  await sql`UPDATE member_users SET status = 'active' WHERE username = ${accounts[0]!.username} OR username = ${accounts[1]!.username}`;

  const cookies: string[] = [];
  for (const account of accounts) {
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: { host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    assert.ok(setCookie);
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";", 1)[0]!);
  }
  for (let index = 0; index < accounts.length; index++) {
    const response = await app.inject({ method: "PUT", url: "/api/v1/membership/interests", headers: { cookie: cookies[index]!, host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { tags: [accounts[index]!.interest] } });
    assert.equal(response.statusCode, 200);
  }
  const profileA = await (await app.inject({ method: "GET", url: "/api/v1/membership/me", headers: { cookie: cookies[0]! } })).json() as { tags: string[]; catalog: string[] };
  const profileB = await (await app.inject({ method: "GET", url: "/api/v1/membership/me", headers: { cookie: cookies[1]! } })).json() as { tags: string[] };
  assert.deepEqual(profileA.tags, [accounts[0]!.interest]);
  assert.deepEqual(profileB.tags, [accounts[1]!.interest]);

  const customTag = `自定义${suffix}`;
  const custom = await app.inject({ method: "POST", url: "/api/v1/membership/interests/custom", headers: { cookie: cookies[0]!, host: "newsfeed.test", origin: "http://newsfeed.test" }, payload: { tag: customTag } });
  assert.equal(custom.statusCode, 200);
  const updatedA = await (await app.inject({ method: "GET", url: "/api/v1/membership/me", headers: { cookie: cookies[0]! } })).json() as { tags: string[]; catalog: string[] };
  assert(updatedA.tags.includes(customTag));
  assert(updatedA.catalog.includes(customTag));
  const updatedB = await (await app.inject({ method: "GET", url: "/api/v1/membership/me", headers: { cookie: cookies[1]! } })).json() as { tags: string[] };
  assert(!updatedB.tags.includes(customTag));

  const sourceIds = [`digest-source-a-${suffix}`, `digest-source-b-${suffix}`];
  for (const [index, sourceId] of sourceIds.entries()) {
    const config = { feedUrl: `https://example.test/feed-${index}.xml`, _aihot: { discoveryScope: "sitemap", discoveryMethod: "robots_txt", previewCount: 10 } };
    await sql`INSERT INTO sources (id, name, kind, config) VALUES (${sourceId}, ${`Digest Source ${index}`}, 'rss', ${sql.json(config)})`;
  }
  const [story] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title) VALUES (${randomUUID()}, 'One shared event') RETURNING id`;
  const publishedAt = new Date();
  for (const [index, sourceId] of sourceIds.entries()) {
    const articleId = `digest-article-${index}-${suffix}`;
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
      VALUES (${articleId}, ${sourceId}, ${`identity-${articleId}`}, ${`https://example.test/${articleId}`}, ${`Report ${index}`}, ${publishedAt}, ${publishedAt})`;
    await sql`INSERT INTO publications (article_id, eligible, title, summary, tags, source_id, channel, url, discovered_at, timeline_at, sort_at, story_id)
      VALUES (${articleId}, true, ${`Report ${index}`}, 'Shared summary', ${sql.array([accounts[0]!.interest])}::text[], ${sourceId}, 'news', ${`https://example.test/${articleId}`}, ${publishedAt}, ${publishedAt}, ${publishedAt}, ${story!.id})`;
  }
  const sourceReport = await (await app.inject({ method: "GET", url: "/api/v1/membership/sources", headers: { cookie: cookies[0]! } })).json() as { activeSources: number; coverage: Array<{ tag: string; count: number }>; sources: Array<{ id: string; enabled: boolean; discovery_scope: string; discovery_method: string; preview_count: number; items_7d: number }> };
  assert.equal(sourceReport.activeSources, sourceReport.sources.filter(source => source.enabled).length, "employee view counts the same shared pool it lists");
  assert.ok(sourceReport.activeSources >= 2);
  assert.ok(sourceReport.coverage.some(row => row.tag === accounts[0]!.interest && row.count >= 2));
  const reportedSource = sourceReport.sources.find((source) => source.id === sourceIds[0]);
  assert.equal(reportedSource?.discovery_scope, "sitemap");
  assert.equal(reportedSource?.discovery_method, "robots_txt");
  assert.equal(reportedSource?.preview_count, 10);
  assert.equal(reportedSource?.items_7d, 1);

  const first = await (await app.inject({ method: "GET", url: "/api/v1/membership/digest", headers: { cookie: cookies[0]! } })).json() as { window: { cutoff: string }; items: unknown[] };
  const second = await (await app.inject({ method: "GET", url: "/api/v1/membership/digest", headers: { cookie: cookies[0]! } })).json() as { window: { cutoff: string }; items: unknown[] };
  assert.equal(first.window.cutoff, second.window.cutoff);
  assert.deepEqual(first.items, second.items);
  assert.equal(first.items.length, 1, "articles from two sources for one story appear once in the event snapshot");
  const history = await (await app.inject({ method: "GET", url: "/api/v1/membership/digest/history", headers: { cookie: cookies[0]! } })).json() as { digests: unknown[] };
  assert.equal(history.digests.length, 1);
});
