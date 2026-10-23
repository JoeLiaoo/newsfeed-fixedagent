// Why an employee source check failed. One stable code per stage, so the page can say what happened
// instead of one message for every failure, and so a vendor outage is not reported as a bad address.
import { HttpStatusError } from "@aihot/backend/lib/http-fetch";
import { FetchError } from "@aihot/backend/sources/types";

/** The check ran out of time: the site's own timeout, or the deadline the check gives itself. */
export class SourceCheckTimeout extends Error {
  constructor() { super("source_check_timeout"); this.name = "SourceCheckTimeout"; }
}

export type SourceCheckCode =
  | "source_unreachable"
  | "source_timeout"
  | "source_not_parseable"
  | "source_no_articles"
  | "source_not_found"
  | "source_forbidden"
  | "source_rate_limited"
  | "source_upstream_error"
  | "source_article_pages_failed"
  | "source_validation_failed";

export interface SourceCheckFailure {
  status: number;
  code: SourceCheckCode;
}

/** Transport failures that mean the address did not answer at all. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "EHOSTDOWN",
]);
/** Transport failures that mean the address did not answer in time. */
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

/** The error and everything it was caused by. */
function causes(error: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    const next = (current as { cause?: unknown }).cause;
    const aggregate = (current as { errors?: unknown[] }).errors;
    current = Array.isArray(aggregate) && aggregate.length ? aggregate[0] : next;
  }
  return out;
}

function codeOf(error: unknown): string | null {
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

function isTimeout(error: unknown): boolean {
  return causes(error).some(item => {
    if (item instanceof SourceCheckTimeout) return true;
    const name = (item as { name?: unknown }).name;
    // A read stopped by the check's own deadline: the address did not answer in time.
    if (name === "TimeoutError" || name === "SourceCheckTimeout" || name === "AbortError") return true;
    const code = codeOf(item);
    return code !== null && TIMEOUT_CODES.has(code);
  });
}

function isUnreachable(error: unknown): boolean {
  return causes(error).some(item => {
    const code = codeOf(item);
    return code !== null && UNREACHABLE_CODES.has(code);
  });
}

/** The listing was read but held nothing this collector can use as an article. */
function isNoArticles(message: string): boolean {
  return /no items matched|contains no article URLs/i.test(message);
}

/** The address answered, but not with a feed, a listing or a sitemap. */
function isNotParseable(message: string): boolean {
  return /not an RSS\/Atom document|feed parse error|could not be parsed|url missing|feedUrl missing/i.test(message);
}

/**
 * The stage a failed source check stopped in. Every stage has its own code: a site that cannot be
 * reached, a site that answers with something else, a listing without articles, an article page
 * that cannot be read and a check that ran out of time are different problems for the employee.
 */
export function sourceCheckFailure(error: unknown): SourceCheckFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isTimeout(error) || message === "source_check_timeout") return { status: 422, code: "source_timeout" };
  if (error instanceof HttpStatusError) {
    if (error.status === 404 || error.status === 410) return { status: 422, code: "source_not_found" };
    if (error.status === 401 || error.status === 403) return { status: 422, code: "source_forbidden" };
    if (error.status === 429) return { status: 422, code: "source_rate_limited" };
    return { status: 422, code: "source_upstream_error" };
  }
  if (error instanceof FetchError) {
    if (isNoArticles(message)) return { status: 422, code: "source_no_articles" };
    if (isNotParseable(message)) return { status: 422, code: "source_not_parseable" };
    if (/原文页全部读取失败/.test(message)) return { status: 422, code: "source_article_pages_failed" };
    return { status: 422, code: "source_validation_failed" };
  }
  if (isUnreachable(error)) return { status: 422, code: "source_unreachable" };
  // A blocked or refused read is a transport failure too (the guard refuses private addresses).
  if (/fetch failed|blocked|ECONN/i.test(message)) return { status: 422, code: "source_unreachable" };
  return { status: 422, code: "source_validation_failed" };
}
