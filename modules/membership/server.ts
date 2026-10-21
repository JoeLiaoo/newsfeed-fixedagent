import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import { createSource, previewSource } from "@aihot/backend/admin/sources";
import { registerExpertRoutes } from "./experts/routes.ts";
import { registerGpRoutes } from "./gp/routes.ts";
import { registerNotificationRoutes } from "./notifications/routes.ts";
import { getDailyDigest } from "./notifications/digest.ts";
import { beijingDate } from "@aihot/contracts/time";
import { listedCondition } from "@aihot/backend/publication/scope";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import * as cheerio from "cheerio";
import { PRESET_TAGS } from "./catalog.ts";

const scrypt = promisify(scryptCallback);
const COOKIE = "citic_member_session";
const maxAge = 14 * 24 * 60 * 60;
const attempts = new Map<string, { count: number; until: number }>();
const sourcePreviews = new Map<string, number[]>();
const activeSourcePreviews = new Set<string>();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomId = () => randomBytes(16).toString("hex");
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

export type MemberSession = { id: string; username: string; real_name: string; role: string; status: string };

async function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${digest.toString("hex")}`;
}

async function passwordMatches(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  return safeEqual(await passwordHash(password, salt), encoded);
}

function cookieToken(req: FastifyRequest) {
  const cookie = req.headers.cookie ?? "";
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value ? decodeURIComponent(value) : null;
}

export async function memberSession(req: FastifyRequest, allowPending = false): Promise<MemberSession | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const rows = await sql<{ id: string; username: string; real_name: string; role: string; status: string }[]>`
    SELECT u.id, u.username, u.real_name, u.role, u.status FROM member_sessions s
    JOIN member_users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()
  `;
  const user = rows[0];
  return user && (user.status === "active" || allowPending) ? user : null;
}

function noStore(reply: { header: (name: string, value: string) => unknown }) {
  reply.header("Cache-Control", "private, no-store");
  reply.header("Vary", "Cookie");
}

function validOrigin(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function limited(req: FastifyRequest) {
  const ip = req.ip;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.until < now) { attempts.set(ip, { count: 1, until: now + 15 * 60_000 }); return false; }
  entry.count++;
  if (entry.count > 30) return true;
  if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  return false;
}

function body(req: FastifyRequest): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
}

function installCookie(reply: any, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

async function issueSession(userId: string, reply: any) {
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO member_sessions (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + (${maxAge} * interval '1 second'))`;
  installCookie(reply, token);
}

export function registerMembership(app: FastifyInstance) {
  registerExpertRoutes(app, memberSession);
  registerGpRoutes(app, memberSession);
  registerNotificationRoutes(app, memberSession);
  app.post("/api/v1/membership/register", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    if (limited(req)) return reply.code(429).send({ error: "try_later" });
    const { username, realName, password } = body(req);
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) || typeof realName !== "string" || realName.trim().length < 2 || realName.trim().length > 80 || typeof password !== "string" || password.length < 12 || password.length > 200) {
      return reply.code(400).send({ error: "invalid_registration", message: "用户名需 3–40 位；真实姓名需 2–80 字；密码需至少 12 位。" });
    }
    const id = randomId();
    try {
      await sql`INSERT INTO member_users (id, username, real_name, password_hash) VALUES (${id}, ${username}, ${realName.trim()}, ${await passwordHash(password)})`;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "username_taken" });
      throw error;
    }
    return reply.code(201).send({ status: "pending_approval" });
  });

  app.post("/api/v1/membership/login", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    if (limited(req)) return reply.code(429).send({ error: "try_later" });
    const { username, password } = body(req);
    const rows = typeof username === "string" && typeof password === "string" ? await sql<{ id: string; password_hash: string; status: string }[]>`SELECT id, password_hash, status FROM member_users WHERE username = ${username}` : [];
    const user = rows[0];
    if (!user || !(await passwordMatches(String(password ?? ""), user.password_hash))) return reply.code(401).send({ error: "invalid_credentials" });
    if (user.status !== "active") return reply.code(403).send({ error: user.status === "pending" ? "pending_approval" : "account_unavailable" });
    await issueSession(user.id, reply);
    return { ok: true };
  });

  app.post("/api/v1/membership/logout", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const token = cookieToken(req);
    if (token) await sql`DELETE FROM member_sessions WHERE token_hash = ${sha256(token)}`;
    reply.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/v1/membership/me", async (req, reply) => {
    noStore(reply);
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tags = await sql<{ tag: string }[]>`SELECT tag FROM member_interest_tags WHERE user_id = ${user.id} ORDER BY tag`;
    const publicTags = await sql<{ tag: string }[]>`SELECT tag FROM public_interest_tags ORDER BY tag`;
    return { user: { username: user.username, realName: user.real_name, role: user.role }, tags: tags.map((r) => r.tag), catalog: [...new Set([...PRESET_TAGS, ...publicTags.map((r) => r.tag)])] };
  });

  app.put("/api/v1/membership/interests", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const rawTags = body(req).tags;
    if (!Array.isArray(rawTags) || rawTags.length > 100 || rawTags.some((tag) => typeof tag !== "string" || tag.trim().length < 2 || tag.trim().length > 80)) return reply.code(400).send({ error: "invalid_tags" });
    const tags = [...new Set(rawTags.map((tag) => (tag as string).trim()))];
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM member_users WHERE id = ${user.id} FOR UPDATE`;
      const publicTags: Array<{ tag: string }> = [];
      for (const tag of tags) {
        if (!PRESET_TAGS.includes(tag as never)) {
          const [known] = await tx<{ tag: string }[]>`SELECT tag FROM public_interest_tags WHERE tag = ${tag}`;
          if (known) publicTags.push(known);
        }
      }
      const allowed = new Set([...PRESET_TAGS, ...publicTags.map((r) => r.tag)]);
      if (tags.some((tag) => !allowed.has(tag))) throw Object.assign(new Error("unknown tag"), { statusCode: 400 });
      const current = await tx<{ tag: string }[]>`SELECT tag FROM member_interest_tags WHERE user_id = ${user.id} ORDER BY tag`;
      const before = current.map((row) => row.tag);
      const after = [...tags].sort();
      if (before.length !== after.length || before.some((tag, index) => tag !== after[index])) {
        await tx`DELETE FROM member_interest_tags WHERE user_id = ${user.id}`;
        for (const tag of tags) await tx`INSERT INTO member_interest_tags (user_id, tag) VALUES (${user.id}, ${tag})`;
        await tx`UPDATE member_users SET interests_version = interests_version + 1 WHERE id = ${user.id}`;
      }
    });
    return { tags };
  });

  app.post("/api/v1/membership/interests/custom", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tag = typeof body(req).tag === "string" ? (body(req).tag as string).trim() : "";
    if (tag.length < 2 || tag.length > 80 || PRESET_TAGS.includes(tag as never)) return reply.code(400).send({ error: "invalid_tag" });
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM member_users WHERE id = ${user.id} FOR UPDATE`;
      await tx`INSERT INTO public_interest_tags(tag, created_by) VALUES (${tag}, ${user.id}) ON CONFLICT (tag) DO NOTHING`;
      const added = await tx`INSERT INTO member_interest_tags(user_id, tag) VALUES (${user.id}, ${tag}) ON CONFLICT DO NOTHING RETURNING tag`;
      if (added.length) await tx`UPDATE member_users SET interests_version = interests_version + 1 WHERE id = ${user.id}`;
    });
    return { tag, selected: true };
  });

  app.get("/api/v1/membership/digest", async (req, reply) => {
    noStore(reply);
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const today = beijingDate(new Date());
    const requestedDate = typeof req.query === "object" && req.query && "date" in req.query ? String((req.query as { date?: unknown }).date ?? "") : "";
    const date = requestedDate || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return reply.code(400).send({ error: "invalid_digest_date" });
    const result = await getDailyDigest(user.id, date);
    if (!result) return reply.code(404).send({ error: "digest_not_generated" });
    return { date: result.local_date, preferenceVersion: result.preference_version, window: { start: result.window_start, cutoff: result.cutoff_at }, generatedAt: result.generated_at, tags: result.tags, items: result.items };
  });

  app.get("/api/v1/membership/digest/history", async (req, reply) => {
    noStore(reply);
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const digests = await sql`SELECT local_date::text AS date, preference_version AS "preferenceVersion", window_start AS "windowStart", cutoff_at AS cutoff, generated_at AS "generatedAt", jsonb_array_length(items) AS "itemCount" FROM member_daily_digests WHERE user_id = ${user.id} ORDER BY local_date DESC, preference_version DESC`;
    return { digests };
  });

  app.get("/api/v1/membership/admin/pending", async (req, reply) => {
    noStore(reply);
    const admin = await memberSession(req);
    if (!admin || admin.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    const users = await sql`SELECT id, username, real_name, created_at FROM member_users WHERE status = 'pending' ORDER BY created_at`;
    return { users };
  });

  app.get("/api/v1/membership/sources", async (req, reply) => {
    noStore(reply);
    if (!(await memberSession(req))) return reply.code(401).send({ error: "login_required" });
    const sources = await sql`
      SELECT s.id, s.name, s.kind, s.enabled, s.health, s.last_ok_at,
        s.config->'_aihot'->>'discoveryScope' AS discovery_scope,
        s.config->'_aihot'->>'discoveryMethod' AS discovery_method,
        (s.config->'_aihot'->>'previewCount')::int AS preview_count,
        (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id AND a.discovered_at > now() - interval '7 days') AS items_7d
      FROM sources s ORDER BY s.name
    `;
    const now = new Date();
    const coverage = await sql<{ tag: string; count: number }[]>`
      SELECT tag, count(DISTINCT p.article_id)::int AS count FROM publications p
      CROSS JOIN LATERAL unnest(p.tags) AS tag
      WHERE ${listedCondition(now)} AND p.timeline_at > ${now}::timestamptz - interval '7 days'
      GROUP BY tag ORDER BY count DESC, tag
    `;
    return { sources, coverage };
  });

  app.post("/api/v1/membership/sources", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await memberSession(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { name, sourceUrl, kind } = body(req);
    if (typeof sourceUrl !== "string" || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120 || (kind !== "rss" && kind !== "web_list" && kind !== "sitemap")) return reply.code(400).send({ error: "invalid_source" });
    let url: URL;
    try { url = new URL(sourceUrl); } catch { return reply.code(400).send({ error: "invalid_url" }); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return reply.code(400).send({ error: "invalid_url" });
    const key = user.id;
    const nowMs = Date.now();
    const attemptsForUser = (sourcePreviews.get(key) ?? []).filter((stamp) => nowMs - stamp < 60 * 60_000);
    if (activeSourcePreviews.has(key) || activeSourcePreviews.size >= 4 || attemptsForUser.length >= 3) return reply.code(429).send({ error: "source_preview_rate_limited", retryAfterSeconds: 3600 });
    sourcePreviews.set(key, [...attemptsForUser, nowMs]);
    activeSourcePreviews.add(key);
    const digest = createHash("sha256").update(url.toString()).digest("hex").slice(0, 20);
    const id = `member-source-${digest}`;
    let previewRunning = false;
    try {
      const alreadyAdded = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id = ${id}`;
      if (alreadyAdded.length) return reply.code(409).send({ error: "duplicate_source" });
      let selectedKind = kind;
      let selectedUrl = url.toString();
      let discoveryMethod = "user_supplied";
      if (kind === "web_list" && url.pathname === "/") {
        const discovered = await discoverSiteFeeds(url);
        if (discovered.sitemap) { selectedKind = "sitemap"; selectedUrl = discovered.sitemap; discoveryMethod = discovered.sitemapMethod; }
        else if (discovered.rss) { selectedKind = "rss"; selectedUrl = discovered.rss; discoveryMethod = "homepage_alternate"; }
      }
      const sourceKind = selectedKind === "rss" ? "rss" : "web_list";
      const scope = selectedKind === "sitemap" ? "sitemap" : selectedKind === "rss" ? "rss" : "listing";
      const initialBackfillLimit = selectedKind === "sitemap" ? 30 : 30;
      const report = { initialBackfillLimit, discoveryScope: scope, discoveryMethod, previewCount: 0 };
      const sourceConfig: Record<string, unknown> = selectedKind === "rss"
        ? { feedUrl: selectedUrl, _aihot: report }
        : selectedKind === "sitemap"
          ? { url: selectedUrl, parseMode: "sitemap", detail: { titleSelector: "title", maxFetches: 15 }, _aihot: report }
          : { url: selectedUrl, parseMode: "html", detail: { maxFetches: 5 }, _aihot: report };
      const previewTask = previewSource({ id, kind: sourceKind, config: sourceConfig });
      previewRunning = true;
      void previewTask.then(() => activeSourcePreviews.delete(key), () => activeSourcePreviews.delete(key));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const preview = await Promise.race([
        previewTask,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("preview_timeout")), 45_000); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (!preview.count) return reply.code(422).send({ error: "no_public_articles_found" });
      (sourceConfig._aihot as Record<string, unknown>).previewCount = preview.count;
      const created = await createSource({ id, name: name.trim(), kind: sourceKind, config: sourceConfig, interval_minutes: 30, tags: ["员工提交"], site_fulltext: false, syndicate_fulltext: false }, `member:${user.id}`);
      if (!created.created) return reply.code(409).send({ error: "duplicate_source", source: created.duplicate });
      return reply.code(201).send({ source: { id, name: name.trim(), kind: selectedKind, previewCount: preview.count, discoveredUrl: selectedUrl, scope, discoveryMethod } });
    } catch (error) {
      req.log.info({ sourceId: id }, "employee source preview failed");
      return reply.code(422).send({ error: "source_validation_failed" });
    } finally {
      if (!previewRunning) activeSourcePreviews.delete(key);
      if (sourcePreviews.size > 5000) for (const [entryKey, stamps] of sourcePreviews) {
        const recent = stamps.filter((stamp) => nowMs - stamp < 60 * 60_000);
        if (recent.length) sourcePreviews.set(entryKey, recent); else sourcePreviews.delete(entryKey);
      }
    }
  });

  app.post("/api/v1/membership/admin/:id/decision", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const admin = await memberSession(req);
    if (!admin || admin.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    const { decision } = body(req);
    if (decision !== "approve" && decision !== "reject") return reply.code(400).send({ error: "invalid_decision" });
    const id = (req.params as { id: string }).id;
    const status = decision === "approve" ? "active" : "rejected";
    const changed = await sql`UPDATE member_users SET status = ${status}, approved_at = CASE WHEN ${status} = 'active' THEN now() ELSE approved_at END, approved_by = ${admin.id} WHERE id = ${id} AND status = 'pending' RETURNING id`;
    if (!changed.length) return reply.code(404).send({ error: "pending_user_not_found" });
    return { ok: true };
  });
}

async function discoverSiteFeeds(home: URL): Promise<{ rss: string | null; sitemap: string | null; sitemapMethod: string }> {
  const rssSet = new Set<string>();
  let sitemap: string | null = null;
  let sitemapMethod = "user_supplied";
  try {
    const page = await guardedFetch(home.toString(), { timeoutMs: 8_000, maxBytes: 512_000, maxRedirects: 3, headers: { accept: "text/html,application/xhtml+xml" } });
    const $ = cheerio.load(page.text());
    $("link[rel~='alternate'][type*='rss'], link[rel~='alternate'][type*='atom']").each((_i, el) => {
      const href = $(el).attr("href");
      if (href) try { rssSet.add(new URL(href, page.url).toString()); } catch {}
    });
    $("a[href*='sitemap'][href$='.xml']").each((_i, el) => {
      const href = $(el).attr("href");
      if (href && !sitemap) try { sitemap = new URL(href, page.url).toString(); sitemapMethod = "homepage_link"; } catch {}
    });
    const robots = await guardedFetch(new URL("/robots.txt", page.url).toString(), { timeoutMs: 5_000, maxBytes: 64_000, maxRedirects: 2, headers: { accept: "text/plain" } });
    const line = robots.text().split(/\r?\n/).find((row) => /^\s*sitemap\s*:/i.test(row));
    if (!sitemap && line) try { sitemap = new URL(line.split(":").slice(1).join(":").trim(), page.url).toString(); sitemapMethod = "robots_txt"; } catch {}
  } catch {
    // The normal preview below reports the concrete source validation failure.
  }
  if (!sitemap) {
    for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
      try {
        const candidate = new URL(path, home).toString();
        const response = await guardedFetch(candidate, { timeoutMs: 5_000, maxBytes: 32_000, maxRedirects: 2, headers: { accept: "application/xml,text/xml,*/*;q=0.8" } });
        if (response.status === 200 && /<(?:\w+:)?(?:sitemapindex|urlset)\b/i.test(response.text())) { sitemap = response.url; sitemapMethod = "well_known"; break; }
      } catch { /* Try the next well-known sitemap location. */ }
    }
  }
  return { rss: [...rssSet][0] ?? null, sitemap, sitemapMethod };
}

/** All API data is employee-only. Only health and account entry points remain anonymously reachable. */
export function registerMembershipAccessBoundary(app: FastifyInstance) {
  const privateContentPath = (req: FastifyRequest) => {
    const pathname = (req.raw.url ?? "/").split("?", 1)[0]!;
    if (pathname.startsWith("/api/")) return pathname !== "/api/health" && !["/api/v1/membership/register", "/api/v1/membership/login", "/api/v1/membership/logout", "/api/v1/membership/bridge/claim"].includes(pathname);
    return pathname === "/feed.xml" || pathname.startsWith("/feed/") || pathname.startsWith("/og/") || pathname.startsWith("/items/")
      || ["/sitemap.xml", "/llms.txt", "/openapi-v1.json"].includes(pathname);
  };
  app.addHook("onRequest", async (req, reply) => {
    if (!privateContentPath(req)) return;
    noStore(reply);
    reply.removeHeader("Access-Control-Allow-Origin");
    reply.removeHeader("Access-Control-Allow-Credentials");
    if (!(await memberSession(req))) return reply.code(401).send({ error: "login_required" });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (privateContentPath(req)) {
      noStore(reply);
      reply.removeHeader("Access-Control-Allow-Origin");
      reply.removeHeader("Access-Control-Allow-Credentials");
    }
    return payload;
  });
}

export { EXPERT_QUEUE } from "./experts/queue.ts";
export { cleanupExpertData, recoverExpertTasks } from "./experts/worker.ts";
