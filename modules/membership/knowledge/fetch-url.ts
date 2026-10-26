import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

export type FetchedArticle = {
  url: string;
  title: string | null;
  author: string | null;
  organization: string | null;
  date: string | null;
  text: string;
};

function first($: ReturnType<typeof load>, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content")?.trim();
    if (value) return value.slice(0, 500);
  }
  return null;
}

function calendarDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

/** Extracts the page's published metadata and readable body without running page scripts. */
export function parsePublicArticle(html: string, url: string): FetchedArticle {
  const $ = load(html);
  const title = first($, ["meta[property='og:title']", "meta[name='twitter:title']"]) ?? ($("title").first().text().trim().slice(0, 500) || null);
  const author = first($, ["meta[name='author']", "meta[property='article:author']", "meta[name='byl']"]);
  const organization = first($, ["meta[property='og:site_name']"]);
  const date = calendarDate(first($, ["meta[property='article:published_time']", "meta[name='date']", "meta[name='pubdate']", "meta[name='publish_date']"]));
  $("script, style, noscript, svg, nav, footer, header, aside, form").remove();
  const article = $("article, main, [role='main']").first();
  const text = (article.length ? article : $("body")).text().replace(/\s+/g, " ").trim();
  if (text.length < 80) throw new Error("knowledge_url_extract_empty");
  return { url, title, author, organization, date, text };
}

/** Fetches only public HTTP pages with bounded time, redirects, and response size. */
export async function fetchPublicArticle(input: string): Promise<FetchedArticle> {
  const response = await guardedFetch(input, { timeoutMs: 20_000, maxRedirects: 5, maxBytes: 5 * 1024 * 1024, publicOnly: true });
  if (response.status !== 200) throw new Error(`knowledge_url_http_${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("knowledge_url_not_html");
  }
  try { return parsePublicArticle(response.text(), response.url); }
  catch (error) {
    if (error instanceof Error && error.message === "knowledge_url_extract_empty") throw error;
    throw new Error("knowledge_url_extract_empty");
  }
}
