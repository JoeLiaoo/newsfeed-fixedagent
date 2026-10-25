// The 网页预览 of the 前沿播客 result: one article in the "press"（书卷）reading style of
// beautiful-article / reacticle — a masthead, a lead, the callouts that say what the result covers,
// a contents page, one section per episode, a closing note and a colophon. The document stands on its
// own — no script, no external stylesheet, no remote font or image — so it can be shown in the
// sandboxed frame of the task card.
import { beijingStamp } from "@aihot/contracts/time";
import type { PodcastEpisode } from "./bidclub.ts";
import { clipped, countLine, coverageLine, dateLabel, durationLabel, languageLabel, PREVIEW_DIGEST_LIMIT, PREVIEW_TLDR_LIMIT, sourceLink, summaryDownloadUrl, type FrontierPodcastView } from "./frontier-podcast-view.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** A link the employee can open: only http(s) addresses leave the article as links. */
function safeUrl(url: string | null) {
  if (!url) return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * The library writes its summaries as markdown. The article shows their headings, bullets and bold
 * without pulling in a markdown library: the text is escaped first, so only those marks are turned
 * into markup. Italics are dropped rather than rendered — the press protocol carries emphasis with
 * weight and rules, never with slant.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
}

/** One block of the library's markdown: a heading, a list or a paragraph. */
function renderMarkdown(markdown: string): string {
  const blocks: string[] = [];
  let items: string[] = [];
  let listTag: "ul" | "ol" = "ul";
  const flush = () => {
    if (!items.length) return;
    blocks.push(`<${listTag}>${items.join("")}</${listTag}>`);
    items = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push(`<h4>${inline(heading[1]!)}</h4>`); continue; }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listTag !== "ul") flush();
      listTag = "ul";
      if (bullet[1]!.trim()) items.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (listTag !== "ol") flush();
      listTag = "ol";
      items.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }
    flush();
    blocks.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return blocks.join("");
}

/** The contents page: one line per episode, each a link to its section. */
function contents(view: FrontierPodcastView): string {
  if (!view.episodes.length) return "";
  const items = view.episodes.map((episode, index) => {
    const label = escapeHtml(episode.title ?? "未提供");
    return `<li class="ra-toc__item"><a href="#ep-${index + 1}"><span class="ra-toc__index">${String(index + 1).padStart(2, "0")}</span><span class="ra-toc__label">${label}</span></a></li>`;
  }).join("");
  return `<nav class="ra-toc" aria-label="目录"><span class="ra-toc__title">目录</span><ol class="ra-toc__list">${items}</ol></nav>`;
}

/** The metadata row of one episode: who published it, when, how long, in which language. */
function metaLine(episode: PodcastEpisode): string {
  const rows = [
    ["节目", episode.showName ?? "未提供"],
    ["日期", dateLabel(episode.date, episode.publishedAt)],
    ["时长", durationLabel(episode.durationMin)],
    ["摘要语言", languageLabel(episode.tldrLang ?? episode.digestLang)],
  ];
  return `<div class="ra-meta">${rows.map(([key, value]) => `<span class="ra-meta-item"><strong>${escapeHtml(key!)}</strong>${escapeHtml(value!)}</span>`).join("")}</div>`;
}

/** One episode: what the library published about it, and where the employee checks it. */
function episodeSection(view: FrontierPodcastView, index: number): string {
  const episode = view.episodes[index]!;
  const source = sourceLink(episode);
  const sourceUrl = safeUrl(source?.url ?? null);
  const download = safeUrl(summaryDownloadUrl(episode.slug));
  const tldr = clipped(episode.tldr, PREVIEW_TLDR_LIMIT);
  const digest = clipped(episode.digest, PREVIEW_DIGEST_LIMIT);
  const title = escapeHtml(episode.title ?? "未提供");
  const number = String(index + 1).padStart(2, "0");

  const quote = episode.dek
    ? `<blockquote class="ra-quote"><p class="ra-quote__text">${escapeHtml(episode.dek)}</p><span class="ra-quote__by">公开播客文字库 · 本集导语</span></blockquote>`
    : "";
  const people = episode.people.length ? `<p>参与者：${escapeHtml(episode.people.join("、"))}</p>` : "";
  const tags = episode.sectors.length || episode.focus.length
    ? `<p>标签：${escapeHtml([...episode.sectors, ...episode.focus].join("、"))}</p>`
    : "";
  const sourceLine = sourceUrl
    ? `<p>原节目页面${source?.label ? `（${escapeHtml(source.label)}）` : ""}：<a class="ra-url" href="${escapeHtml(sourceUrl)}" rel="noreferrer noopener" target="_blank">${escapeHtml(sourceUrl)}</a></p>`
    : `<p>原节目页面：未提供</p>`;
  const downloadLine = download
    ? `<p>本集摘要（Markdown）：<a class="ra-url" href="${escapeHtml(download)}" rel="noreferrer noopener" target="_blank">${escapeHtml(download)}</a></p>`
    : "";
  const aside = `<aside class="ra-aside ra-aside--note"><span class="ra-aside__label">来源与标签</span><div class="ra-aside__body">${sourceLine}${downloadLine}${people}${tags}</div></aside>`;

  const tldrBlock = tldr.text
    ? `<div class="ra-subsection"><div class="ra-subsection__head"><h3 class="ra-subsection__title">要点</h3></div><div class="ra-subsection__body"><div class="ra-md">${renderMarkdown(tldr.text)}</div>${tldr.clipped ? `<p class="ra-cut">要点较长，预览已截断；全文见 Markdown 产物。</p>` : ""}</div></div>`
    : `<div class="ra-subsection"><div class="ra-subsection__head"><h3 class="ra-subsection__title">要点</h3></div><div class="ra-subsection__body"><p class="ra-md">该集未发布要点。</p></div></div>`;
  const digestBlock = digest.text
    ? `<div class="ra-subsection"><div class="ra-subsection__head"><h3 class="ra-subsection__title">摘要</h3></div><div class="ra-subsection__body"><div class="ra-md">${renderMarkdown(digest.text)}</div>${digest.clipped ? `<p class="ra-cut">摘要较长，预览已截断；全文见 Markdown 产物。</p>` : ""}</div></div>`
    : `<div class="ra-subsection"><div class="ra-subsection__head"><h3 class="ra-subsection__title">摘要</h3></div><div class="ra-subsection__body"><p class="ra-md">该集未发布摘要。</p></div></div>`;

  return `<section class="ra-section" id="ep-${index + 1}">
<div class="ra-section__head"><span class="ra-section__index">${number}</span><h2 class="ra-section__title">${title}</h2></div>
${metaLine(episode)}
${quote}
${aside}
${tldrBlock}${digestBlock}
</section>`;
}

/**
 * The stylesheet of the article: the press theme's tokens (cream paper, oxblood accent, one confident
 * colour) and the component anatomy of reacticle — hero, lead, contents, section, aside, quote,
 * conclusion, colophon. Inline, because the frame that shows the article is sandboxed: no stylesheet,
 * font or image may be fetched from outside.
 */
const ARTICLE_CSS = `
:root{
  --ra-color-bg:#fbf7ee;--ra-color-bg-tint:#fbf7ee;--ra-color-surface:#f3ecdd;--ra-color-surface-2:#eae0cd;
  --ra-color-text:#211e18;--ra-color-heading:#171410;--ra-color-muted:#6a6256;--ra-color-faint:#97907f;
  --ra-color-border:#e0d6c0;--ra-color-border-strong:#cdc1a6;
  --ra-color-accent:#7b1e22;--ra-color-accent-strong:#5a1418;--ra-color-accent-contrast:#fbf7ee;--ra-color-accent-soft:#f0e2df;
  --ra-color-risk:#c23a1e;--ra-color-risk-soft:#f5e3db;--ra-color-warn:#c23a1e;--ra-color-warn-soft:#f5e3db;
  --ra-color-success:#415a3a;--ra-color-success-soft:#e7ecdd;--ra-color-info:#7b1e22;--ra-color-info-soft:#f0e2df;
  --ra-font-body:Georgia,"Iowan Old Style","Songti SC","STSong","Noto Serif CJK SC","SimSun",serif;
  --ra-font-heading:var(--ra-font-body);
  --ra-font-label:system-ui,-apple-system,"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif;
  --ra-font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --ra-text-xs:.75rem;--ra-text-sm:.85rem;--ra-text-base:1.0625rem;--ra-text-lg:1.2rem;--ra-text-xl:1.45rem;
  --ra-text-2xl:1.85rem;--ra-text-3xl:2.3rem;--ra-text-4xl:3rem;
  --ra-leading-tight:1.15;--ra-leading-snug:1.45;--ra-leading-normal:1.7;
  --ra-weight-normal:400;--ra-weight-medium:500;--ra-weight-semibold:600;--ra-weight-bold:600;--ra-weight-black:600;
  --ra-weight-display:var(--ra-weight-normal);--ra-weight-h2:var(--ra-weight-normal);--ra-weight-h3:var(--ra-weight-semibold);
  --ra-tracking-tight:-.01em;--ra-tracking-wide:.02em;--ra-tracking-caps:.08em;
  --ra-space-1:.25rem;--ra-space-2:.5rem;--ra-space-3:.75rem;--ra-space-4:1rem;--ra-space-5:1.5rem;
  --ra-space-6:2.25rem;--ra-space-7:3.25rem;--ra-space-8:4.5rem;--ra-space-9:6rem;
  --ra-radius-sm:0;--ra-radius-md:0;--ra-radius-lg:0;--ra-radius-xl:0;--ra-radius-full:999px;
  --ra-shadow-sm:none;--ra-shadow-md:none;--ra-shadow-lg:none;
  --ra-content-width:1080px;--ra-measure:46rem;--ra-toc-width:13rem;
}
*,*::before,*::after{box-sizing:border-box}
body.ra-root{margin:0;color:var(--ra-color-text);background-color:var(--ra-color-bg);font-family:var(--ra-font-body);
  font-size:var(--ra-text-base);line-height:var(--ra-leading-normal);font-weight:var(--ra-weight-normal);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-feature-settings:"kern","liga","onum"}
body.ra-root :is(h1,h2,h3,h4){font-family:var(--ra-font-heading);line-height:var(--ra-leading-tight);
  letter-spacing:var(--ra-tracking-tight);color:var(--ra-color-heading);margin:0;text-wrap:balance}
body.ra-root h1{font-weight:var(--ra-weight-display)}
body.ra-root h2{font-weight:var(--ra-weight-h2)}
body.ra-root :is(h3,h4){font-weight:var(--ra-weight-h3)}
body.ra-root p{margin:0;text-wrap:pretty}
body.ra-root strong{font-weight:var(--ra-weight-bold);color:var(--ra-color-heading)}
body.ra-root a{color:var(--ra-color-accent);text-decoration:underline;text-decoration-color:var(--ra-color-border-strong);
  text-decoration-thickness:1px;text-underline-offset:.15em}
body.ra-root a:hover{text-decoration-color:var(--ra-color-accent)}
body.ra-root ::selection{background:var(--ra-color-surface-2)}
.ra-article-layout{max-width:var(--ra-content-width);margin:0 auto;padding:var(--ra-space-9) var(--ra-space-6) var(--ra-space-8)}
.ra-article{display:flex;flex-direction:column;gap:var(--ra-space-7);max-width:var(--ra-measure);margin:0 auto}
.ra-hero{display:flex;flex-direction:column;gap:var(--ra-space-2);padding-bottom:var(--ra-space-4);
  border-bottom:1px solid var(--ra-color-border)}
.ra-hero__eyebrow{font-family:var(--ra-font-label);font-size:var(--ra-text-xs);font-weight:var(--ra-weight-medium);
  letter-spacing:var(--ra-tracking-caps);text-transform:uppercase;color:var(--ra-color-accent)}
.ra-hero__title{font-size:var(--ra-text-4xl);font-weight:var(--ra-weight-display);line-height:var(--ra-leading-tight);
  color:var(--ra-color-heading)}
.ra-hero__subtitle{font-size:var(--ra-text-xl);line-height:var(--ra-leading-snug);color:var(--ra-color-muted)}
.ra-hero__meta{display:flex;flex-wrap:wrap;gap:var(--ra-space-1) var(--ra-space-5);margin-top:var(--ra-space-3);
  font-family:var(--ra-font-label);font-size:var(--ra-text-sm);color:var(--ra-color-muted)}
.ra-hero__meta-item{display:inline-flex;align-items:baseline;gap:.4em}
.ra-hero__meta-item strong{font-weight:var(--ra-weight-medium);color:var(--ra-color-faint);text-transform:uppercase;
  letter-spacing:var(--ra-tracking-wide);font-size:var(--ra-text-xs)}
.ra-lead{font-size:var(--ra-text-lg);line-height:var(--ra-leading-normal);color:var(--ra-color-text)}
.ra-toc{padding-top:var(--ra-space-3);border-top:1px solid var(--ra-color-border-strong)}
.ra-toc__title{display:block;font-family:var(--ra-font-label);font-size:var(--ra-text-xs);font-weight:var(--ra-weight-medium);
  letter-spacing:var(--ra-tracking-caps);text-transform:uppercase;color:var(--ra-color-faint);padding-bottom:var(--ra-space-2);
  margin-bottom:var(--ra-space-2);border-bottom:1px solid var(--ra-color-border)}
.ra-toc__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
body.ra-root .ra-toc__item a{display:flex;gap:var(--ra-space-3);padding:var(--ra-space-2) 0;border-bottom:1px solid var(--ra-color-border);
  color:var(--ra-color-text);text-decoration:none}
body.ra-root .ra-toc__item a:hover .ra-toc__label{color:var(--ra-color-accent)}
.ra-toc__index{flex:none;color:var(--ra-color-accent);font-family:var(--ra-font-label);font-size:var(--ra-text-sm);
  font-variant-numeric:tabular-nums}
.ra-toc__label{color:var(--ra-color-heading)}
.ra-aside{--ra-aside-accent:var(--ra-color-info);--ra-aside-soft:var(--ra-color-info-soft);display:flex;flex-direction:column;
  gap:var(--ra-space-2);padding:var(--ra-space-4) var(--ra-space-5);border:1px solid var(--ra-color-border-strong);
  border-left:3px solid var(--ra-aside-accent);background:var(--ra-aside-soft)}
.ra-aside--note{--ra-aside-accent:var(--ra-color-info);--ra-aside-soft:var(--ra-color-info-soft)}
.ra-aside--warning{--ra-aside-accent:var(--ra-color-warn);--ra-aside-soft:var(--ra-color-warn-soft)}
.ra-aside__label{display:flex;align-items:center;gap:.4em;color:var(--ra-aside-accent);font-weight:var(--ra-weight-semibold);
  font-size:var(--ra-text-sm)}
.ra-aside__label::before{font-size:.82em;line-height:1}
.ra-aside--note .ra-aside__label::before{content:"▸"}
.ra-aside--warning .ra-aside__label::before{content:"▲"}
.ra-aside__body{font-size:var(--ra-text-base);line-height:var(--ra-leading-normal);color:var(--ra-color-heading)}
.ra-aside__body p+p{margin-top:var(--ra-space-2)}
.ra-url{font-family:var(--ra-font-mono);font-size:var(--ra-text-xs);color:var(--ra-color-muted);word-break:break-all}
.ra-quote{margin:0;padding-left:var(--ra-space-5);border-left:2px solid var(--ra-color-border-strong);
  display:flex;flex-direction:column;gap:var(--ra-space-2)}
.ra-quote__text{font-size:var(--ra-text-lg);line-height:var(--ra-leading-snug);color:var(--ra-color-heading)}
.ra-quote__by{font-family:var(--ra-font-label);font-size:var(--ra-text-sm);color:var(--ra-color-muted)}
.ra-quote__by::before{content:"— "}
.ra-section{display:flex;flex-direction:column;gap:var(--ra-space-4);scroll-margin-top:var(--ra-space-6);
  border-top:1px solid var(--ra-color-border);padding-top:var(--ra-space-5)}
.ra-section__head{display:flex;align-items:baseline;gap:var(--ra-space-3)}
.ra-section__index{font-family:var(--ra-font-label);font-size:var(--ra-text-base);font-weight:var(--ra-weight-medium);
  color:var(--ra-color-accent);font-variant-numeric:tabular-nums}
.ra-section__title{font-size:var(--ra-text-2xl);font-weight:var(--ra-weight-h2);color:var(--ra-color-heading)}
.ra-meta{display:flex;flex-wrap:wrap;gap:var(--ra-space-1) var(--ra-space-4);font-family:var(--ra-font-label);
  font-size:var(--ra-text-sm);color:var(--ra-color-muted)}
.ra-meta-item{display:inline-flex;align-items:baseline;gap:.35em}
.ra-meta-item strong{font-weight:var(--ra-weight-medium);color:var(--ra-color-faint);font-size:var(--ra-text-xs);
  letter-spacing:var(--ra-tracking-wide)}
.ra-subsection{display:flex;flex-direction:column;gap:var(--ra-space-3)}
.ra-subsection__head{display:flex;align-items:baseline;gap:var(--ra-space-2)}
.ra-subsection__title{font-size:var(--ra-text-lg);font-weight:var(--ra-weight-h3);color:var(--ra-color-heading)}
.ra-subsection__body{display:flex;flex-direction:column;gap:var(--ra-space-4);line-height:var(--ra-leading-normal)}
.ra-md{color:var(--ra-color-text)}
.ra-md ul,.ra-md ol{margin:0;padding-left:var(--ra-space-5);display:flex;flex-direction:column;gap:var(--ra-space-3)}
.ra-md li{padding-left:.2em}
.ra-md li::marker{color:var(--ra-color-faint)}
.ra-md h4{font-size:var(--ra-text-base);font-weight:var(--ra-weight-semibold);color:var(--ra-color-heading);
  margin-top:var(--ra-space-5);padding-top:var(--ra-space-3);border-top:1px solid var(--ra-color-border)}
.ra-md>h4:first-child{margin-top:0;padding-top:0;border-top:0}
.ra-cut{font-size:var(--ra-text-sm);color:var(--ra-color-warn)}
.ra-conclusion{display:flex;flex-direction:column;gap:var(--ra-space-3);padding-top:var(--ra-space-4);
  border-top:2px solid var(--ra-color-border-strong)}
.ra-conclusion__label{font-family:var(--ra-font-label);font-size:var(--ra-text-xs);font-weight:var(--ra-weight-medium);
  letter-spacing:var(--ra-tracking-caps);text-transform:uppercase;color:var(--ra-color-accent)}
.ra-conclusion__body{font-size:var(--ra-text-lg);line-height:var(--ra-leading-normal);color:var(--ra-color-text)}
.ra-conclusion__takeaways{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--ra-space-2)}
.ra-conclusion__takeaways li{position:relative;padding-left:var(--ra-space-4);color:var(--ra-color-heading)}
.ra-conclusion__takeaways li::before{content:"→";position:absolute;left:0;color:var(--ra-color-accent)}
.ra-colophon{margin-top:var(--ra-space-6);padding-top:var(--ra-space-3);border-top:1px solid var(--ra-color-border);
  font-family:var(--ra-font-label);font-size:var(--ra-text-xs);line-height:var(--ra-leading-snug);color:var(--ra-color-faint)}
@media(max-width:720px){
  .ra-article-layout{padding:var(--ra-space-6) var(--ra-space-4) var(--ra-space-7)}
  .ra-hero__title{font-size:calc(var(--ra-text-3xl) * 1.05)}
  .ra-hero__subtitle{font-size:var(--ra-text-lg)}
  .ra-section__title{font-size:var(--ra-text-xl)}
  .ra-aside{padding:var(--ra-space-3) var(--ra-space-4)}
}
`;

export function renderFrontierPodcastHtml(view: FrontierPodcastView): string {
  const query = escapeHtml(view.query);
  const time = escapeHtml(beijingStamp(view.generatedAt));
  const count = escapeHtml(countLine(view));
  const coverage = escapeHtml(coverageLine(view));
  const partial = view.partial ? "结果不完整" : "完整匹配";

  const hero = `<header class="ra-hero">
<span class="ra-hero__eyebrow">公开播客文字库 · 中文摘要优先</span>
<h1 class="ra-hero__title">前沿播客</h1>
<p class="ra-hero__subtitle">话题：${query}</p>
<div class="ra-hero__meta">
<span class="ra-hero__meta-item"><strong>收录</strong>${count}</span>
<span class="ra-hero__meta-item"><strong>范围</strong>${partial}</span>
<span class="ra-hero__meta-item"><strong>生成</strong>${time}（北京时间）</span>
</div></header>`;

  const lead = `<p class="ra-lead">下面是你检索「${query}」在公开播客文字库里得到的结果：收录 ${count}。每一集给出该库整理的要点与摘要，以及原节目页面；要点与摘要是整理稿，平台未逐条核验，引用前请回到来源页面核对原文。</p>`;

  const scopeAside = view.partial
    ? `<aside class="ra-aside ra-aside--warning"><span class="ra-aside__label">结果不完整</span><div class="ra-aside__body"><p>${coverage}</p><p>下面的目录就是这次检索命中的全部内容。</p><p>收录集数受检索接口的匹配结果限制，不代表该话题的全部节目。平台不补写节目未提及的事实、数字与结论。</p></div></aside>`
    : `<aside class="ra-aside ra-aside--note"><span class="ra-aside__label">结果覆盖</span><div class="ra-aside__body"><p>${coverage}</p><p>收录集数受检索接口的匹配结果限制，不代表该话题的全部节目。平台不补写节目未提及的事实、数字与结论。</p></div></aside>`;

  const sections = view.episodes.length
    ? view.episodes.map((_, index) => episodeSection(view, index)).join("\n")
    : `<section class="ra-section"><div class="ra-section__head"><span class="ra-section__index">—</span><h2 class="ra-section__title">没有可展示的节目</h2></div><p>检索没有返回可读取的节目，请换一个话题再试。</p></section>`;

  const conclusion = `<section class="ra-conclusion">
<span class="ra-conclusion__label">使用说明</span>
<div class="ra-conclusion__body"><p>这份摘要只整理公开播客文字库已经整理过的内容。引用某一条观点前，请打开该集的来源页面核对原文。</p></div>
<ul class="ra-conclusion__takeaways">
<li>收录集数受检索接口的匹配结果限制，不等于该话题的全部节目。</li>
<li>要点与摘要只覆盖原节目已整理的内容；平台不补写节目未提及的事实、数字或结论。</li>
<li>每集的完整摘要另有 Markdown 文件，可在任务卡片下载。</li>
<li>仅供公开信息研究参考，不构成投资建议。</li>
</ul></section>`;

  const colophon = `<footer class="ra-colophon"><p>本文由平台自动生成 · 版式参考 beautiful-article（press 主题）· 数据来源：公开播客文字库 · 生成时间 ${time}（北京时间）</p></footer>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="color-scheme" content="light"><title>前沿播客 · ${query}</title>
<style>${ARTICLE_CSS}</style></head>
<body class="ra-root" data-theme="press">
<div class="ra-article-layout"><article class="ra-article">
${hero}
${lead}
${scopeAside}
${contents(view)}
${sections}
${conclusion}
${colophon}
</article></div></body></html>`;
}
