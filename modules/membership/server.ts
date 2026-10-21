import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import { createSource, previewSource } from "@aihot/backend/admin/sources";
import { listedCondition } from "@aihot/backend/publication/scope";
import { PRESET_TAGS } from "./catalog.ts";

const scrypt = promisify(scryptCallback);
const COOKIE = "citic_member_session";
const maxAge = 14 * 24 * 60 * 60;
const attempts = new Map<string, { count: number; until: number }>();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomId = () => randomBytes(16).toString("hex");
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

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

async function session(req: FastifyRequest, allowPending = false) {
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
    const user = await session(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tags = await sql<{ tag: string }[]>`SELECT tag FROM member_interest_tags WHERE user_id = ${user.id} ORDER BY tag`;
    const publicTags = await sql<{ tag: string }[]>`SELECT tag FROM public_interest_tags ORDER BY tag`;
    return { user: { username: user.username, realName: user.real_name, role: user.role }, tags: tags.map((r) => r.tag), catalog: [...new Set([...PRESET_TAGS, ...publicTags.map((r) => r.tag)])] };
  });

  app.put("/api/v1/membership/interests", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await session(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const rawTags = body(req).tags;
    if (!Array.isArray(rawTags) || rawTags.length > 100 || rawTags.some((tag) => typeof tag !== "string" || tag.trim().length < 2 || tag.trim().length > 80)) return reply.code(400).send({ error: "invalid_tags" });
    const tags = [...new Set(rawTags.map((tag) => (tag as string).trim()))];
    await sql.begin(async (tx) => {
      const publicTags = await tx<{ tag: string }[]>`SELECT tag FROM public_interest_tags WHERE tag IN ${tx(tags)}`;
      const allowed = new Set([...PRESET_TAGS, ...publicTags.map((r) => r.tag)]);
      if (tags.some((tag) => !allowed.has(tag))) throw Object.assign(new Error("unknown tag"), { statusCode: 400 });
      await tx`DELETE FROM member_interest_tags WHERE user_id = ${user.id}`;
      if (tags.length) await tx`INSERT INTO member_interest_tags (user_id, tag) SELECT ${user.id}, x FROM unnest(${tx(tags)}::text[]) x`;
    });
    return { tags };
  });

  app.post("/api/v1/membership/interests/custom", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await session(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tag = typeof body(req).tag === "string" ? (body(req).tag as string).trim() : "";
    if (tag.length < 2 || tag.length > 80 || PRESET_TAGS.includes(tag as never)) return reply.code(400).send({ error: "invalid_tag" });
    await sql`INSERT INTO public_interest_tags(tag, created_by) VALUES (${tag}, ${user.id}) ON CONFLICT (tag) DO NOTHING`;
    return { tag };
  });

  app.get("/api/v1/membership/digest", async (req, reply) => {
    noStore(reply);
    const user = await session(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const now = new Date();
    const [today] = await sql<{ date: string }[]>`SELECT to_char(${now} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date`;
    const rows = await sql<{ article_id: string; title: string; summary: string | null; url: string; tags: string[]; source_name: string; published_at: Date | null; timeline_at: Date }[]>`
      SELECT p.article_id, p.title, p.summary, p.url, p.tags, s.name AS source_name, p.published_at, p.timeline_at
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE ${listedCondition(now)}
        AND p.timeline_at >= (date_trunc('day', ${now} AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
        AND p.timeline_at < ((date_trunc('day', ${now} AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai')
        AND EXISTS (SELECT 1 FROM member_interest_tags t WHERE t.user_id = ${user.id} AND t.tag = ANY(p.tags))
      ORDER BY p.timeline_at DESC LIMIT 100
    `;
    return { date: today!.date, generatedAt: new Date().toISOString(), items: rows };
  });

  app.get("/api/v1/membership/admin/pending", async (req, reply) => {
    noStore(reply);
    const admin = await session(req);
    if (!admin || admin.role !== "admin") return reply.code(403).send({ error: "admin_required" });
    const users = await sql`SELECT id, username, real_name, created_at FROM member_users WHERE status = 'pending' ORDER BY created_at`;
    return { users };
  });

  app.get("/api/v1/membership/sources", async (req, reply) => {
    noStore(reply);
    if (!(await session(req))) return reply.code(401).send({ error: "login_required" });
    const sources = await sql`
      SELECT s.id, s.name, s.kind, s.enabled, s.health, s.last_ok_at,
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
    const user = await session(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { name, sourceUrl, kind } = body(req);
    if (typeof sourceUrl !== "string" || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120 || (kind !== "rss" && kind !== "web_list" && kind !== "sitemap")) return reply.code(400).send({ error: "invalid_source" });
    let url: URL;
    try { url = new URL(sourceUrl); } catch { return reply.code(400).send({ error: "invalid_url" }); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return reply.code(400).send({ error: "invalid_url" });
    const digest = createHash("sha256").update(url.toString()).digest("hex").slice(0, 20);
    const id = `member-source-${digest}`;
    try {
      const sourceKind = kind === "rss" ? "rss" : "web_list";
      const sourceConfig = kind === "rss" ? { feedUrl: url.toString() } : kind === "sitemap"
        ? { url: url.toString(), parseMode: "sitemap", detail: { titleSelector: "title", maxFetches: 40 }, _aihot: { initialBackfillLimit: 50 } }
        : { url: url.toString(), parseMode: "html" };
      const preview = await previewSource({ id, kind: sourceKind, config: sourceConfig });
      if (!preview.count) return reply.code(422).send({ error: "no_public_articles_found" });
      const created = await createSource({ id, name: name.trim(), kind: sourceKind, config: sourceConfig, interval_minutes: 30, tags: ["员工提交"], site_fulltext: false, syndicate_fulltext: false }, `member:${user.id}`);
      if (!created.created) return reply.code(409).send({ error: "duplicate_source", source: created.duplicate });
      return reply.code(201).send({ source: { id, name: name.trim(), previewCount: preview.count } });
    } catch (error) {
      req.log.info({ sourceId: id }, "employee source preview failed");
      return reply.code(422).send({ error: "source_validation_failed" });
    }
  });

  app.post("/api/v1/membership/admin/:id/decision", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const admin = await session(req);
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
