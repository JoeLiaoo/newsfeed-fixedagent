import { beijingStamp } from "@aihot/contracts/time";
import type { PublicSearchSource } from "@aihot/backend/providers/deepseek-search";
import type { SectorPeerBoard, SectorPeerClaim } from "./sector-peer-board.ts";

export type { SectorPeerBoard, SectorPeerClaim };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeClaims(claims: SectorPeerClaim[], allowedIds: Set<string>) {
  return claims.flatMap(claim => {
    const ids = [...new Set(claim.sourceIds)].filter(id => allowedIds.has(id));
    const text = claim.text.trim().slice(0, 1200);
    return text && ids.length ? [{ text, sourceIds: ids }] : [];
  });
}

function renderClaims(claims: SectorPeerClaim[], sources: Map<string, PublicSearchSource>) {
  if (!claims.length) return `<p class="empty">未披露／未检索到可引用的可靠公开证据。</p>`;
  return `<ul class="claims">${claims.map(claim => {
    const citations = claim.sourceIds.map(id => sources.get(id)).filter((source): source is PublicSearchSource => !!source);
    return `<li><p>${escapeHtml(claim.text)}</p><div class="citations">${citations.map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><span>${escapeHtml(source.date ? `来源日期：${source.date}` : "来源日期：未提供")}</span>`).join("")}</div></li>`;
  }).join("")}</ul>`;
}

export function validateSectorPeerBoard(board: SectorPeerBoard, retrievedSources: PublicSearchSource[]): SectorPeerBoard {
  const allowedIds = new Set(retrievedSources.map(source => source.id));
  const validGaps = board.gaps.map(gap => gap.trim().slice(0, 500)).filter(Boolean).slice(0, 12);
  return {
    peers: safeClaims(board.peers, allowedIds), stageSignals: safeClaims(board.stageSignals, allowedIds),
    capitalEvents: safeClaims(board.capitalEvents, allowedIds), usReferences: safeClaims(board.usReferences, allowedIds),
    gaps: validGaps.length ? validGaps : ["当前公开检索未能覆盖所有公司、交易与时间口径；未检索到的事项不代表不存在。"],
  };
}

export function renderSectorPeerDashboard(input: {
  query: string; generatedAt: Date; board: SectorPeerBoard; sources: PublicSearchSource[];
}): string {
  const name = escapeHtml(input.query);
  const time = escapeHtml(beijingStamp(input.generatedAt));
  const board = validateSectorPeerBoard(input.board, input.sources);
  const sourceMap = new Map(input.sources.map(source => [source.id, source]));
  const section = (id: string, title: string, subtitle: string, claims: SectorPeerClaim[]) =>
    `<section class="card" aria-labelledby="${id}"><h2 id="${id}">${title}</h2><p class="muted">${subtitle}</p>${renderClaims(claims, sourceMap)}</section>`;
  const sourceList = input.sources.length
    ? `<ol class="sources">${input.sources.map(source => `<li><span class="source-id">${escapeHtml(source.id)}</span><div><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><p>${escapeHtml(source.siteName || new URL(source.url).hostname)} · ${escapeHtml(source.date ? `页面日期：${source.date}` : "页面日期：未提供")}</p></div></li>`).join("")}</ol>`
    : `<p class="empty">未检索到可访问的公开来源，所有事实区均留空。</p>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="color-scheme" content="light"><title>赛道同业竞争看板 · ${name}</title>
<style>
:root{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#202329;background:#f7f7f5}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 24px 60px}header{border-bottom:1px solid #d8d9d5;padding-bottom:24px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;color:#a12d36}h1{font-size:clamp(25px,4vw,38px);line-height:1.25;margin:12px 0;overflow-wrap:anywhere}h2{font-size:19px;margin:0 0 10px}p{line-height:1.65}.muted{color:#60666d}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}.card,.band,.gaps,.sources-card{background:#fff;border:1px solid #dedfdb;border-radius:12px;padding:20px}.card{min-height:190px}.claims,.sources,.gaps ul{padding-left:22px;line-height:1.65}.claims li,.sources li{padding:8px 0}.claims li+li,.sources li+li{border-top:1px solid #eceeeb}.citations{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:13px}.citations a,.sources a{color:#8d2932;text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}.citations span,.sources p{color:#656b71;font-size:12px;margin:2px 0}.empty{padding:14px;border-radius:8px;background:#f5f6f4;color:#5f656b}.band{border-left:4px solid #8c9baa}.gaps,.sources-card{margin-top:16px}.sources{list-style:none;padding:0}.sources li{display:flex;gap:12px}.source-id{font-size:12px;font-weight:700;color:#555;min-width:28px}.note{margin:20px 0 0;font-size:13px;color:#626970}@media(max-width:760px){main{padding:22px 16px 44px}.grid{grid-template-columns:1fr}.card{min-height:0}}
</style></head><body><main><header><span class="eyebrow">公开资料 · 中国市场优先</span><h1>赛道同业竞争看板</h1><p><strong>查询：</strong>${name}</p><p class="muted">生成时间：${time}（北京时间） · 检索公开网页资料</p><p class="muted">企业与赛道按原始查询词检索；公开披露不完整，引用内容需回到来源核对。</p></header>
<div class="grid">${section("peers", "同业是谁", "中国同业与竞争边界", board.peers)}${section("stage", "发展到哪（公开阶段信号）", "产品、客户与产能等公开进展", board.stageSignals)}${section("capital", "资本市场认可（公开融资／境内并购／IPO）", `本次检索整理出 ${board.capitalEvents.length} 条有来源事件；不代表全量市场密度`, board.capitalEvents)}</div>
<section class="band" aria-labelledby="us"><h2 id="us">美国参考</h2><p class="muted">仅作对照，不进入中国同业主名单。</p>${renderClaims(board.usReferences, sourceMap)}</section>
<section class="gaps" aria-labelledby="gaps"><h2 id="gaps">检索缺口</h2><ul>${board.gaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join("")}</ul></section>
<section class="sources-card" aria-labelledby="sources"><h2 id="sources">检索来源</h2>${sourceList}</section>
<p class="note">信息来自可访问的公开网页，来源页面日期仅在页面或检索结果提供时展示；未披露／未检索到不代表相关事项不存在。本看板不构成投资建议。</p></main></body></html>`;
}
