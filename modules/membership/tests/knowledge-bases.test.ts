// The knowledge bases of the library: what each one holds, and what stays apart. Two bases may hold
// a page about the same target; a base's pages, materials and answers are its own.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBossNow } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import { SERVER_MODULES } from "../../../site/modules/server.ts";
import { stub, tag } from "../../../tests/setup.ts";
import { runWikiTask } from "../knowledge/worker.ts";
import { DEFAULT_BASE_DESCRIPTION, DEFAULT_BASE_ID, DEFAULT_BASE_NAME, ensureDefaultBase } from "../knowledge/bases.ts";

// A valid draft name grows beyond 80 characters once the new base prefixes it.
const PAGE_SLUG = `view-company-${"a".repeat(57)}`;

const DRAFT = {
  pages: [{
    pageType: "view",
    slug: PAGE_SLUG,
    title: "某公司",
    targetType: "公司",
    targetName: "某公司",
    track: "食品饮料",
    consensus: "基于 1 家机构 1 位分析师 1 篇材料：多数看好。",
    divergences: [],
    marginalChanges: [{ date: "2026-06-20", attribution: "张三/某券商", note: "首次覆盖" }],
    stances: [{ analyst: "张三", institution: "某券商", stance: "看好", date: "2026-06-20", argument: "渠道库存低位", sourceRef: "S1" }],
    expectations: [],
    risks: [],
    timeline: [{ date: "2026-06-20", headline: "首次覆盖给予看好", notes: [], sourceRefs: ["S1"] }],
    question: null,
    answer: null,
    definition: null,
    structure: [],
    inputs: [],
    outputs: [],
    anchors: [],
    metrics: [],
    related: [],
  }],
  sources: [{ ref: "S1", institution: "某券商", authors: ["张三"], date: "2026-06-20", dateBasis: "封面", kind: "深度报告" }],
  notes: "测试用草稿",
};

const AUDIT = { verdict: "pass_with_issues", corrections: [], findings: [], notes: "" };

const provider = await stub(async (_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const system = body.messages.find(message => message.role === "system")?.content ?? "";
  const user = body.messages.find(message => message.role === "user")?.content ?? "";
  // The build has its own two model calls; the answer is the third.
  if (system.includes("Builder")) return { choices: [{ message: { content: JSON.stringify(DRAFT) } }] };
  if (system.includes("Auditor")) return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  const payload = JSON.parse(user) as { availablePages: Array<{ slug: string; availableCitations: Array<{ citationId: string; analyst: string | null }> }> };
  const page = payload.availablePages[0];
  const citation = page?.availableCitations[0];
  return {
    choices: [{ message: { content: JSON.stringify({
      answer: "某公司当前以张三/某券商的看好为主[^1]。\n\n参考资料：\n[^1]: 某公司 观点页",
      citations: [{ label: "1", pageSlug: page?.slug ?? "", citationId: citation?.citationId ?? "", analyst: null, organization: null }],
    }) } }],
  };
});
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "test-model" });

test("the knowledge bases hold their own materials, pages and answers", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); await provider.close(); });
  const suffix = tag();
  const accounts = [
    { username: `base-a-${suffix}`, realName: "员工甲", password: "long-test-password-123" },
    { username: `base-b-${suffix}`, realName: "员工乙", password: "long-test-password-123" },
  ];
  const common = { host: "newsfeed.test", origin: "http://newsfeed.test" };
  for (const account of accounts) {
    const registered = await app.inject({ method: "POST", url: "/api/v1/membership/register", headers: common, payload: account });
    assert.equal(registered.statusCode, 201);
  }
  await sql`UPDATE member_users SET status='active' WHERE username IN (${accounts[0]!.username},${accounts[1]!.username})`;
  const cookies: string[] = [];
  for (const account of accounts) {
    const login = await app.inject({ method: "POST", url: "/api/v1/membership/login", headers: common, payload: { username: account.username, password: account.password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    cookies.push((Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";", 1)[0]!);
  }

  // A visitor is turned away before any route runs.
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/bases", headers: common })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/bases", headers: common, payload: { name: "访客的知识库" } })).statusCode, 401);

  // The library holds the base it had before it had more than one.
  const listed = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/bases", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(listed.statusCode, 200);
  const bases = (await listed.json() as { bases: Array<{ id: string; name: string; documents: number; pages: number }> }).bases;
  assert.equal(bases.length, 1, "the shared base is there before anything else is made");
  assert.equal(bases[0]?.id, DEFAULT_BASE_ID);
  assert.equal(bases[0]?.name, "知识库示例", "the default base carries the platform's own name");

  // A new base is made by an approved employee.
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/bases", headers: { cookie: cookies[0]!, ...common }, payload: { name: "新能源赛道投研", description: "只收新能源赛道的材料" } });
  assert.equal(created.statusCode, 201);
  const base = (await created.json() as { base: { id: string; name: string } }).base;
  assert.equal(base.name, "新能源赛道投研");

  // The default base belongs to the platform: a base left over from an earlier release is renamed
  // when the library is read, and a base an employee made keeps the name it was given.
  await sql`UPDATE member_wiki_bases SET name = ${"全公司共享知识库"}, description = ${"全公司共用的投研知识库"} WHERE id = ${DEFAULT_BASE_ID}`;
  await ensureDefaultBase();
  const renamed = await sql<{ name: string; description: string }[]>`SELECT name, description FROM member_wiki_bases WHERE id = ${DEFAULT_BASE_ID}`;
  assert.equal(renamed[0]?.name, DEFAULT_BASE_NAME, "the default base is renamed when it is ensured");
  assert.equal(renamed[0]?.description, DEFAULT_BASE_DESCRIPTION);
  const own = await sql<{ name: string }[]>`SELECT name FROM member_wiki_bases WHERE id = ${base.id}`;
  assert.equal(own[0]?.name, "新能源赛道投研", "a base an employee made is not renamed");
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/bases/${base.id}`, headers: { cookie: cookies[0]!, ...common } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/bases/kb-does-not-exist", headers: { cookie: cookies[0]!, ...common } })).statusCode, 404);

  // A material goes into the base it was uploaded to.
  const material = Buffer.from("# 某公司深度报告\n\n张三/某券商，2026-06-20：看好，目标价 100 元。\n", "utf8").toString("base64");
  const upload = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { baseId: base.id, fileName: "某公司深度报告.md", base64: material, title: "某公司深度报告", author: "张三", organization: "某券商", date: "2026-06-20" },
  });
  assert.equal(upload.statusCode, 202);
  const uploaded = await upload.json() as { documentId: string; taskId: string };
  const document = await sql`SELECT base_id FROM member_wiki_documents WHERE id = ${uploaded.documentId}`;
  assert.equal(document[0]?.base_id, base.id, "the material belongs to the base it was uploaded to");

  // The material of one base is not in the other base's list.
  const otherDocuments = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/documents?baseId=${DEFAULT_BASE_ID}`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal((await otherDocuments.json() as { documents: unknown[] }).documents.length, 0);
  const ownDocuments = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/documents?baseId=${base.id}`, headers: { cookie: cookies[1]!, ...common } });
  assert.equal((await ownDocuments.json() as { documents: unknown[] }).documents.length, 1, "the other employee sees the base's materials too");

  // The build publishes the page in the base's own page space.
  await runWikiTask(uploaded.taskId);
  const pages = await sql`SELECT slug, base_id, target_key FROM member_wiki_pages`;
  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.base_id, base.id);
  assert.equal(pages[0]?.slug, `${base.id}-${PAGE_SLUG}`, "the page carries the base's own prefix");
  assert.ok((pages[0]?.target_key ?? "").startsWith(`${base.id}|`), "the page's key belongs to the base's key space");

  // The pages of the base are listed under that base, and the other base has none.
  const ownPages = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/pages?baseId=${base.id}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal((await ownPages.json() as { pages: unknown[] }).pages.length, 1);
  const sharedPages = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/pages?baseId=${DEFAULT_BASE_ID}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal((await sharedPages.json() as { pages: unknown[] }).pages.length, 0, "the shared base has no page of its own yet");
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/pages", headers: { cookie: cookies[0]!, ...common } })).statusCode, 200, "no base named means the shared base");

  // An answer rests on the pages of the base it was asked in.
  const answer = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { baseId: base.id, question: "某公司现在怎么看？" } });
  assert.equal(answer.statusCode, 200);
  const answered = await answer.json() as { answer: { citations: Array<{ pageSlug: string }> } };
  assert.deepEqual(answered.answer.citations.map(citation => citation.pageSlug), [`${base.id}-${PAGE_SLUG}`]);
  const otherAnswer = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { baseId: DEFAULT_BASE_ID, question: "某公司现在怎么看？" } });
  assert.equal(otherAnswer.statusCode, 404, "the other base has no page to answer from");
  assert.equal((await otherAnswer.json() as { error: string }).error, "knowledge_no_coverage");

  // The same target in the shared base is a page of its own.
  const [owner] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${accounts[0]!.username}`;
  const sharedDocumentId = randomUUID();
  const sharedVersionId = randomUUID();
  const sharedTaskId = randomUUID();
  await sql`INSERT INTO member_wiki_documents(id,uploader_id,title,base_id) VALUES (${sharedDocumentId},${owner!.id},'共享库材料',${DEFAULT_BASE_ID})`;
  await sql`INSERT INTO member_wiki_document_versions(id,document_id,version_no,uploader_id,file_name,media_type,format,byte_size,sha256,body,extracted_text,extraction_status)
    VALUES (${sharedVersionId},${sharedDocumentId},1,${owner!.id},'shared.md','text/markdown','markdown',7,${sharedVersionId},${Buffer.from('fixture')},${`fixture ${sharedVersionId}`},'available')`;
  await sql`INSERT INTO member_wiki_tasks(id,document_id,version_id,uploader_id,draft,audit)
    VALUES (${sharedTaskId},${sharedDocumentId},${sharedVersionId},${owner!.id},${sql.json(DRAFT)},${sql.json(AUDIT)})`;
  await runWikiTask(sharedTaskId);
  // Each base's build list is its own.
  const ownTasks = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/tasks?baseId=${base.id}`, headers: { cookie: cookies[0]!, ...common } });
  const ownTaskPage = ownTasks.json() as Promise<{ tasks: Array<{ id: string }>; hasMore: boolean; nextOffset: number | null }>;
  assert.deepEqual((await ownTaskPage).tasks.map(task => task.id), [uploaded.taskId], "另一个库的构建不在这个库的列表里");
  assert.equal((await ownTaskPage).hasMore, false);
  assert.equal((await ownTaskPage).nextOffset, null);
  const sharedTasks = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/tasks?baseId=${DEFAULT_BASE_ID}`, headers: { cookie: cookies[0]!, ...common } });
  const sharedTaskPage = sharedTasks.json() as Promise<{ tasks: Array<{ id: string }> }>;
  assert.deepEqual((await sharedTaskPage).tasks.map(task => task.id), [sharedTaskId]);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/tasks", headers: common })).statusCode, 401, "访客读不到构建列表");
  const both = await sql`SELECT slug, base_id FROM member_wiki_pages`;
  assert.equal(both.length, 2, "the two bases hold a page each");
  assert.equal(both.find(row => row.base_id === DEFAULT_BASE_ID)?.slug, PAGE_SLUG, "the shared base keeps the slugs its pages already carry");
  assert.equal(both.find(row => row.base_id === base.id)?.slug, `${base.id}-${PAGE_SLUG}`);
  const sharedList = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/pages?baseId=${DEFAULT_BASE_ID}`, headers: { cookie: cookies[0]!, ...common } });
  assert.deepEqual((await sharedList.json() as { pages: Array<{ slug: string }> }).pages.map(page => page.slug), [PAGE_SLUG]);
  const ownList = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/pages?baseId=${base.id}`, headers: { cookie: cookies[0]!, ...common } });
  assert.deepEqual((await ownList.json() as { pages: Array<{ slug: string }> }).pages.map(page => page.slug), [`${base.id}-${PAGE_SLUG}`]);

  // The base card counts what the base holds.
  const counted = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/bases", headers: { cookie: cookies[0]!, ...common } });
  const countedBases = (await counted.json() as { bases: Array<{ id: string; documents: number; pages: number }> }).bases;
  assert.equal(countedBases.length, 2);
  assert.equal(countedBases.find(entry => entry.id === base.id)?.documents, 1);
  assert.equal(countedBases.find(entry => entry.id === base.id)?.pages, 1);
  assert.equal(countedBases.find(entry => entry.id === DEFAULT_BASE_ID)?.documents, 1);
  assert.equal(countedBases.find(entry => entry.id === DEFAULT_BASE_ID)?.pages, 1);

  // A material cannot be added to a base that is not there.
  const unknown = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { baseId: "kb-does-not-exist", fileName: "材料.md", base64: material, title: "材料" },
  });
  assert.equal(unknown.statusCode, 404);
});
