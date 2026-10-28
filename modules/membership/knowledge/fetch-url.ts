import { createHash } from "node:crypto";
import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { FIGURE_LIMITS } from "./catalog.ts";

export type FigureCandidate = { url: string; caption: string | null; context: string | null; ordinal: number };
export type FetchedArticle = {
  url: string; title: string | null; author: string | null; organization: string | null;
  date: string | null; text: string; htmlSha256: string;
  figures: FigureCandidate[]; candidatesTruncated: boolean;
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

/**
 * The address of a picture. A lazy-loaded address comes first, then the srcset alternatives, then
 * the plain src: a srcset entry is usually the real picture while a src is often a placeholder.
 */
function imageUrl(attributes: Record<string, string | undefined>): string | null {
  for (const name of ["data-src", "data-original", "data-lazy-src", "data-url", "data-srcset", "srcset", "src"]) {
    const raw = attributes[name]?.trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) continue;
    const value = name.includes("srcset") ? raw.split(",")[0]?.trim().split(/\s+/)[0] : raw;
    if (value && !/^(?:about:|javascript:|file:)/i.test(value)) return value;
  }
  return null;
}

/** The text around a picture, so the reading step knows what the page says about it. */
function contextAround($: ReturnType<typeof load>, image: ReturnType<ReturnType<typeof load>>): string | null {
  const previous = image.prevAll("p, div, span, li").first().text();
  const next = image.nextAll("p, div, span, li").first().text();
  const own = image.parent().text();
  const context = [previous, own, next].map(part => part.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").slice(0, 600);
  return context || null;
}

/** Reads the static article body and image candidates. URL resolution uses the final response URL. */
export function parsePublicArticle(html: string, url: string): FetchedArticle {
  const $ = load(html);
  const title = first($, ["meta[property='og:title']", "meta[name='twitter:title']"]) ?? ($("title").first().text().trim().slice(0, 500) || null);
  const author = first($, ["meta[name='author']", "meta[property='article:author']", "meta[name='byl']"]);
  const organization = first($, ["meta[property='og:site_name']"]);
  const date = calendarDate(first($, ["meta[property='article:published_time']", "meta[name='date']", "meta[name='pubdate']", "meta[name='publish_date']"]));
  $("script, style, noscript, svg, nav, footer, header, aside, form").remove();
  const content = $("#js_content").first().length ? $("#js_content").first() :
    $("article").first().length ? $("article").first() :
      $("main, [role='main']").first().length ? $("main, [role='main']").first() : $("body");
  // WeChat inserts reader navigation inside #js_content, so generic nav/footer removal misses it.
  content.find("*").filter((_, element) => {
    const node = $(element);
    return !node.children().length && /^(?:在小说阅读器读本章|去阅读|在小说阅读器中阅读)$/.test(node.text().replace(/\s+/g, "").trim());
  }).remove();
  const figures: FigureCandidate[] = [];
  const seen = new Set<string>();
  let candidatesTruncated = false;
  const body = content.text().replace(/\s+/g, " ");
  content.find("img").each((_, element) => {
    const image = $(element);
    const raw = imageUrl(element.attribs ?? {});
    if (!raw) return;
    let resolved: string;
    try {
      const target = new URL(raw, url);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) return;
      resolved = target.toString();
    } catch { return; }
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (figures.length >= FIGURE_LIMITS.candidates) { candidatesTruncated = true; return; }
    const parent = image.closest("figure");
    const caption = (parent.find("figcaption").first().text() || image.attr("alt") || image.parent().next("p").first().text()).replace(/\s+/g, " ").trim().slice(0, 500) || null;
    figures.push({ url: resolved, caption, context: contextAround($, image), ordinal: figures.length + 1 });
  });
  const text = body.trim();
  if (text.length < 80 && !figures.length) throw new Error("knowledge_url_extract_empty");
  return { url, title, author, organization, date, text, htmlSha256: createHash("sha256").update(html).digest("hex"), figures, candidatesTruncated };
}

/** Fetches only public HTTP pages with bounded time, redirects, and response size. */
export async function fetchPublicArticle(input: string): Promise<FetchedArticle> {
  const response = await guardedFetch(input, { timeoutMs: 20_000, maxRedirects: 5, maxBytes: 5 * 1024 * 1024, publicOnly: true });
  if (response.status !== 200) throw new Error(`knowledge_url_http_${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("knowledge_url_not_html");
  try { return parsePublicArticle(response.text(), response.url); }
  catch (error) {
    if (error instanceof Error && error.message === "knowledge_url_extract_empty") throw error;
    throw new Error("knowledge_url_extract_empty");
  }
}
