// The answers an employee asked: what they may read back, whose answers they are, which base they
// belong to, and how far they may follow them back to the material behind them.
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
import { DEFAULT_BASE_ID } from "../knowledge/bases.ts";

const PAGE_SLUG = "view-history-company";

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
  if (system.includes("Builder")) return { choices: [{ message: { content: JSON.stringify(DRAFT) } }] };
  if (system.includes("Auditor")) return { choices: [{ message: { content: JSON.stringify(AUDIT) } }] };
  const payload = JSON.parse(user) as { availablePages: Array<{ slug: string; availableCitations: Array<{ citationId: string }> }> };
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

type HistoryCitation = {
  pageSlug: string; title: string; analyst: string | null; organization: string | null; publishedOn: string | null;
  citationId: string | null; versionId: string | null; documentId: string | null; documentTitle: string | null; fileName: string | null;
};
type HistoryAnswer = {
  id: string; question: string; answerMd: string; citations: HistoryCitation[];
  coverage: { analysts: number; firms: number; reports: number; first_report: string | null; last_report: string | null };
  freshness: Array<{ pageSlug: string; tier: string | null; lastReport: string | null }>;
  pages: string[]; createdAt: string;
};
type HistoryBody = { answers: HistoryAnswer[]; pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } };

test("an employee reads back the answers they asked in one base", async t => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  t.after(async () => { await app.close(); await stopBossNow(); await closeDb(); await provider.close(); });
  const suffix = tag();
  const accounts = [
    { username: `hist-a-${suffix}`, realName: "员工甲", password: "long-test-password-123" },
    { username: `hist-b-${suffix}`, realName: "员工乙", password: "long-test-password-123" },
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
  const [owner] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE username=${accounts[0]!.username}`;

  // A visitor is turned away before any route runs.
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers", headers: common })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/answers?baseId=${DEFAULT_BASE_ID}`, headers: common })).statusCode, 401);

  // A material and the page it builds.
  const material = Buffer.from("# 某公司深度报告\n\n张三/某券商，2026-06-20：看好，目标价 100 元。\n", "utf8").toString("base64");
  const upload = await app.inject({
    method: "POST", url: "/api/v1/membership/knowledge/documents", headers: { cookie: cookies[0]!, ...common },
    payload: { fileName: "某公司深度报告.md", base64: material, title: "某公司深度报告", author: "张三", organization: "某券商", date: "2026-06-20" },
  });
  assert.equal(upload.statusCode, 202);
  const uploaded = await upload.json() as { documentId: string; versionId: string; taskId: string };
  await runWikiTask(uploaded.taskId);
  const [publishedCitation] = await sql<{ id: string }[]>`SELECT id FROM member_wiki_citations WHERE label = 'S1'`;
  assert.ok(publishedCitation, "the published page holds the citation the answer points at");

  // Both employees ask the same question: the answers are their own.
  const asked = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[0]!, ...common }, payload: { question: "某公司现在怎么看？" } });
  assert.equal(asked.statusCode, 200);
  const fresh = await asked.json() as { answer: { id: string; citations: HistoryCitation[] } };
  assert.equal(fresh.answer.citations[0]?.documentId, uploaded.documentId, "a fresh answer leads back to its material too");
  assert.equal(fresh.answer.citations[0]?.versionId, uploaded.versionId);
  const other = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common }, payload: { question: "某公司现在怎么看？" } });
  assert.equal(other.statusCode, 200);
  const otherAnswer = await other.json() as { answer: { id: string } };

  // The history of an employee holds their own answers.
  const mine = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[0]!, ...common } });
  assert.equal(mine.statusCode, 200);
  const body = await mine.json() as HistoryBody;
  assert.equal(body.answers.length, 1);
  assert.equal(body.answers[0]?.id, fresh.answer.id);
  assert.equal(body.answers[0]?.question, "某公司现在怎么看？");
  assert.match(body.answers[0]?.answerMd ?? "", /某公司/);
  assert.ok(body.answers[0]?.createdAt, "the answer says when it was asked");
  assert.deepEqual(body.answers[0]?.pages, [PAGE_SLUG]);
  assert.ok((body.answers[0]?.coverage.analysts ?? 0) >= 1, "the coverage the answer recorded comes back with it");
  // The citation leads back to the page, the material and the file behind it.
  const citation = body.answers[0]?.citations[0];
  assert.equal(citation?.pageSlug, PAGE_SLUG);
  assert.equal(citation?.versionId, uploaded.versionId);
  assert.equal(citation?.documentId, uploaded.documentId);
  assert.equal(citation?.documentTitle, "某公司深度报告");
  assert.equal(citation?.fileName, "某公司深度报告.md");
  assert.equal(citation?.analyst, "张三");
  assert.equal(citation?.organization, "某券商");
  assert.equal(citation?.publishedOn, "2026-06-20");

  // The other employee's answer is not in it.
  const theirs = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers", headers: { cookie: cookies[1]!, ...common } });
  const theirBody = await theirs.json() as HistoryBody;
  assert.equal(theirBody.answers.length, 1);
  assert.equal(theirBody.answers[0]?.id, otherAnswer.answer.id);
  assert.notEqual(theirBody.answers[0]?.id, body.answers[0]?.id, "an answer is the employee's own record");

  // Another base holds its own answers: the shared base's answer is not in it, and its own is not
  // in the shared base.
  const created = await app.inject({ method: "POST", url: "/api/v1/membership/knowledge/bases", headers: { cookie: cookies[0]!, ...common }, payload: { name: "问答记录测试库" } });
  assert.equal(created.statusCode, 201);
  const base = (await created.json() as { base: { id: string } }).base;
  const otherSlug = `${base.id}-view-other-company`;
  await sql`INSERT INTO member_wiki_pages(id, slug, page_type, target_name, status, base_id) VALUES (${randomUUID()}, ${otherSlug}, 'view', '另一公司', 'published', ${base.id})`;
  await sql`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by)
    VALUES (${randomUUID()}, '另一个库的问题', '另一个库的回答', ${sql.json([])}, ${sql.json({})}, ${sql.json([])}, ${sql.json([otherSlug])}, ${owner!.id})`;
  const inOtherBase = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/answers?baseId=${base.id}`, headers: { cookie: cookies[0]!, ...common } });
  assert.equal(inOtherBase.statusCode, 200);
  const otherBaseBody = await inOtherBase.json() as HistoryBody;
  assert.deepEqual(otherBaseBody.answers.map(answer => answer.question), ["另一个库的问题"], "the base holds the answers that read its pages");
  assert.equal(otherBaseBody.answers[0]?.coverage.analysts, 0, "a coverage the answer never recorded is empty, not made up");
  assert.deepEqual(otherBaseBody.answers[0]?.freshness, []);
  const sharedAgain = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/answers?baseId=${DEFAULT_BASE_ID}`, headers: { cookie: cookies[0]!, ...common } });
  const sharedBody = await sharedAgain.json() as HistoryBody;
  assert.deepEqual(sharedBody.answers.map(answer => answer.question), ["某公司现在怎么看？"], "the other base's answer is not in the shared base");

  // A citation that names only the row it came from leads back to the material behind it.
  const byCitation = randomUUID();
  await sql`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by)
    VALUES (${byCitation}, '按引用行回溯的问题', '回答', ${sql.json([{ label: "1", pageSlug: PAGE_SLUG, title: "某公司", citationId: publishedCitation!.id }])}, ${sql.json({})}, ${sql.json([])}, ${sql.json([PAGE_SLUG])}, ${owner!.id})`;
  // A citation that names neither leads back to the page it was read from, when that page still
  // holds exactly one source.
  const byPage = randomUUID();
  await sql`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by)
    VALUES (${byPage}, '按页面回溯的问题', '回答', ${sql.json([{ label: "1", pageSlug: PAGE_SLUG, title: "某公司" }])}, ${sql.json({})}, ${sql.json([])}, ${sql.json([PAGE_SLUG])}, ${owner!.id})`;
  // A page with two sources: there the material cannot be named without guessing.
  const secondDocumentId = randomUUID();
  const secondVersionId = randomUUID();
  await sql`INSERT INTO member_wiki_documents(id, uploader_id, title) VALUES (${secondDocumentId}, ${owner!.id}, '第二份材料')`;
  await sql`INSERT INTO member_wiki_document_versions(id, document_id, version_no, uploader_id, file_name, media_type, format, byte_size, sha256, body, extraction_status)
    VALUES (${secondVersionId}, ${secondDocumentId}, 1, ${owner!.id}, '第二份材料.md', 'text/markdown', 'markdown', 7, ${secondVersionId}, ${Buffer.from("fixture")}, 'available')`;
  const twoSourcePageId = randomUUID();
  await sql`INSERT INTO member_wiki_pages(id, slug, page_type, target_name, status, base_id) VALUES (${twoSourcePageId}, 'view-two-sources', 'view', '两源公司', 'published', ${DEFAULT_BASE_ID})`;
  await sql`INSERT INTO member_wiki_page_revisions(id, page_id, revision, body_md) VALUES (${randomUUID()}, ${twoSourcePageId}, 1, '正文')`;
  await sql`INSERT INTO member_wiki_citations(id, page_id, revision, version_id, label) VALUES (${randomUUID()}, ${twoSourcePageId}, 1, ${uploaded.versionId}, 'S1')`;
  await sql`INSERT INTO member_wiki_citations(id, page_id, revision, version_id, label) VALUES (${randomUUID()}, ${twoSourcePageId}, 1, ${secondVersionId}, 'S2')`;
  const ambiguous = randomUUID();
  await sql`INSERT INTO member_wiki_answers(id, question, answer_md, citations, coverage, freshness, pages, asked_by)
    VALUES (${ambiguous}, '两源页面的问题', '回答', ${sql.json([{ label: "1", pageSlug: "view-two-sources", title: "两源公司" }])}, ${sql.json({})}, ${sql.json([])}, ${sql.json(["view-two-sources"])}, ${owner!.id})`;

  const withEdges = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers?limit=100", headers: { cookie: cookies[0]!, ...common } });
  const edges = await withEdges.json() as HistoryBody;
  const byId = new Map(edges.answers.map(answer => [answer.id, answer]));
  assert.equal(byId.get(byCitation)?.citations[0]?.versionId, uploaded.versionId, "the citation row names the material");
  assert.equal(byId.get(byCitation)?.citations[0]?.documentId, uploaded.documentId);
  assert.equal(byId.get(byPage)?.citations[0]?.versionId, uploaded.versionId, "the page's only source names the material");
  assert.equal(byId.get(byPage)?.citations[0]?.documentId, uploaded.documentId);
  assert.equal(byId.get(ambiguous)?.citations[0]?.versionId, null, "two sources on a page: no material is guessed");
  assert.equal(byId.get(ambiguous)?.citations[0]?.documentId, null);
  assert.equal(byId.get(ambiguous)?.citations[0]?.analyst, null, "a missing attribution stays empty");
  assert.equal(byId.get(ambiguous)?.citations[0]?.organization, null);
  assert.equal(byId.get(ambiguous)?.citations[0]?.publishedOn, null);

  // The history is read one page at a time.
  const total = edges.answers.length;
  const firstPage = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers?limit=2&offset=0", headers: { cookie: cookies[0]!, ...common } });
  const first = await firstPage.json() as HistoryBody;
  assert.equal(first.answers.length, 2);
  assert.equal(first.pagination.limit, 2);
  assert.equal(first.pagination.offset, 0);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.nextOffset, 2);
  const lastPage = await app.inject({ method: "GET", url: `/api/v1/membership/knowledge/answers?limit=2&offset=${total - 1}`, headers: { cookie: cookies[0]!, ...common } });
  const last = await lastPage.json() as HistoryBody;
  assert.equal(last.answers.length, 1);
  assert.equal(last.pagination.hasMore, false);
  assert.equal(last.pagination.nextOffset, null);
  // A page size that is not a number is refused.
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers?limit=abc", headers: { cookie: cookies[0]!, ...common } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers?offset=-1", headers: { cookie: cookies[0]!, ...common } })).statusCode, 400);
  // The other employee still sees only their own answer.
  const theirsAgain = await app.inject({ method: "GET", url: "/api/v1/membership/knowledge/answers?limit=100", headers: { cookie: cookies[1]!, ...common } });
  const theirEdges = await theirsAgain.json() as HistoryBody;
  assert.equal(theirEdges.answers.length, 1);
  assert.equal(theirEdges.answers[0]?.id, otherAnswer.answer.id);
});
