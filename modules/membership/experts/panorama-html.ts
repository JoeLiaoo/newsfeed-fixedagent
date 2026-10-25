/** Static employee preview of the panorama Markdown draft. No scripts or external assets. */

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function inline(value: string) {
  let result = escapeHtml(value);
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => `<a href="${url}" rel="noreferrer noopener">${label}</a>`);
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return result;
}

function tableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function renderBody(markdown: string) {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.trim();
    if (!line) { i++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const row = tableRow(lines[i]!);
        if (!row.every(cell => /^:?-{3,}:?$/.test(cell))) rows.push(row);
        i++;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        blocks.push(`<div class="table-scroll"><table><thead><tr>${head!.map(cell => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map(row => `<tr>${head!.map((_, index) => `<td>${inline(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      }
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) quote.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push(`<blockquote>${quote.map(item => `<p>${inline(item)}</p>`).join("")}</blockquote>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^\s*[-*]\s+(.*)$/.exec(lines[i]!);
        if (!match) break;
        items.push(`<li>${inline(match[1]!)}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*\||\s*>|\s*[-*]\s+)/.test(lines[i]!)) paragraph.push(lines[i++]!.trim());
    if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    else i++;
  }
  return blocks.join("\n");
}

export function renderPanoramaHtml(markdown: string) {
  const body = renderBody(markdown);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>对外投资全景图</title>
<style>
:root{color-scheme:light;--ink:#202624;--muted:#69726e;--line:#dfe5df;--paper:#fff;--wash:#f4f6f2;--accent:#547c62}*{box-sizing:border-box}body{margin:0;background:#edf0eb;color:var(--ink);font:15px/1.75 ui-serif,"Noto Serif SC","Songti SC",serif}.page{max-width:1180px;margin:0 auto;padding:clamp(20px,5vw,64px)}.sheet{background:var(--paper);padding:clamp(24px,5vw,68px);box-shadow:0 12px 44px #1c30200d}.masthead{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding-bottom:16px;color:var(--muted);font:11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}.eyebrow{color:var(--accent);font-weight:700}h1{font-size:clamp(32px,5vw,58px);line-height:1.15;letter-spacing:-.04em;margin:34px 0 14px}h2{font-size:26px;line-height:1.35;letter-spacing:-.025em;margin:54px 0 18px;padding-top:20px;border-top:1px solid var(--line)}h3{font:700 18px/1.5 ui-sans-serif,system-ui,sans-serif;margin:34px 0 12px;color:#33463a}p{margin:12px 0}h1+p,blockquote{font-size:17px;color:#49554d}blockquote{margin:24px 0;padding:16px 20px;border-left:3px solid var(--accent);background:var(--wash)}blockquote p{margin:3px 0}ul{padding-left:1.35em}li{padding-left:.2em;margin:5px 0}strong{color:#334d3a}code{font: .88em ui-monospace,monospace;background:var(--wash);padding:2px 5px;border-radius:4px}.table-scroll{overflow:auto;margin:18px 0 22px;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;font:13px/1.6 ui-sans-serif,system-ui,sans-serif}th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line);min-width:100px}th{font-weight:650;background:var(--wash);color:#3e5144}tr:last-child td{border-bottom:0}a{color:#386c4c;text-decoration-thickness:1px;text-underline-offset:3px}.colophon{margin-top:56px;padding-top:14px;border-top:1px solid var(--line);font:11px ui-sans-serif,system-ui,sans-serif;color:var(--muted)}@media(max-width:640px){.page{padding:0}.sheet{padding:24px 18px}h2{font-size:22px}.masthead{letter-spacing:.05em}}
</style></head><body><main class="page"><article class="sheet"><div class="masthead"><span class="eyebrow">投资关系 · 核查底稿</span><span>范围与限制请以正文为准</span></div>${body}<footer class="colophon">对外投资全景图 · 静态报告预览</footer></article></main></body></html>`;
}
