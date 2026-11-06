import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { allianceInstitutionOptions } from "../gp/alliance.ts";
import { parseAllianceMarkdown, parseAllianceZip, provinceFromXiniuRegion, sectorTagsFromXiniu } from "../gp/alliance-xiniu.ts";
import { importSourceUrl, parseGpDump } from "../gp/dump.ts";
import { projectCardFundLine, projectQueryFilters, type ProjectCollection } from "../pages/projects/project-collection.ts";

const invested: ProjectCollection = { title: "已投GP直投项目", path: "/projects/invested-gp" };
const alliance: ProjectCollection = { title: "中信股权联盟直投项目", path: "/projects/citic-alliance", group: "citic-alliance", institutions: { label: "投资机构", allLabel: "全部" } };

test("project pages drop the matched toggle and the alliance card uses the investor", () => {
  const list = readFileSync(new URL("../pages/projects/project-list.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../module.ts", import.meta.url), "utf8");
  assert.equal(list.includes("全部已核实"), false);
  assert.equal(list.includes("与我关注匹配"), false);
  assert.equal(routes.includes("market-leaders"), false);
  assert.equal(existsSync(new URL("../pages/projects/market-leaders.tsx", import.meta.url)), false);
  const filters = projectQueryFilters(alliance, new URLSearchParams("motherFund=中信金石&subfund=不应保留&sector=人工智能"));
  assert.deepEqual(filters, { motherFund: "中信金石", subfund: "", sector: "人工智能", province: "" });
  assert.equal(projectQueryFilters(invested, new URLSearchParams("subfund=子基金甲")).subfund, "子基金甲");
  assert.equal(projectCardFundLine(alliance, { mother_fund_name: "中信金石", subfund_name: "不会显示", project_province: "浙江省" }), "投资机构：中信金石 · 项目区域（省）：浙江省");
  assert.equal(projectCardFundLine(invested, { mother_fund_name: null, subfund_name: null, project_province: "未知" }).includes("子基金：未知"), true);
});

test("alliance investor options stay inside the two institutions", () => {
  assert.deepEqual(allianceInstitutionOptions([]), ["中信金石", "中信建投资本"]);
  assert.deepEqual(allianceInstitutionOptions(["母基金甲", "中信金石", "未知"]), ["中信金石"]);
});

test("xiniu rows map industry and province and keep the first company in an institution", () => {
  const header = "| 序号 | 公司名 | 简介 | 烯牛行业 | 成立日期 | 地区 | 最新融资日期 | 最新融资轮次 | 烯牛推测轮次 | 最新融资金额 | 投资方 |";
  const rule = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const parsed = parseAllianceMarkdown([
    ["中信金石项目/page-001.md", [header, rule, "| 1 | 玻芯成 | 简介 | 先进制造 | 2020-01-02 | 重庆市 > 涪陵区 | 2024-03-04 | A轮 | A轮 | 未披露 | 中信金石 |", "| 2 | 玻芯成 | 较旧 | 医疗 | 2020-01-02 | 合肥市 > 蜀山区 | 2023-01-01 | 天使轮 | 天使轮 | 1亿 | 中信金石 |"].join("\n")],
    ["中信建投资本项目/page-001.md", [header, rule, "| 1 | 玻芯成 | 另一机构 | 人工智能 | 2019-05-06 | 省直辖县级行政区划 | 2024-08-09 | B轮 | B轮 | 未披露 | 中信建投资本 |"].join("\n")],
  ]);
  assert.equal(parsed.projects.length, 2);
  const jinshi = parsed.projects.find((project) => project.institution === "中信金石");
  const capital = parsed.projects.find((project) => project.institution === "中信建投资本");
  assert.equal(jinshi?.summary, "简介");
  assert.deepEqual(jinshi?.sectorTags, ["其他"]);
  assert.equal(jinshi?.projectProvince, "重庆市");
  assert.equal(jinshi?.eventDate, "2024-03-04");
  assert.deepEqual(capital?.sectorTags, ["人工智能"]);
  assert.equal(capital?.projectProvince, null);
  assert.equal(provinceFromXiniuRegion("合肥市 > 蜀山区"), "安徽省");
  assert.deepEqual(sectorTagsFromXiniu("半导体、光伏"), ["半导体与集成电路", "光伏"]);
  assert.equal(parsed.projects[0]?.investeeKey, parsed.projects[1]?.investeeKey);
});

test("a stored zip round-trips alliance markdown", () => {
  const body = "| 序号 | 公司名 | 简介 | 烯牛行业 | 成立日期 | 地区 | 最新融资日期 | 最新融资轮次 | 烯牛推测轮次 | 最新融资金额 | 投资方 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 示例公司 | 简介 | 机器人 | 2021-01-01 | 杭州市 > 西湖区 | 2024-02-02 | A轮 | A轮 | 未披露 | 中信金石 |\n";
  const parsed = parseAllianceZip(storedZip("中信金石项目/page-001.md", body));
  assert.equal(parsed.files, 1);
  assert.equal(parsed.projects[0]?.institution, "中信金石");
  assert.equal(parsed.projects[0]?.projectProvince, "浙江省");
  assert.deepEqual(parsed.projects[0]?.sectorTags, ["机器人与自动化"]);
});

test("the real alliance zip parses both institutions when it is present", () => {
  const path = "uploads/nf-alliance-pages.zip";
  if (!existsSync(path)) return;
  const parsed = parseAllianceZip(readFileSync(path));
  assert.equal(parsed.files, 55);
  assert.ok(parsed.projects.length > 100);
  assert.equal(new Set(parsed.projects.map((project) => project.institution)).size, 2);
  assert.equal(parsed.projects.some((project) => project.companyName === "玻芯成"), true);
});

test("gp dump accepts the fixture and a csv, and empty sources become placeholders", () => {
  const fixture = parseGpDump(readFileSync(new URL("./fixtures/gp-investments.sample.json", import.meta.url), "utf8"), "sample.json");
  assert.equal(fixture.gps[0]?.canonicalName, "FIXTURE-GP-不要导入生产");
  assert.equal(fixture.investments[0]?.projectProvince, "浙江省");
  assert.equal(importSourceUrl(fixture.investments[0]!.investeeKey, null).placeholder, true);
  const csv = parseGpDump("gp_name,entity_id,source_ref,investee_key,investee_name,sector_tags,event_date,source_url,project_province\n示例管理人有限公司,entity-1,测试来源说明足够长,company-1,示例被投,人工智能,2024-01-02,https://evidence.example/a,浙江省\n", "dump.csv");
  assert.equal(csv.gps.length, 1);
  assert.equal(csv.investments[0]?.motherFundName, null);
  assert.throws(() => parseGpDump(JSON.stringify({ gps: [], investments: [{ gp_name: "没有主体", investee_key: "k", investee_name: "公司" }] })), /没有对应主体/);
});

function storedZip(name: string, body: string): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const data = Buffer.from(body, "utf8");
  const checksum = crc32(data);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, eocd]);
}
