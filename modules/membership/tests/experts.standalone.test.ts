import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillMarkdown, parseSkillUpload } from "../experts/import.ts";
import { strToU8, zipSync } from "fflate";
import { mapInvestmentEvidence, parseInvestmentPage, querySelectedCompanyProfile, verifySelectedEntity } from "../experts/data.ts";
import { investmentEvidence } from "../experts/worker.ts";

test("confirmed entity identity rejects same-name company with another unique ID", () => {
  const selected = { id: "company-A", name: "同名企业", status: null, creditCode: null, address: null, startDate: null };
  assert.deepEqual(verifySelectedEntity(selected, { company_id: "company-A", company_name: "同名企业" }), { ok: true });
  assert.deepEqual(verifySelectedEntity(selected, { company_id: "company-B", company_name: "同名企业" }), { ok: false, reason: "entity_id_mismatch" });
  assert.deepEqual(verifySelectedEntity(selected, { company_name: "同名企业" }), { ok: false, reason: "entity_identity_unverified" });
  assert.deepEqual(verifySelectedEntity({ ...selected, creditCode: "91310000ABCDEF1234" }, { company_name: "同名企业", credit_code: "91310000ABCDEF1234" }), { ok: true });
});

test("mock Xinhua profile lookup uses schema-supported selectors and verifies the selected entity", async () => {
  const selected = { id: "company-A", name: "同名企业", status: null, creditCode: null, address: null, startDate: null };
  const requests: Array<Record<string, unknown>> = [];
  const profile = await querySelectedCompanyProfile(async (_tool, args) => {
    requests.push(args);
    return { company_id: "company-A", company_name: "同名企业" };
  }, selected);
  assert.equal(requests[0]?.query, "同名企业");
  assert.equal(requests[0]?.query_type, "company_name");
  assert.equal(profile.query, "同名企业");
  const withCode = { ...selected, creditCode: "91310000ABCDEF1234" };
  const codeCalls: Array<Record<string, unknown>> = [];
  const byCode = await querySelectedCompanyProfile(async (_tool, args) => {
    codeCalls.push(args);
    return { company_id: "company-A", company_name: "同名企业", credit_code: withCode.creditCode };
  }, withCode);
  assert.equal(codeCalls.length, 1);
  assert.equal(codeCalls[0]?.query, withCode.creditCode);
  assert.equal(codeCalls[0]?.query_type, "credit_code");
  assert.equal(byCode.queryType, "credit_code");

  const fallbackCalls: Array<Record<string, unknown>> = [];
  const fallback = await querySelectedCompanyProfile(async (_tool, args) => {
    fallbackCalls.push(args);
    if (args.query_type === "credit_code") return { not_found: true };
    return { company_id: "company-A", company_name: "同名企业", credit_code: "91310000ABCDEF1234" };
  }, withCode);
  assert.deepEqual(fallbackCalls.map(call => call.query_type), ["credit_code", "company_name"]);
  assert.equal(fallback.queryType, "company_name");
});

test("investment parsing preserves numeric fields, top-level arrays, nested pages and completeness metadata", () => {
  const page = parseInvestmentPage({ data: { result: { items: [{ company_name: "被投企业", stock_percent: 12.5, should_capi: 3000 }] }, total_count: 3, has_more: true } });
  assert.equal(page.rows.length, 1);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, true);
  const livePage = parseInvestmentPage({
    direct_investment_info: [{ record_id: "provider-row-1", company_id: "investee-1", dates: "2025-12-31" }],
    pagination: { limit: 50, offset: 0, count: 1, has_more: true, next_offset: 1 },
  });
  assert.equal(livePage.total, null, "pagination.count is this page's count, not the inventory total");
  assert.equal(livePage.hasMore, true);
  assert.equal(livePage.nextOffset, 1);
  assert.equal(parseInvestmentPage({ direct_investment_info: [{ record_id: "r1" }], pagination: { count: 1, has_more: true, next_offset: "bad" } }).nextOffset, Number.NaN);
  const [row] = mapInvestmentEvidence(page.rows, "测试工具");
  assert.equal(row?.pct, "12.5");
  assert.equal(row?.subscribed, "3000");
  const normalized = mapInvestmentEvidence([{ company_name: "公司", dates: "2025-12-31", update_time: "2026-01-02" }], "测试工具")[0];
  assert.equal(normalized?.date, null, "provider data dates are not investment event dates");
  assert.equal(parseInvestmentPage([{ company_name: "A" }, { company_name: "B" }]).rows.length, 2);
});

test("mock Xinhua pagination reports all pages and flags a provider that repeats a page", async () => {
  const offsets: number[] = [];
  const complete = await investmentEvidence(async (_tool, args) => {
    const offset = Number(args.offset);
    offsets.push(offset);
    const size = offset === 0 ? 50 : 20;
    return { direct_investment_info: Array.from({ length: size }, (_, index) => ({ record_id: `record-${offset + index}`, company_id: `company-${offset + index}`, company_name: `被投企业${offset + index}`, stock_percent: 15 })), pagination: { count: size, has_more: offset === 0, next_offset: offset === 0 ? 50 : null } };
  }, "selected-company", "company_id");
  assert.deepEqual(offsets, [0, 50]);
  assert.equal(complete.rows.length, 70);
  assert.equal(complete.total, null, "page count metadata is not a total inventory count");
  assert.equal(complete.fetched, 70);
  assert.equal(complete.partial, false);
  const repeated = await investmentEvidence(async () => ({ data: { items: Array.from({ length: 50 }, (_, index) => ({ record_id: `same-${index}`, company_id: `company-${index}`, company_name: `被投企业${index}` })) }, pagination: { count: 50, has_more: true, next_offset: 50 } }), "selected-company", "company_id");
  assert.equal(repeated.partial, true);
});

test("skill dependencies are structured and unsupported tools and skills block text-only execution", () => {
  const skill = parseSkillMarkdown(`---\nname: Research\ndescription: Research task\ndependencies:\n  tools:\n    - get_company_profile\n  skills:\n    - investment-review@^1.0.0\n---\nPlease research.\n`);
  assert.deepEqual(skill.manifest, { tools: ["get_company_profile"], skills: ["investment-review@^1.0.0"] });
  assert.deepEqual(skill.missingDependencies, ["新华财经适配需要同时声明主体检索、企业画像和直接投资三个工具", "未发布的技能依赖：investment-review@^1.0.0"]);
  const cycle = parseSkillMarkdown(`---\nname: Research\ndescription: Research task\nskills:\n  - research@1.0.0\n---\n`);
  assert.deepEqual(cycle.missingDependencies, ["循环技能依赖：research@1.0.0"]);
  assert.throws(() => parseSkillMarkdown(`---\nname: Unknown\ndescription: Unknown dependency\nrequires:\n  mcp: any-tool\n---\n`), /skill_dependencies_invalid/);
  assert.throws(() => parseSkillMarkdown(`---\nname: Bad\ndescription: Bad dependency declaration\ndependencies: invalid\n---\n`), /skill_dependencies_invalid/);
});

test("ZIP importer rejects extra entries, malformed manifest and archive traversal", () => {
  const goodMd = strToU8("---\nname: Safe\ndescription: Safe skill\n---\nText only.\n");
  const extra = zipSync({ "manifest.json": strToU8("{}"), "SKILL.md": goodMd, "payload.js": strToU8("alert(1)") });
  assert.throws(() => parseSkillUpload("skill.zip", Buffer.from(extra).toString("base64")), /zip_package_layout_invalid/);
  const badManifest = zipSync({ "manifest.json": strToU8("[]"), "SKILL.md": goodMd });
  assert.throws(() => parseSkillUpload("skill.zip", Buffer.from(badManifest).toString("base64")), /manifest_json_invalid/);
  const traversal = zipSync({ "manifest.json": strToU8("{}"), "SKILL.md": goodMd, "../SKILL.md": goodMd });
  assert.throws(() => parseSkillUpload("skill.zip", Buffer.from(traversal).toString("base64")), /zip_path_unsafe/);
});

test("ZIP import carries SKILL frontmatter dependencies into the normalized package manifest",()=>{
  const skill=`---\nname: Tool Research\ndescription: Requires a platform tool\ndependencies:\n  tools:\n    - get_direct_investment\n---\nRead the investment data.\n`;
  const single=parseSkillMarkdown(skill);
  const archive=zipSync({"manifest.json":strToU8("{}"),"SKILL.md":strToU8(skill)});
  const zipped=parseSkillUpload("tool-research.zip",Buffer.from(archive).toString("base64"));
  assert.deepEqual(zipped.manifest,single.manifest);
  assert.deepEqual(zipped.missingDependencies,single.missingDependencies);
  assert.deepEqual(zipped.missingDependencies,["新华财经适配需要同时声明主体检索、企业画像和直接投资三个工具"]);
  const unsafe=zipSync({"manifest.json":strToU8('{"unknownDependencyField":[]}'),"SKILL.md":strToU8(skill)});
  assert.throws(()=>parseSkillUpload("unknown.zip",Buffer.from(unsafe).toString("base64")),/manifest_dependencies_invalid/);
});
