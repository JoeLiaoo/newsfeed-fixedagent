// The Markdown product of the 前沿播客 result: the points and the summary of every episode that was
// read, in full, each with the source it came from. The file is what the employee keeps and quotes.
import { beijingStamp } from "@aihot/contracts/time";
import { clipped, countLine, coverageLine, dateLabel, durationLabel, editorialSourceLabel, languageLabel, MARKDOWN_TEXT_LIMIT, sourceLink, summaryDownloadUrl, type FrontierPodcastView } from "./frontier-podcast-view.ts";

function cell(value: string) {
  return value.replace(/[|\r\n\t]/g, " ").trim();
}

function episodeSection(view: FrontierPodcastView, index: number): string {
  const episode = view.episodes[index]!;
  const source = sourceLink(episode);
  const tldr = clipped(episode.tldr, MARKDOWN_TEXT_LIMIT);
  const digest = clipped(episode.digest, MARKDOWN_TEXT_LIMIT);
  const facts = [
    ["节目", episode.showName ?? "未提供"],
    ["日期", dateLabel(episode.date, episode.publishedAt)],
    ["时长", durationLabel(episode.durationMin)],
    ["摘要语言", languageLabel(episode.tldrLang ?? episode.digestLang)],
    ["原节目语言", languageLabel(episode.lang)],
    ["正文来源", editorialSourceLabel(episode)],
    ["参与者", episode.people.length ? episode.people.join("、") : "未提供"],
    ["标签", [...episode.sectors, ...episode.focus].join("、") || "未提供"],
  ].map(([key, value]) => `- ${key}：${cell(value!)}`);
  const sourceLine = source ? `- 来源：${cell(source.label)} · ${source.url}` : "- 来源：未提供";
  const downloadLine = `- 摘要文件（Markdown）：${summaryDownloadUrl(episode.slug)}`;
  return [
    `## ${index + 1}. ${cell(episode.title ?? "未提供")}`,
    ``,
    ...facts,
    sourceLine,
    downloadLine,
    ``,
    `### 要点`,
    ``,
    tldr.text ? `${tldr.text}${tldr.clipped ? "\n\n> 要点过长，已截断。" : ""}` : "该集未发布要点。",
    ``,
    `### 摘要`,
    ``,
    digest.text ? `${digest.text}${digest.clipped ? "\n\n> 摘要过长，已截断。" : ""}` : "该集未发布摘要。",
    ``,
  ].join("\n");
}

export function renderFrontierPodcastMarkdown(view: FrontierPodcastView): string {
  const sections = view.episodes.length
    ? view.episodes.map((_, index) => episodeSection(view, index))
    : ["检索没有返回可读取的节目。", ""];
  return [
    `# 前沿播客 · ${cell(view.query)}`,
    ``,
    `> 中英文检索的公开播客文字库结果。英文节目只收录该库提供中文正文的版本；正文来源逐集标明。要点与摘要是该库对原节目的整理稿，平台未逐条核验；引用前请回到来源页面核对。`,
    ``,
    `- 话题：${cell(view.query)}`,
    `- 收录：${cell(countLine(view))}`,
    `- ${cell(coverageLine(view))}`,
    `- 生成时间：${beijingStamp(view.generatedAt)}（北京时间）`,
    `- 数据来源：公开播客文字库`,
    ``,
    ...sections,
    `## 使用说明`,
    ``,
    `- 收录集数受检索接口的匹配结果限制，不代表该话题的全部节目。`,
    `- 要点与摘要只覆盖原节目已整理的内容；平台不补写节目未提及的事实、数字或结论。`,
    `- 引用某一条观点前，请打开该集的来源页面核对原文。`,
    `- 仅供公开信息研究参考，不构成投资建议。`,
    ``,
  ].join("\n");
}
