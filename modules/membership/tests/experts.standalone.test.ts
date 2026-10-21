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

test("mock Xinhua profile lookup follows the selected ID and only falls back to an exact credit code", async () => {
  const selected = { id: "company-A", name: "同名企业", status: null, creditCode: null, address: null, startDate: null };
  const requests: Array<{ query: string; query_type: string }> = [];
  const profile = await querySelectedCompanyProfile(async (_tool, args) => {
    requests.push(args as { query: string; query_type: string });
    return { company_id: "company-A", company_name: "同名企业" };
  }, selected);
  assert.deepEqual(requests, [{ query: "company-A", query_type: "company_id" }]);
  assert.equal(profile.query, "company-A");
  await assert.rejects(querySelectedCompanyProfile(async () => { throw new Error("ID lookup unsupported"); }, selected), /xinhua_identity_unverified/);
  const withCode = { ...selected, creditCode: "91310000ABCDEF1234" };
  const fallbackCalls: string[] = [];
  const fallback = await querySelectedCompanyProfile(async (_tool, args) => {
    fallbackCalls.push(String(args.query));
    if (args.query_type === "company_id") throw new Error("unsupported");
    return { company_name: "同名企业", credit_code: "91310000ABCDEF1234" };
  }, withCode);
  assert.deepEqual(fallbackCalls, ["company-A", "91310000ABCDEF1234"]);
  assert.equal(fallback.queryType, "credit_code");
});

test("investment parsing preserves numeric fields, top-level arrays, nested pages and completeness metadata", () => {
  const page = parseInvestmentPage({ data: { result: { items: [{ company_name: "被投企业", stock_percent: 12.5, should_capi: 3000 }] }, total_count: 3, has_more: true } });
  assert.equal(page.rows.length, 1);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, true);
  const [row] = mapInvestmentEvidence(page.rows, "测试工具");
  assert.equal(row?.pct, "12.5");
  assert.equal(row?.subscribed, "3000");
  assert.equal(parseInvestmentPage([{ company_name: "A" }, { company_name: "B" }]).rows.length, 2);
});

test("mock Xinhua pagination reports all pages and flags a provider that repeats a page", async () => {
  const offsets: number[] = [];
  const complete = await investmentEvidence(async (_tool, args) => {
    const offset = Number(args.offset);
    offsets.push(offset);
    const size = offset === 0 ? 100 : 20;
    return { data: { items: Array.from({ length: size }, (_, index) => ({ company_id: `company-${offset + index}`, company_name: `被投企业${offset + index}`, stock_percent: 15 })) }, total_count: 120, has_more: offset === 0 };
  }, "selected-company", "company_id");
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(complete.rows.length, 120);
  assert.equal(complete.total, 120);
  assert.equal(complete.fetched, 120);
  assert.equal(complete.partial, false);
  const repeated = await investmentEvidence(async () => ({ data: { items: Array.from({ length: 100 }, (_, index) => ({ company_id: `same-${index}`, company_name: `被投企业${index}` })) } }), "selected-company", "company_id");
  assert.equal(repeated.partial, true);
});

test("skill dependencies are structured and unsupported tools and skills block text-only execution", () => {
  const skill = parseSkillMarkdown(`---\nname: Research\ndescription: Research task\ndependencies:\n  tools:\n    - get_company_profile\n  skills:\n    - investment-review@^1.0.0\n---\nPlease research.\n`);
  assert.deepEqual(skill.manifest, { tools: ["get_company_profile"], skills: ["investment-review@^1.0.0"] });
  assert.deepEqual(skill.missingDependencies, ["工具依赖（纯文本模式不可用）：get_company_profile", "未发布的技能依赖：investment-review@^1.0.0"]);
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
