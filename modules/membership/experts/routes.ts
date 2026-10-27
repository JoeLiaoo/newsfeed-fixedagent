import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql, type Db } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import type { MemberSession } from "../server.ts";
import { EXPERT_QUEUE } from "./queue.ts";
import {webExpertActor,listExpertCatalog,createExpertTask,getExpertTask,confirmExpertEntity,cancelExpertTask,ExpertServiceError} from "./service.ts";
import { parseSkillUpload, expertSlug, executionMode } from "./import.ts";
import { COMING_SOON_EXPERT_STATUS, BUILTIN_SLUGS, EXPERT_SLUG, FRONTIER_PODCAST_EXPERT_SLUG, HIDDEN_BUILTIN_SLUGS, HIDDEN_EXPERT_STATUS, LISTED_FUND_PARTICIPATION_EXPERT_SLUG, PANORAMA_EXPERT_SLUG, QUERY_EXPERT_SLUGS, SECTOR_PEER_EXPERT_SLUG } from "./catalog.ts";
import { seedBuiltinExperts } from "./seed.ts";
import { parseTaskMaterials, MAX_TOTAL_MATERIAL_BYTES } from "./materials.ts";
import { getTaskArtifact } from "./worker.ts";
import { parseTaskPage, taskPagination, type TaskPageQuery } from "./task-query.ts";
import { parseListedFundInput } from "./listed-fund-participation.ts";

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

async function activeTaskCount(tx: Db, userId: string) {
  const rows = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${userId} AND state IN ('queued','running','waiting_input') AND expires_at > now()`;
  return rows[0]?.count ?? 0;
}

/** The list preview is enough to recognise a task without returning the full private brief. */
const NOTES_PREVIEW = 200;
const taskVisibleUntil = sql`GREATEST(t.expires_at, COALESCE((SELECT max(a.expires_at) FROM member_expert_artifacts a WHERE a.task_id=t.id), t.expires_at))`;

export function registerExpertRoutes(app: FastifyInstance, authenticate: Authenticate) {
  app.get("/api/v1/membership/experts", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const experts = await listExpertCatalog(webExpertActor(user.id),user.role === "admin");
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
    await seedBuiltinExperts();
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
    const parsed = parseTaskPage(req.query as TaskPageQuery);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { limit, offset, expertSlug, states } = parsed.page;
    const slugFilter = expertSlug ? sql`AND t.expert_slug = ${expertSlug}` : sql``;
    const stateFilter = states.length ? sql`AND t.state = ANY(${sql.array(states)}::text[])` : sql``;
    const rows = await sql`SELECT t.id, t.expert_slug AS "expertSlug", e.name AS "expertName", t.state, t.stage,
        json_build_object('companyName', t.input->>'companyName', 'query', t.input->>'query', 'region', t.input->>'region', 'startDate', t.input->>'startDate', 'endDate', t.input->>'endDate', 'notes', left(coalesce(t.input->>'notes',''), ${NOTES_PREVIEW}), 'notesTruncated', length(coalesce(t.input->>'notes','')) > ${NOTES_PREVIEW}) AS input,
        t.selected_entity AS "selectedEntity", t.result, t.error_code AS "errorCode", t.error_message AS "errorMessage", t.execution_attempts AS "executionAttempts", t.confirmed_attempts AS "confirmedAttempts", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
        ${taskVisibleUntil} AS "expiresAt",
        EXISTS(SELECT 1 FROM member_expert_artifacts a WHERE a.task_id=t.id AND a.user_id=${user.id} AND a.expires_at > now()) AS "hasArtifact",
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'filename',m.filename,'byteSize',m.byte_size,'sha256',m.sha256,'extractionStatus',m.extraction_status,'extractionNote',m.extraction_note) ORDER BY m.created_at) FROM member_expert_task_materials m WHERE m.task_id=t.id AND m.user_id=${user.id} AND m.expires_at > now()), '[]'::json) AS materials
      FROM member_expert_tasks t JOIN member_experts e ON e.slug=t.expert_slug
      WHERE t.user_id=${user.id} AND ${taskVisibleUntil} > now() ${slugFilter} ${stateFilter}
      ORDER BY t.created_at DESC, t.id DESC LIMIT ${limit + 1} OFFSET ${offset}`;
    return { tasks: rows.slice(0, limit), pagination: taskPagination(limit, offset, rows.length) };
  });

  app.get("/api/v1/membership/expert-tasks/:id", async (req, reply) => {
    noStore(reply);
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { id } = req.params as { id: string };
    try { await getExpertTask(webExpertActor(user.id), id); } catch { return reply.code(404).send({ error: "task_not_found" }); }
    const tasks = await sql`SELECT t.id, t.expert_slug AS "expertSlug", e.name AS "expertName", t.state, t.stage, t.input,
        t.selected_entity AS "selectedEntity", t.result, t.error_code AS "errorCode", t.error_message AS "errorMessage", t.execution_attempts AS "executionAttempts", t.confirmed_attempts AS "confirmedAttempts", t.created_at AS "createdAt", t.updated_at AS "updatedAt", ${taskVisibleUntil} AS "expiresAt",
        EXISTS(SELECT 1 FROM member_expert_artifacts a WHERE a.task_id=t.id AND a.user_id=${user.id} AND a.expires_at > now()) AS "hasArtifact",
        COALESCE((SELECT json_agg(json_build_object('id',m.id,'filename',m.filename,'byteSize',m.byte_size,'sha256',m.sha256,'extractionStatus',m.extraction_status,'extractionNote',m.extraction_note) ORDER BY m.created_at) FROM member_expert_task_materials m WHERE m.task_id=t.id AND m.user_id=${user.id} AND m.expires_at > now()), '[]'::json) AS materials
      FROM member_expert_tasks t JOIN member_experts e ON e.slug=t.expert_slug
      WHERE t.id=${id} AND t.user_id=${user.id} AND ${taskVisibleUntil} > now()`;
    if (!tasks[0]) return reply.code(404).send({ error: "task_not_found" });
    return { task: tasks[0] };
  });

  app.post("/api/v1/membership/expert-tasks", { bodyLimit: Math.ceil(MAX_TOTAL_MATERIAL_BYTES * 4 / 3) + 512 * 1024 }, async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const { slug } = body(req);
    const notes = typeof body(req).notes === "string" ? (body(req).notes as string).trim() : "";
    const companyName = typeof body(req).companyName === "string" ? (body(req).companyName as string).trim() : "";
    const query = typeof body(req).query === "string" ? body(req).query as string : "";
    if (notes.length > 20_000 || companyName.length > 200 || query.length > 200 || String(body(req).region ?? "").length > 100 || String(body(req).stockCodes ?? "").length > 2_000) return reply.code(413).send({ error: "task_input_too_large" });
    let materials;
    try { materials = parseTaskMaterials(body(req).materials); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "expert_material_invalid" }); }
    const experts = typeof slug === "string" ? await sql<{ status: string; manifest: { tools?: string[] } }[]>`SELECT status, manifest FROM member_experts WHERE slug=${slug}` : [];
    const expert = experts[0];
    // A planned entry stays in the catalog but starts no task: the employee sees what is on the way and
    // the refusal names the state, so nobody reads it as a broken dependency.
    if (expert?.status === COMING_SOON_EXPERT_STATUS) return reply.code(404).send({ error: "expert_coming_soon" });
    // A hidden builtin is not offered as a catalog entry, so it reads as absent: it starts no task.
    const hidden = (typeof slug === "string" && HIDDEN_BUILTIN_SLUGS.has(slug)) || expert?.status === HIDDEN_EXPERT_STATUS;
    if (hidden || !expert || expert.status !== "available") return reply.code(404).send({ error: hidden || !expert ? "expert_not_found" : "expert_dependencies_missing" });
    const mode = slug === EXPERT_SLUG ? "xinhua_trial" : slug === PANORAMA_EXPERT_SLUG ? "xinhua_panorama" : slug === FRONTIER_PODCAST_EXPERT_SLUG ? "podcast_search" : slug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG ? "listed_fund_participation" : executionMode(expert.manifest);
    if (mode === "xinhua_trial" && companyName.length < 2) return reply.code(400).send({ error: "company_name_required" });
    if (mode === "xinhua_panorama" && companyName.length < 2) return reply.code(400).send({ error: "company_name_required" });
    if (slug === SECTOR_PEER_EXPERT_SLUG && [...query.trim()].filter(char => /[\p{Script=Han}\p{Script=Latin}]/u.test(char)).length < 2) return reply.code(400).send({ error: "sector_query_required" });
    // The podcast expert takes the topic the employee wants to hear about; the library needs at least
    // two characters to search and refuses more than a hundred, so both ends are checked here.
    if (slug === FRONTIER_PODCAST_EXPERT_SLUG) {
      const characters = [...query.trim()].filter(char => /[\p{Script=Han}\p{Script=Latin}\p{Nd}]/u.test(char)).length;
      if (characters < 2 || query.trim().length > 100) return reply.code(400).send({ error: "podcast_query_required" });
    }
    // A written brief is what a custom expert runs on. The shipped experts read an entity or a topic
    // instead, so they start without one.
    const slugText = typeof slug === "string" ? slug : "";
    let listedFundInput: ReturnType<typeof parseListedFundInput> | null = null;
    if (slugText === LISTED_FUND_PARTICIPATION_EXPERT_SLUG) {
      try { listedFundInput = parseListedFundInput(body(req)); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "listed_fund_input_invalid" }); }
    }
    if (!BUILTIN_SLUGS.has(slugText) && !QUERY_EXPERT_SLUGS.has(slugText) && notes.length < 2) return reply.code(400).send({ error: "task_text_required" });
    const input = { ...(QUERY_EXPERT_SLUGS.has(slugText) ? { query } : mode === "text_only" ? {} : { companyName }), ...(listedFundInput ?? {}), notes };
    const rawKey = req.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(rawKey) ? rawKey : null;
    try {
      const accepted = await createExpertTask(webExpertActor(user.id), {slug:slugText,...input}, {idempotencyKey,materials});
      return reply.code(202).send({id:accepted.id,state:accepted.state});
    } catch (error) {
      const code = error instanceof ExpertServiceError ? error.code : "expert_task_failed";
      return reply.code(code === "expert_task_rate_limited" ? 429 : code === "idempotency_conflict" ? 409 : code === "expert_not_found" ? 404 : 400).send({error:code});
    }
  });

  app.post("/api/v1/membership/expert-tasks/:id/entity", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const companyId = body(req).companyId;
    if (typeof companyId !== "string" || companyId.length > 120) return reply.code(400).send({ error: "invalid_entity" });
    try {
      const changed = await confirmExpertEntity(webExpertActor(user.id),id,companyId);
      if(changed.state === "failed") return reply.code(409).send({error:"expert_retry_exhausted",message:"确认后的执行次数已用尽，请重新提交。"});
      return reply.code(202).send(changed);
    } catch (error) {
      const code = error instanceof ExpertServiceError ? error.code : "task_or_entity_not_found";
      return reply.code(code === "expert_retry_exhausted" ? 409 : 404).send({error:code});
    }
  });

  app.post("/api/v1/membership/expert-tasks/:id/retry", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    const changed = await sql.begin(async tx => {
      await tx`SELECT id FROM member_users WHERE id=${user.id} FOR UPDATE`;
      const retryable = await tx`SELECT id FROM member_expert_tasks WHERE id=${id} AND user_id=${user.id} AND state='failed' AND expires_at>now() AND (CASE WHEN selected_entity IS NULL THEN execution_attempts ELSE confirmed_attempts END)<3 FOR UPDATE`;
      if (!retryable.length) return "not_retryable";
      if (await activeTaskCount(tx, user.id) >= 2) return "at_capacity";
      const currentAttempts = await tx<{ count: number }[]>`SELECT COALESCE(sum(execution_attempts),0)::int AS count FROM member_expert_tasks WHERE user_id=${user.id} AND last_attempt_at > now() - interval '1 hour'`;
      if ((currentAttempts[0]?.count ?? 0) >= 6) return "not_retryable";
      const rows = await tx`UPDATE member_expert_tasks SET state='queued', stage='queued', error_code=NULL, error_message=NULL, updated_at=now(), finished_at=NULL
        WHERE id=${id} AND user_id=${user.id} AND state='failed' AND expires_at > now() RETURNING id`;
      if (!rows.length) return "not_retryable";
      await enqueueOn(EXPERT_QUEUE, { taskId: id }, { singletonKey: `${id}-${Date.now()}` }, tx);
      return "queued";
    });
    if (changed === "at_capacity") return reply.code(429).send({ error: "expert_task_rate_limited", message: "任务并发上限已达到，请稍后重试。" });
    if (changed !== "queued") return reply.code(404).send({ error: "task_not_retryable" });
    return reply.code(202).send({ id, state: "queued" });
  });

  app.post("/api/v1/membership/expert-tasks/:id/cancel", async (req, reply) => {
    noStore(reply);
    if (!validOrigin(req)) return reply.code(403).send({ error: "invalid_origin" });
    const user = await authenticate(req);
    if (!user) return reply.code(401).send({ error: "login_required" });
    const id = (req.params as { id: string }).id;
    try { return await cancelExpertTask(webExpertActor(user.id),id); }
    catch { return reply.code(404).send({ error: "task_not_cancellable" }); }
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
