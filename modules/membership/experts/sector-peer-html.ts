/** Public-data dashboard shell. No network or model calls are made in P0. */
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderSectorPeerDashboard(query: string, generatedAt: Date): string {
  const name = escapeHtml(query);
  const time = escapeHtml(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(generatedAt));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="color-scheme" content="light"><title>赛道同业竞争看板 · ${name}</title>
<style>
:root{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#202329;background:#f7f7f5}*{box-sizing:border-box}body{margin:0}main{max-width:1100px;margin:auto;padding:32px 24px 60px}header{border-bottom:1px solid #d8d9d5;padding-bottom:24px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;color:#a12d36}.label{display:inline-block;border:1px solid #c8aaa9;background:#fff2f0;color:#8d3038;border-radius:6px;padding:5px 8px;font-size:12px;font-weight:700}h1{font-size:clamp(25px,4vw,38px);line-height:1.25;margin:12px 0;overflow-wrap:anywhere}h2{font-size:19px;margin:0 0 12px}p{line-height:1.65}.muted{color:#60666d}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}.card,.band,.gaps{background:#fff;border:1px solid #dedfdb;border-radius:12px;padding:20px}.card{min-height:190px}.empty{margin-top:24px;padding:20px 12px;border:1px dashed #ccd0cd;border-radius:6px;text-align:center;color:#626970;background:#fafbf9}.band{border-left:4px solid #8c9baa}.gaps{margin-top:16px}.gaps ul{padding-left:20px;line-height:1.85}.note{margin:20px 0 0;font-size:13px;color:#626970}@media(max-width:720px){main{padding:22px 16px 44px}.grid{grid-template-columns:1fr}.card{min-height:0}}
</style></head><body><main><header><span class="eyebrow">公开资料 · 中国市场优先</span><h1>赛道同业竞争看板</h1><p><strong>查询：</strong>${name}</p><p class="muted">生成时间：${time}（北京时间）　<span class="label">P0 空看板</span></p><p class="muted">当前按输入原样展示；企业与赛道的消歧将在 P1 完成。</p></header>
<div class="grid"><section class="card" aria-labelledby="peers"><h2 id="peers">同业是谁</h2><p class="muted">中国市场同业主体与竞争边界</p><div class="empty">数据源未接入 · 暂无同业名单</div></section><section class="card" aria-labelledby="stage"><h2 id="stage">发展到哪（公开阶段信号）</h2><p class="muted">产品、客户、产能等公开进展</p><div class="empty">数据源未接入 · 暂无阶段信号</div></section><section class="card" aria-labelledby="capital"><h2 id="capital">资本市场认可（公开融资/并购/IPO 密度）</h2><p class="muted">人民币融资、境内并购与上市事件</p><div class="empty">数据源未接入 · 暂无事件或密度</div></section></div>
<section class="band" aria-labelledby="us"><h2 id="us">美国参考</h2><p class="muted">美国同业与融资仅作对照，不进入中国主名单。数据源未接入。</p></section>
<section class="gaps" aria-labelledby="gaps"><h2 id="gaps">数据缺口与待接入公开来源</h2><ul><li>企业与赛道识别、同业边界：公开公司资料与行业分类，未接入。</li><li>阶段信号：企业官网、公告及可核验公开报道，未接入。</li><li>资本事件：公开融资披露、并购公告、交易所 IPO 文件，未接入。</li><li>美国参考：公开公司披露与融资报道，未接入。</li></ul><p class="muted">后续每个数字与事件均须附来源 URL 和时间口径；无证据时标为“未披露／未检索到”。</p></section><p class="note">仅供公开信息研究参考，不构成投资建议。内部 IC 笔记、未披露估值与真实 LP 管线不在范围内。</p></main></body></html>`;
}
