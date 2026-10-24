import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import type { MemberSession } from "../server.ts";
import { EXPERT_QUEUE } from "./queue.ts";
import { parseSkillUpload, expertSlug, executionMode } from "./import.ts";
import { BUILTIN_EXPERT, EXPERT_SLUG } from "./catalog.ts";
import { parseTaskMaterials, MAX_TOTAL_MATERIAL_BYTES } from "./materials.ts";
import { getTaskArtifact } from "./worker.ts";

type Authenticate = (request: FastifyRequest, allowPending?: boolean) => Promise<MemberSession | null>;

function noStore(reply: { header: (name: string, value: string) => unknown }) {
  reply.header("Cache-Control", "private, no-store");
  reply.header("Vary", "Cookie");
}

function validOrigin(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function body(req: FastifyRequest): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
}

async function seedBuiltin() {
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${BUILTIN_EXPERT.slug}, NULL, ${BUILTIN_EXPERT.name}, ${BUILTIN_EXPERT.description}, ${BUILTIN_EXPERT.version}, ${BUILTIN_EXPERT.skillMd}, ${sql.json({ tools: ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] })}, 'available', ${sql.array(BUILTIN_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, missing_dependencies=EXCLUDED.missing_dependencies`;
}

function taskId() { return randomBytes(16).toString("hex"); }

export function registerExpertRoutes(app: FastifyInstance, authenticate: Authenticate) {
  app.get("/api/v1/membership/experts", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    await seedBuiltin();
    const experts = await sql<{ slug: string; name: string; description: string; version: string; status: string; missing_dependencies: string[]; execution_mode: string; created_at: Date }[]>`
      SELECT slug, name, description, version, status, missing_dependencies, CASE WHEN slug=${EXPERT_SLUG} OR manifest->'tools' @> ${sql.json(["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"])}::jsonb THEN 'xinhua_trial' ELSE 'text_only' END AS execution_mode, created_at FROM member_experts
      WHERE owner_id IS NULL OR owner_id = ${user.id}
      ORDER BY (slug = ${EXPERT_SLUG}) DESC, created_at DESC`;
    return { experts };
  });

  app.post("/api/v1/membership/experts/import", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { fileName, base64 } = body(req);
    if (typeof fileName !== "string" || typeof base64 !== "string") return reply.code(400).send({ error: "skill_upload_invalid" });
    let skill;
    try { skill = parseSkillUpload(fileName, base64); }
    catch (error) {
      const code = error instanceof Error ? error.message : "skill_upload_invalid";
      return reply.code(400).send({ error: code });
    }
    await seedBuiltin();
    const slug = expertSlug(user.id, fileName);
    const status = skill.missingDependencies.length ? "blocked" : "available";
    await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
      VALUES (${slug}, ${user.id}, ${skill.name}, ${skill.description}, ${skill.version}, ${skill.skillMd}, ${sql.json(skill.manifest)}, ${status}, ${sql.array(skill.missingDependencies)}::text[])`;
    return reply.code(201).send({ expert: { slug, name: skill.name, description: skill.description, version: skill.version, status, executionMode: executionMode(skill.manifest), missingDependencies: skill.missingDependencies } });
  });

  app.get("/api/v1/membership/expert-tasks", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const tasks = await sql`SELECT t.id, t.expert_slug AS "expertSlug", e.name AS "expertName", t.state, t.stage, t.input,
        t.result, t.error_code AS "errorCode", t.error_message AS "errorMessage", t.execution_attempts AS "executionAttempts", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
        EXISTS(SELECT 1 FROM member_expert_artifacts a WHERE a.task_id=t.id AND a.user_id=${user.id} AND a.expires_at > now()) AS "hasArtifact",
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'filename',m.filename,'byteSize',m.byte_size,'sha256',m.sha256,'extractionStatus',m.extraction_status,'extractionNote',m.extraction_note) ORDER BY m.created_at) FROM member_expert_task_materials m WHERE m.task_id=t.id AND m.user_id=${user.id} AND m.expires_at > now()), '[]'::json) AS materials
      FROM member_expert_tasks t JOIN member_experts e ON e.slug=t.expert_slug
      WHERE t.user_id=${user.id} AND t.expires_at > now() ORDER BY t.created_at DESC LIMIT 50`;
    return { tasks };
  });

  app.post("/api/v1/membership/expert-tasks", { bodyLimit: Math.ceil(MAX_TOTAL_MATERIAL_BYTES * 4 / 3) + 512 * 1024 }, async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { slug } = body(req);
    const notes = typeof body(req).notes === "string" ? (body(req).notes as string).trim() : "";
    const companyName = typeof body(req).companyName === "string" ? (body(req).companyName as string).trim() : "";
    if (notes.length > 20_000 || companyName.length > 200) return reply.code(413).send({ error: "task_input_too_large" });
    let materials;
    try { materials = parseTaskMaterials(body(req).materials); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "expert_material_invalid" }); }
    const experts = typeof slug === "string" ? await sql<{ status: string; owner_id: string | null; manifest: { tools?: string[] } }[]>`SELECT status, owner_id, manifest FROM member_experts WHERE slug=${slug} AND (owner_id IS NULL OR owner_id=${user.id})` : [];
    const expert = experts[0];
    if (!expert || expert.status !== "available") return reply.code(404).send({ error: expert ? "expert_dependencies_missing" : "expert_not_found" });
    const mode = slug === EXPERT_SLUG ? "xinhua_trial" : executionMode(expert.manifest);
    if (mode === "xinhua_trial" && companyName.length < 2) return reply.code(400).send({ error: "company_name_required" });
    if (slug !== EXPERT_SLUG && notes.length < 2) return reply.code(400).send({ error: "task_text_required" });
    const id = taskId();
    const input = { ...(mode === "xinhua_trial" ? { companyName } : {}), notes };
    const rawKey = req.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(rawKey) ? rawKey : null;
    const accepted = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      if (idempotencyKey) {
        const existing = await tx<{ id: string; state: string }[]>`SELECT id,state FROM member_expert_tasks WHERE user_id=${user.id} AND idempotency_key=${idempotencyKey}`;
        if (existing[0]) return existing[0];
      }
      const active = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${user.id} AND state IN ('queued','running','waiting_input') AND expires_at > now()`;
      if ((active[0]?.count ?? 0) >= 2) return null;
      const recent = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${user.id} AND created_at > now() - interval '1 hour'`;
      if ((recent[0]?.count ?? 0) >= 10) return null;
      await tx`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,idempotency_key) VALUES (${id},${user.id},${slug as string},'queued',${tx.json(input)},${idempotencyKey})`;
      for (const material of materials) await tx`INSERT INTO member_expert_task_materials(id,task_id,user_id,filename,format,content_type,byte_size,sha256,body) VALUES (${material.id},${id},${user.id},${material.filename},${material.format},${material.contentType},${material.bytes.length},${material.sha256},${material.bytes})`;
      await enqueueOn(EXPERT_QUEUE, { taskId: id }, { singletonKey: id }, tx);
      return { id, state: "queued" };
    });
    if (!accepted) {
      console.warn(JSON.stringify({ event: "expert_task_admission_limited", userId: user.id, activeLimit: 2, hourlyLimit: 10 }));
      return reply.code(429).send({ error: "expert_task_rate_limited", message: "任务并发或每小时提交上限已达到，请稍后重试。" });
    }
    return reply.code(202).send(accepted);
  });

  app.post("/api/v1/membership/expert-tasks/:id/entity", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const companyId = body(req).companyId;
    if (typeof companyId !== "string" || companyId.length > 120) return reply.code(400).send({ error: "invalid_entity" });
    const changed = await sql.begin(async tx => {
      const rows = await tx<{ id: string; result: { candidates?: Array<Record<string, unknown>> } | null }[]>`SELECT t.id, t.result FROM member_expert_tasks t JOIN member_experts e ON e.slug=t.expert_slug WHERE t.id=${id} AND t.user_id=${user.id} AND t.state='waiting_input' AND (t.expert_slug=${EXPERT_SLUG} OR e.manifest->'tools' @> ${sql.json(["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"])}::jsonb) FOR UPDATE OF t`;
      const candidates = rows[0]?.result?.candidates ?? [];
      const entity = candidates.find(candidate => candidate.id === companyId);
      if (!rows[0] || !entity) return false;
      await tx`UPDATE member_expert_tasks SET selected_entity=${tx.json(entity as never)}, state='queued', stage='queued', result=NULL, updated_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=${id}`;
      await enqueueOn(EXPERT_QUEUE, { taskId: id }, { singletonKey: id }, tx);
      return true;
    });
    if (!changed) return reply.code(404).send({ error: "task_or_entity_not_found" });
    return reply.code(202).send({ id, state: "queued" });
  });

  app.post("/api/v1/membership/expert-tasks/:id/retry", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const changed = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      const currentAttempts = await tx<{ count: number }[]>`SELECT COALESCE(sum(execution_attempts),0)::int AS count FROM member_expert_tasks WHERE user_id=${user.id} AND last_attempt_at > now() - interval '1 hour'`;
      if ((currentAttempts[0]?.count ?? 0) >= 6) return false;
      const rows = await tx`UPDATE member_expert_tasks SET state='queued', stage='queued', error_code=NULL, error_message=NULL, updated_at=now(), finished_at=NULL
        WHERE id=${id} AND user_id=${user.id} AND state='failed' AND execution_attempts < 3 AND expires_at > now() RETURNING id`;
      if (!rows.length) return false;
      await enqueueOn(EXPERT_QUEUE, { taskId: id }, { singletonKey: `${id}-${Date.now()}` }, tx);
      return true;
    });
    if (!changed) return reply.code(404).send({ error: "task_not_retryable" });
    return reply.code(202).send({ id, state: "queued" });
  });

  app.post("/api/v1/membership/expert-tasks/:id/cancel", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const changed = await sql`UPDATE member_expert_tasks SET state='cancelled',stage='cancelled',updated_at=now(),finished_at=now(),lease_token=NULL,lease_expires_at=NULL
      WHERE id=${id} AND user_id=${user.id} AND state IN ('queued','waiting_input','running') RETURNING id`;
    if (!changed.length) return reply.code(404).send({ error: "task_not_cancellable" });
    return { id, state: "cancelled" };
  });

  app.get("/api/v1/membership/expert-tasks/:id/artifact", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const artifact = await getTaskArtifact(id, user.id);
    if (!artifact) return reply.code(404).send({ error: "artifact_not_found_or_expired" });
    return reply.header("Content-Type", artifact.content_type).header("Content-Disposition", `attachment; filename="${artifact.filename}"`).header("X-Content-Type-Options", "nosniff").header("ETag", `"${artifact.sha256}"`).send(artifact.body);
  });

  app.get("/api/v1/membership/expert-tasks/:id/materials/:materialId", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { id, materialId } = req.params as { id: string; materialId: string };
    const rows = await sql<{ filename: string; content_type: string; body: Buffer; sha256: string }[]>`SELECT m.filename,m.content_type,m.body,m.sha256 FROM member_expert_task_materials m JOIN member_expert_tasks t ON t.id=m.task_id WHERE m.id=${materialId} AND m.task_id=${id} AND m.user_id=${user.id} AND t.user_id=${user.id} AND t.state <> 'cancelled' AND t.expires_at > now() AND m.expires_at > now()`;
    if (!rows[0]) return reply.code(404).send({ error: "expert_material_not_found" });
    const material = rows[0];
    return reply.header("Content-Type", material.content_type).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(material.filename)}`).header("X-Content-Type-Options", "nosniff").header("ETag", `"${material.sha256}"`).send(material.body);
  });

  app.delete("/api/v1/membership/expert-tasks/:id/materials/:materialId", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { id, materialId } = req.params as { id: string; materialId: string };
    const removed = await sql`DELETE FROM member_expert_task_materials m USING member_expert_tasks t WHERE m.id=${materialId} AND m.task_id=${id} AND m.user_id=${user.id} AND t.id=m.task_id AND t.user_id=${user.id} AND t.state IN ('succeeded','failed','cancelled') RETURNING m.id`;
    if (!removed.length) return reply.code(404).send({ error: "expert_material_not_deletable" });
    return reply.code(204).send();
  });
}
