// Which pages of the shared library a question is answered from. The library is one store; the index
// over it routes a question to the pages that hold the subject, and the pages that hold nothing about
// it are left out rather than padded in.
import type { Coverage } from "./render.ts";

/** One citation of a published page: what it points at, who said it, and where it may be read. */
export type RoutableCitation = {
  id: string;
  label: string;
  analyst: string | null;
  organization: string | null;
  publishedOn: string | null;
  anchor: string | null;
  sourceTitle: string | null;
  versionId: string;
  /** The material the citation was read from: an answer must lead back to the file behind it. */
  documentId: string;
  documentTitle: string;
  fileName: string;
};

export type RoutablePage = {
  slug: string;
  title: string;
  pageType: string;
  targetName: string | null;
  track: string | null;
  bodyMd: string;
  coverage: Coverage;
  /** The published revision the answer reads. */
  revisionId: string;
  /** The citations of that revision: the only things an answer may point at. */
  citations: RoutableCitation[];
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

/**
 * Words that carry no subject: they appear in questions about anything, so a page that merely
 * contains them is not a match.
 */
const STOPWORDS = new Set([
  "没有", "有的", "什么", "怎么", "如何", "为什", "么样", "可以", "应该", "我们", "他们", "这个", "那个",
  "一些", "一下", "哪些", "是否", "以及", "并且", "但是", "因为", "所以", "如果", "还是", "或者", "不能",
  "不会", "需要", "请问", "谢谢", "现在", "目前", "最近", "请问", "问题", "主题", "情况", "内容", "方面",
  "不是", "就是", "这样", "那样", "之后", "之前", "以后", "以前", "以上", "以下", "其中", "对于", "关于",
]);

/**
 * How well a page answers a question: the question's words against the page's subject and its body.
 * A word of the subject (the target, its name, its track) counts more than a word that only appears
 * in the text; the question naming the subject outright counts most.
 */
export function scorePage(question: string, page: RoutablePage): { score: number; matches: number; subjectHit: boolean } {
  const tokens = [...new Set(tokenize(question))].filter(token => !STOPWORDS.has(token));
  const subjectHaystack = `${page.title} ${page.targetName ?? ""} ${page.track ?? ""}`.toLowerCase();
  const bodyHaystack = page.bodyMd.toLowerCase();
  let score = 0;
  let matches = 0;
  for (const token of tokens) {
    if (subjectHaystack.includes(token)) { matches++; score += 3; continue; }
    if (bodyHaystack.includes(token)) { matches++; score += 1; }
  }
  const subject = page.targetName?.toLowerCase();
  const subjectHit = !!subject && subject.length >= 2 && question.toLowerCase().includes(subject);
  if (subjectHit) score += 10;
  return { score, matches, subjectHit };
}

/**
 * The pages a question is answered from, the closest first. A page joins in when the question names
 * its subject, or when the question and the page share enough wording; one common word alone would
 * bring in pages the question is not about.
 */
export function routePages(question: string, pages: RoutablePage[], limit = 6): Array<{ page: RoutablePage; score: number }> {
  return pages
    .map(page => ({ page, ...scorePage(question, page) }))
    .filter(entry => entry.subjectHit || (entry.matches >= 2 && entry.score >= 4))
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
