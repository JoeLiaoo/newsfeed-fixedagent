// Which pages of the shared library a question is answered from. The library is one store; the index
// over it routes a question to the pages that hold the subject, and the pages that hold nothing about
// it are left out rather than padded in.
import type { Coverage } from "./render.ts";

export type RoutablePage = {
  slug: string;
  title: string;
  pageType: string;
  targetName: string | null;
  track: string | null;
  bodyMd: string;
  coverage: Coverage;
};

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

/**
 * The words of a text. Chinese has no spaces, so its runs are cut into pairs of characters; a pair of
 * characters carries more of the meaning than a single one does, and the pairs are what the routing
 * matches on.
 */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  for (const run of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (!run) continue;
    if (CJK.test(run)) {
      if (run.length === 1) tokens.push(run);
      for (let index = 0; index + 1 < run.length; index++) tokens.push(run.slice(index, index + 2));
      if (run.length > 2) tokens.push(run);
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

/** How well a page answers a question: the words they share, the longer the better. */
export function scorePage(question: string, page: RoutablePage): number {
  const tokens = [...new Set(tokenize(question))];
  if (!tokens.length) return 0;
  const haystack = `${page.title} ${page.targetName ?? ""} ${page.track ?? ""} ${page.bodyMd}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    score += token.length >= 4 ? 3 : token.length >= 2 ? 2 : 1;
  }
  const subject = page.targetName?.toLowerCase();
  if (subject && subject.length >= 2 && question.toLowerCase().includes(subject)) score += 8;
  return score;
}

/** The pages a question is answered from, the closest first. */
export function routePages(question: string, pages: RoutablePage[], limit = 6): Array<{ page: RoutablePage; score: number }> {
  return pages
    .map(page => ({ page, score: scorePage(question, page) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.page.slug.localeCompare(right.page.slug))
    .slice(0, limit);
}

/**
 * The coverage an answer may claim: the pages it used, counted together. These totals are the ceiling
 * for what the answer may state, so a claim of wider coverage than the pages carry is caught.
 */
export function aggregateCoverage(pages: RoutablePage[]): Coverage {
  const dates = pages.flatMap(page => [page.coverage.first_report, page.coverage.last_report]).filter((date): date is string => !!date).sort();
  return {
    analysts: pages.reduce((sum, page) => sum + page.coverage.analysts, 0),
    firms: pages.reduce((sum, page) => sum + page.coverage.firms, 0),
    reports: pages.reduce((sum, page) => sum + page.coverage.reports, 0),
    first_report: dates[0] ?? null,
    last_report: dates.at(-1) ?? null,
  };
}
