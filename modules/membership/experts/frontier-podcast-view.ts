// What both presentations of the 前沿播客 result read: the same episodes, the same limits and the
// same words about what the result covers. The two renderers differ in shape, not in facts.
import { PODCAST_API_BASE, podcastSummaryUrl, type PodcastEpisode } from "./bidclub.ts";

export type FrontierPodcastView = {
  /** The topic the employee asked for, as typed. */
  query: string;
  episodes: PodcastEpisode[];
  /** The search answered with a fallback match over recent episodes: the result is not the whole library. */
  partial: boolean;
  /** How many recent episodes the fallback searched. */
  searchedRecent: number | null;
  /** How many of the chosen matches could not be read. */
  failed: number;
  generatedAt: Date;
};

/** The points are read in full in the Markdown product; the preview keeps the head of them. */
export const PREVIEW_TLDR_LIMIT = 1_200;
export const PREVIEW_DIGEST_LIMIT = 1_200;
/** The Markdown product carries the published text; a record longer than this is cut and says so. */
export const MARKDOWN_TEXT_LIMIT = 20_000;

/** The language a text is written in, in the words the employee reads. */
export function languageLabel(lang: string | null) {
  if (!lang) return "未提供";
  if (lang === "ZH") return "中文";
  if (lang === "EN") return "英文";
  return lang;
}

/** The episode's length, in minutes; a library that did not say is "未提供". */
export function durationLabel(minutes: number | null) {
  return minutes === null ? "未提供" : `${minutes} 分钟`;
}

/** The episode's date, as the library published it; nothing is converted into an event date. */
export function dateLabel(date: string | null, publishedAt: string | null) {
  return date ?? publishedAt?.slice(0, 10) ?? "未提供";
}

/** The original episode's own page, which is where the employee checks the summary. */
export function sourceLink(episode: PodcastEpisode) {
  return episode.sourceUrl ? { url: episode.sourceUrl, label: episode.sourceLabel ?? "原始节目页" } : null;
}

/** The library's own summary download for one episode. */
export function summaryDownloadUrl(slug: string) {
  return podcastSummaryUrl(PODCAST_API_BASE, slug);
}

/** A text and whether it was cut, so both presentations say the same thing about it. */
export function clipped(text: string | null, limit: number) {
  if (!text) return { text: null, clipped: false };
  if (text.length <= limit) return { text, clipped: false };
  // A cut can land on a list marker; the dangling dash would read as an empty point.
  return { text: text.slice(0, limit).replace(/\s*[-*]\s*$/, "").trimEnd(), clipped: true };
}

/** The line both presentations use for what the result covers. */
export function coverageLine(view: FrontierPodcastView) {
  if (view.partial) {
    const window = view.searchedRecent ? `最近 ${view.searchedRecent} 集` : "最近的节目";
    return `结果不完整：检索回退到${window}的子串匹配，可能遗漏更早的相关内容。`;
  }
  return "结果范围：检索接口返回的完整匹配结果。";
}

/** The line both presentations use for how many episodes the report holds. */
export function countLine(view: FrontierPodcastView) {
  const base = `${view.episodes.length} 集`;
  return view.failed ? `${base}，另有 ${view.failed} 集读取失败未收录` : `${base}，全部读取成功`;
}
