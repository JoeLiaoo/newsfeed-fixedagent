import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { tag } from "../../../tests/setup.ts";
import { createPanoramaCheckpoint } from "../experts/panorama-checkpoint.ts";
import { PANORAMA_EXPERT_SLUG, EXPERT_SLUG } from "../experts/catalog.ts";

test("the panorama expert is published, needs a confirmed entity, keeps internal checkpoints and exposes Markdown artifacts", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); });
  const suffix = tag();
  const account = { username: `panorama-${suffix}`, realName: "全景甲", password: "long-test-password-123" };
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
  await sql`UPDATE member_users SET status='active' WHERE username=${account.username}`;
  const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!;

  const experts = (await (await app.inject({ method: "GET", url: "/api/v1/membership/experts", headers: { cookie, ...common } })).json() as { experts: Array<{ slug: string; name: string; execution_mode: string; status: string }> }).experts;
  const panorama = experts.find(expert => expert.slug === PANORAMA_EXPERT_SLUG);
  assert.ok(panorama, "对外投资全景图专家应出现在目录中");
  assert.equal(panorama.execution_mode, "xinhua_panorama");
  assert.equal(panorama.status, "available");
  assert.ok(panorama.name.includes("对外投资全景图"));
  assert.ok(!experts.some(expert => expert.slug === EXPERT_SLUG), "一层对外投资核查已从目录隐藏");

  const withoutName = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie, ...common, "idempotency-key": randomUUID() }, payload: { slug: PANORAMA_EXPERT_SLUG } });
  assert.equal(withoutName.statusCode, 400);
  assert.equal((await withoutName.json() as { error: string }).error, "company_name_required");

  const created = await app.inject({ method: "POST", url: "/api/v1/membership/expert-tasks", headers: { cookie, ...common, "idempotency-key": randomUUID() }, payload: { slug: PANORAMA_EXPERT_SLUG, companyName: "本方主体" } });
  assert.equal(created.statusCode, 202);
  const taskId = (await created.json() as { id: string }).id;
  const stored = await sql<{ input: { companyName?: string }; selected_entity: unknown }[]>`SELECT input, selected_entity FROM member_expert_tasks WHERE id=${taskId}`;
  assert.equal(stored[0]?.input.companyName, "本方主体");
  assert.equal(stored[0]?.selected_entity, null, "未确认主体前不得开始穿透");

  // The entity confirmation step: the task waits for the employee to pick the subject.
  const candidate = { id: "root", name: "本方主体", status: "存续", creditCode: "91330000MA000ROOT", address: null, startDate: null };
  await sql`UPDATE member_expert_tasks SET state='waiting_input', stage='choose_entity', result=${sql.json({ candidates: [candidate] })}, lease_token=NULL, lease_expires_at=NULL WHERE id=${taskId}`;
  const confirmed = await app.inject({ method: "POST", url: `/api/v1/membership/expert-tasks/${taskId}/entity`, headers: { cookie, ...common }, payload: { companyId: "root" } });
  assert.equal(confirmed.statusCode, 202);
  const selected = await sql<{ selected_entity: { id: string } | null; state: string }[]>`SELECT selected_entity, state FROM member_expert_tasks WHERE id=${taskId}`;
  assert.equal(selected[0]?.selected_entity?.id, "root");
  assert.equal(selected[0]?.state, "queued");

  // The task list says which subject a run is about: the name the employee typed and the subject
  // they confirmed, so a card in the list can be recognised.
  const listed = (await (await app.inject({ method: "GET", url: "/api/v1/membership/expert-tasks", headers: { cookie, ...common } })).json() as { tasks: Array<{ id: string; input: { companyName?: string }; selectedEntity: { name?: string; creditCode?: string } | null }> }).tasks;
  const card = listed.find(task => task.id === taskId);
  assert.equal(card?.input.companyName, "本方主体", "任务卡带着员工查询的企业名称");
  assert.equal(card?.selectedEntity?.name, "本方主体", "任务卡带着已确认的工商主体");

  const removedRoute = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/checkpoint`, headers: { cookie, ...common } });
  assert.equal(removedRoute.statusCode, 404, "员工端不再提供采集台账下载接口");

  // The collection ledger of the run: what it read, kept with the task.
  const checkpoint = createPanoramaCheckpoint(taskId, (await sql<{ user_id: string }[]>`SELECT user_id FROM member_expert_tasks WHERE id=${taskId}`)[0]!.user_id);
  await checkpoint.put({ nodeKey: "company:root", depth: 0, kind: "profile", tool: "get_company_profile", payload: { company_id: "root" } });
  await checkpoint.put({ nodeKey: "company:root", depth: 0, kind: "relations:0", tool: "get_direct_investment", payload: { direct_investment_info: [] } });
  const cached = await checkpoint.get("company:root", "profile");
  assert.equal(cached?.tool, "get_company_profile");
  assert.equal(await checkpoint.get("company:root", "missing"), null);
  assert.equal((await checkpoint.get("company:root", "relations:0"))?.tool, "get_direct_investment", "续跑仍可复用已保存的投资查询");
  const markdown = Buffer.from("# 对外投资全景图\n\nMarkdown draft\n", "utf8");
  const digest = createHash("sha256").update(markdown).digest("hex");
  await sql`INSERT INTO member_expert_artifacts(task_id,user_id,filename,content_type,body,sha256) VALUES (${taskId},(SELECT user_id FROM member_expert_tasks WHERE id=${taskId}),${`expert-${taskId}.md`},'text/markdown; charset=utf-8',${markdown},${digest})`;
  const artifact = await app.inject({ method: "GET", url: `/api/v1/membership/expert-tasks/${taskId}/artifact`, headers: { cookie, ...common } });
  assert.equal(artifact.statusCode, 200);
  assert.match(String(artifact.headers["content-type"]), /text\/markdown/);
  assert.match(String(artifact.headers["content-disposition"]), /\.md"/);
  assert.ok(artifact.body.includes("Markdown draft"));
});
