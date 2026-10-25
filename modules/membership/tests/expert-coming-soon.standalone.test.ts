import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { HIDDEN_BUILTIN_SLUGS, SECTOR_PEER_EXPERT, SECTOR_PEER_EXPERT_SLUG, expertStatusBadge } from "../experts/catalog.ts";
import { renderSectorPeerDashboard } from "../experts/sector-peer-html.ts";

test("old sentiment entry is hidden and the public-data expert is runnable", () => {
  assert.ok(HIDDEN_BUILTIN_SLUGS.has("company-sentiment-report"));
  assert.equal(SECTOR_PEER_EXPERT_SLUG, "sector-peer-landscape");
  assert.equal(SECTOR_PEER_EXPERT.name, "赛道同业竞争看板");
  assert.deepEqual(SECTOR_PEER_EXPERT.missingDependencies, []);
  assert.equal(expertStatusBadge("available").label, "可运行");
  assert.match(SECTOR_PEER_EXPERT.skillMd, /来源 URL/);
  assert.match(SECTOR_PEER_EXPERT.skillMd, /未披露／未检索到/);
});

test("P0 HTML shell has the locked sections and escapes a raw query", () => {
  const html = renderSectorPeerDashboard('<script>alert("x")</script> 商业航天', new Date("2026-10-25T00:00:00Z"));
  for (const title of ["同业是谁", "发展到哪（公开阶段信号）", "资本市场认可（公开融资/并购/IPO 密度）", "美国参考", "数据缺口与待接入公开来源", "不构成投资建议", "数据源未接入", "P0 空看板"]) assert.ok(html.includes(title), title);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("http://") && !html.includes("https://"));
});

test("employee detail uses a single query field and sandboxed HTML preview", () => {
  const detail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
  assert.ok(detail.includes('name="query"'));
  assert.ok(detail.includes('srcDoc={task.result.html} sandbox=""'));
  assert.ok(detail.includes("sector_query_required"));
});
