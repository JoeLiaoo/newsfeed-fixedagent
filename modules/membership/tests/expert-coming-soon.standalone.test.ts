import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { HIDDEN_BUILTIN_SLUGS, SECTOR_PEER_EXPERT, SECTOR_PEER_EXPERT_SLUG, expertStatusBadge } from "../experts/catalog.ts";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { errorText, SECTOR_PEER_SYNTHESIS_PROMPT } from "../experts/worker.ts";
import { renderSectorPeerDashboard, validateSectorPeerBoard } from "../experts/sector-peer-html.ts";
import type { PublicSearchSource } from "@aihot/backend/providers/deepseek-search";

test("old sentiment entry is hidden and the public-data expert is runnable", () => {
  assert.ok(HIDDEN_BUILTIN_SLUGS.has("company-sentiment-report"));
  assert.equal(SECTOR_PEER_EXPERT_SLUG, "sector-peer-landscape");
  assert.equal(SECTOR_PEER_EXPERT.name, "赛道同业竞争看板");
  assert.equal(SECTOR_PEER_EXPERT.version, "1.0.0");
  assert.ok(!/DeepSeek|Search API/i.test(SECTOR_PEER_EXPERT.description));
  assert.deepEqual(SECTOR_PEER_EXPERT.missingDependencies, []);
  assert.equal(expertStatusBadge("available").label, "可运行");
  assert.equal(expertStatusBadge("coming_soon").label, "开发中");
  assert.equal(expertStatusBadge("blocked").label, "缺少依赖");
  assert.match(SECTOR_PEER_EXPERT.skillMd, /可访问 URL/);
  assert.match(SECTOR_PEER_EXPERT.skillMd, /未披露／未检索到/);
});

test("HTML dashboard cites retrieved evidence and escapes the query", () => {
  const sources: PublicSearchSource[] = [{ id: "S1", queryGroup: "peers", title: "公开公司资料", url: "https://example.org/peer", snippet: "官网披露", summary: "", content: "", date: "2026-10-20", siteName: "Example" }];
  const board = { peers: [{ text: "某企业公开披露相关产品", sourceIds: ["S1"] }], stageSignals: [], capitalEvents: [], usReferences: [], gaps: [] };
  const html = renderSectorPeerDashboard({ query: '<script>alert("x")</script> 商业航天', generatedAt: new Date("2026-10-25T00:00:00Z"), board, sources });
  for (const title of ["同业是谁", "发展到哪（公开阶段信号）", "资本市场认可", "美国参考", "检索缺口", "不构成投资建议", "https://example.org/peer", "2026-10-20"]) assert.ok(html.includes(title), title);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("P0 空看板") && !html.includes("数据源未接入"));
  assert.ok(!html.includes("DeepSeek"));
});

test("unsupported model claims and URLs cannot enter the dashboard", () => {
  const source: PublicSearchSource = { id: "S1", queryGroup: "peers", title: "可用来源", url: "https://example.org/a", snippet: "", summary: "", content: "", date: null, siteName: "" };
  const safe = validateSectorPeerBoard({ peers: [{ text: "无来源断言", sourceIds: ["S999"] }], stageSignals: [], capitalEvents: [], usReferences: [], gaps: [] }, [source]);
  assert.deepEqual(safe.peers, []);
  const html = renderSectorPeerDashboard({ query: "未披露赛道", generatedAt: new Date(), board: safe, sources: [source] });
  assert.ok(html.includes("未披露／未检索到可引用的可靠公开证据"));
  assert.ok(!html.includes("无来源断言"));
});

test("empty search results leave every fact panel empty and disclose the gap", () => {
  const html = renderSectorPeerDashboard({ query: "新兴赛道", generatedAt: new Date(), board: {
    peers: [{ text: "不存在的公司获得融资", sourceIds: ["S1"] }], stageSignals: [], capitalEvents: [], usReferences: [], gaps: [],
  }, sources: [] });
  assert.ok(html.includes("未披露／未检索到可引用的可靠公开证据"));
  assert.ok(html.includes("未检索到可访问的公开来源"));
  assert.ok(html.includes("检索缺口"));
  assert.ok(!html.includes("不存在的公司获得融资"));
});

test("employee detail uses a single query field and sandboxed HTML preview", () => {
  const detail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
  assert.ok(detail.includes('name="query"'));
  assert.ok(detail.includes('srcDoc={task.result.html} sandbox=""'));
  assert.ok(detail.includes("sector_query_required"));
});

test("sector-peer synthesis explicitly requests JSON for the provider's JSON response mode", () => {
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /JSON/i);
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /没有可核实事实的栏目返回空数组/);
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /不要补造公司或事件/);
});

test("model refusals distinguish a bad request, unavailable access, and a temporary outage", () => {
  assert.deepEqual(errorText(new ProviderRejectedError("invalid JSON request", 400, false)), {
    code: "expert_model_request_invalid", message: "文字整理请求未被服务接受，任务未完成；请联系管理员检查配置和任务记录。",
  });
  assert.equal(errorText(new ProviderRejectedError("access denied", 403, false, true)).code, "expert_model_access_refused");
  assert.equal(errorText(new ProviderRejectedError("rate limited", 429, true)).code, "expert_model_rejected");
});
