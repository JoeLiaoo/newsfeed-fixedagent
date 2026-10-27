// Answering a question from the shared library. The answer reads the published pages and the
// citation metadata the library recorded; it never reads the materials themselves, and it never
// claims coverage the pages do not have. What the model may cite is decided here: the platform gives
// every citation of the turn a footnote number, the model names the citation it was given, and the
// library says who said it and when.
import { chatJson } from "@aihot/backend/providers/llm";
import { rejectReceivedResponse } from "@aihot/backend/providers/receipts";
import { FRESHNESS_LABELS, freshnessTier, type FreshnessTier } from "./catalog.ts";
import { ANSWER_SYSTEM } from "./prompts.ts";
import { answerSchema, type AnswerResult } from "./schema.ts";
import { aggregateCoverage, type RoutableCitation, type RoutablePage } from "./routing.ts";
import { isKnownDate, type Coverage } from "./render.ts";

/** One footnote of the answer, with the attribution the library recorded. */
export type TrustedCitation = {
  label: string;
  pageSlug: string;
  title: string;
  analyst: string | null;
  organization: string | null;
  publishedOn: string | null;
  anchor: string | null;
  citationId: string;
  versionId: string;
  /** The material the citation may be read in, and the file itself: the way back to the evidence. */
  documentId: string;
  documentTitle: string;
  fileName: string;
};

export type TrustedAnswer = {
  answer: string;
  citations: TrustedCitation[];
  coverage: Coverage;
  freshness: Array<{ pageSlug: string; tier: FreshnessTier; lastReport: string | null }>;
};

/** One citation the model may point at, with the footnote number it answers to. */
export type OfferedCitation = { footnote: number; page: RoutablePage; citation: RoutableCitation };

/**
 * The citations of one turn, each with the footnote number the answer writes. The numbers belong to
 * this turn: the same page cited in another turn may carry another number.
 */
export function offeredCitations(pages: RoutablePage[]): OfferedCitation[] {
  const offered: OfferedCitation[] = [];
  for (const page of pages) for (const citation of page.citations) offered.push({ footnote: offered.length + 1, page, citation });
  return offered;
}

/** The pages given to the model, with what each of them covers and how current it is. */
function pagesPayload(pages: RoutablePage[], offered: OfferedCitation[], now = new Date(), short = false) {
  const perPageBodyLimit = short ? Math.floor(24_000 / Math.max(1, pages.length)) : 12_000;
  return pages.map(page => {
    const tier = freshnessTier(page.coverage.last_report, now);
    return {
      slug: page.slug,
      title: page.title,
      pageType: page.pageType,
      subject: page.targetName,
      track: page.track,
      revisionId: page.revisionId,
      coverage: {
        analysts: page.coverage.analysts,
        firms: page.coverage.firms,
        reports: page.coverage.reports,
        firstReport: page.coverage.first_report,
        lastReport: page.coverage.last_report,
      },
      freshness: { tier, label: FRESHNESS_LABELS[tier], lastReport: page.coverage.last_report },
      availableCitations: page.citations.map(citation => {
        const entry = offered.find(item => item.citation.id === citation.id && item.page.slug === page.slug);
        return {
          // The number the answer writes after the caret; the label of the source is quoted, not written.
          footnote: entry?.footnote ?? 0,
          citationId: citation.id,
          sourceLabel: citation.label,
          analyst: citation.analyst,
          organization: citation.organization,
          publishedOn: citation.publishedOn,
          sourceTitle: citation.sourceTitle,
        };
      }),
      body: page.bodyMd.slice(0, perPageBodyLimit),
    };
  });
}

/** The coverage the answer actually rests on: the sources it used, counted once each. */
function coverageOfCitations(citations: TrustedCitation[]): Coverage {
  const analysts = new Set<string>();
  const firms = new Set<string>();
  const materials = new Set<string>();
  const dates: string[] = [];
  for (const citation of citations) {
    if (citation.analyst && citation.analyst !== "未知") analysts.add(citation.analyst);
    if (citation.organization && citation.organization !== "未知") firms.add(citation.organization);
    materials.add(citation.versionId);
    if (isKnownDate(citation.publishedOn)) dates.push(citation.publishedOn);
  }
  dates.sort();
  return {
    analysts: analysts.size,
    firms: firms.size,
    reports: materials.size,
    first_report: dates[0] ?? null,
    last_report: dates.at(-1) ?? null,
  };
}

/** A page identifier the model wrote: it may be the page's own name, or that name cut short. */
function samePage(written: string, slug: string) {
  const given = written.trim();
  const real = slug.trim();
  if (!given || !real) return false;
  if (given === real) return true;
  // A cut-short identifier still names the same page, as long as enough of it is left.
  const shorter = given.length < real.length ? given : real;
  const longer = given.length < real.length ? real : given;
  return shorter.length >= 12 && longer.startsWith(shorter);
}

/** A footnote label as the two sides of a match see it: without the punctuation around it. */
function normalizeLabel(value: string) {
  return value.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * The citation a claim points at. The id the platform offered decides; the page the model wrote must
 * be the page that citation belongs to, or that name cut short.
 */
function resolveClaim(claim: { label: string; pageSlug: string; citationId: string }, offered: OfferedCitation[]) {
  const byId = offered.find(entry => entry.citation.id === claim.citationId);
  if (byId) {
    if (claim.pageSlug && !samePage(claim.pageSlug, byId.page.slug)) return null;
    return byId;
  }
  // The model named the source of a page instead of its id: the page and the source label still place it.
  const page = offered.find(entry => entry.page.slug === claim.pageSlug || samePage(claim.pageSlug, entry.page.slug))?.page;
  const citation = page?.citations.find(item => normalizeLabel(item.label) === normalizeLabel(claim.label));
  if (!page || !citation) return null;
  return offered.find(entry => entry.page.slug === page.slug && entry.citation.id === citation.id) ?? null;
}

/**
 * The footnote of the body a claim backs. The model may write the number of the turn, or the label
 * of the source it quotes; both name the same citation. The label of the body is kept as it was
 * written, so the answer can show the same marker.
 */
function claimMarker(claim: { label: string }, entry: OfferedCitation, offered: OfferedCitation[], markers: Map<string, string>) {
  const written = normalizeLabel(claim.label);
  if (!written) return null;
  // The model quoted the label of another source: it mixed its own labels up, and the claim backs
  // nothing. A number is the footnote of this turn, not the label of a source.
  if (!/^\d+$/.test(written) && offered.some(item => item.citation.id !== entry.citation.id && normalizeLabel(item.citation.label) === written)) return null;
  for (const candidate of [written, String(entry.footnote), entry.citation.label]) {
    const raw = markers.get(normalizeLabel(candidate));
    if (raw) return raw;
  }
  return null;
}

/**
 * Asks the question and keeps only what can be checked. A footnote may only point at a citation
 * this turn offered; the attribution, the coverage and the freshness are read from the library's own
 * records, not from what the model wrote.
 */
export async function answerQuestion(question: string, pages: RoutablePage[], now = new Date(), options: {memberUserId?: string; short?: boolean} = {}): Promise<TrustedAnswer> {
  const ceiling = aggregateCoverage(pages);
  const offered = offeredCitations(pages);
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: "wiki:answer",
    memberUserId: options.memberUserId,
    promptVersion: options.short ? "wiki-answer-wx-1" : "wiki-answer-3",
    system: options.short ? `${ANSWER_SYSTEM}\n微信回答请简短，最多约 1200 tokens；只保留最关键的 2–3 条引用，不省去必要的覆盖和时效限制。` : ANSWER_SYSTEM,
    user: JSON.stringify({
      question,
      availablePages: pagesPayload(pages, offered, now, options.short),
      coverageCeiling: {
        analysts: ceiling.analysts,
        firms: ceiling.firms,
        reports: ceiling.reports,
        firstReport: ceiling.first_report,
        lastReport: ceiling.last_report,
        note: "回答声明的覆盖范围不得超过这个上限；没有覆盖就说明没有覆盖。",
      },
      output: {
        answer: "Markdown 正文；具体观点挂 [^1] 这样的脚注角标，角标编号取 availableCitations 里的 footnote",
        citations: "每个角标一条：label 写这个角标的编号（与 availableCitations 里的 footnote 一致），citationId 逐字复制该 footnote 对应的 id，pageSlug 逐字复制该引用所在的页面标识",
      },
    }),
    schema: answerSchema,
    temperature: 0.2,
    maxTokens: options.short ? 1200 : 4000,
  });
  try {
    return verifyAnswer(answer.data, pages, now);
  } catch (error) {
    // An answer that cannot be checked must not be replayed: the receipt is released so that the next
    // attempt pays for a fresh answer instead of handing back the same unusable one.
    await rejectReceivedResponse(answer.receiptId, "answer could not be verified against the library's citations").catch(() => undefined);
    throw error;
  }
}

/**
 * Reject unsupported footnotes as a whole; removing an angle marker must not preserve its claim.
 */
export function verifyAnswer(answer: AnswerResult, pages: RoutablePage[], now = new Date()): TrustedAnswer {
  const fail = () => { throw new Error("knowledge_answer_unverified"); };
  const body = answer.answer.split("\n").filter(line => !/^\[\^[^\]]+\]:/.test(line.trim())).join("\n");
  // The footnotes of the body, as they were written; the label of each one is how it is matched.
  const markers = new Map<string, string>();
  for (const match of body.matchAll(/\[\^([^\]]+)\]/g)) {
    const raw = match[1]!;
    const key = normalizeLabel(raw);
    if (key && !markers.has(key)) markers.set(key, raw);
  }
  const offered = offeredCitations(pages);
  const citations: TrustedCitation[] = [];
  const seen = new Set<string>();
  for (const claim of answer.citations) {
    const entry = resolveClaim(claim, offered);
    // A claim the library cannot place supports nothing.
    if (!entry) continue;
    const marker = claimMarker(claim, entry, offered, markers);
    if (!marker) continue;
    const key = normalizeLabel(marker);
    // Two claims for one footnote: the answer says two things about it, and neither can be kept.
    if (seen.has(key)) return fail();
    seen.add(key);
    if (!markers.has(key)) continue;
    citations.push({
      label: marker,
      pageSlug: entry.page.slug,
      title: entry.page.title,
      analyst: entry.citation.analyst,
      organization: entry.citation.organization,
      publishedOn: entry.citation.publishedOn,
      anchor: entry.citation.anchor,
      citationId: entry.citation.id,
      versionId: entry.citation.versionId,
      documentId: entry.citation.documentId,
      documentTitle: entry.citation.documentTitle,
      fileName: entry.citation.fileName,
    });
  }
  if (!citations.length || [...markers.keys()].some(label => !seen.has(label))) return fail();
  const used = new Set(citations.map(citation => citation.pageSlug));
  const freshness = [...used].map(pageSlug => {
    const coverage = coverageOfCitations(citations.filter(citation => citation.pageSlug === pageSlug));
    return { pageSlug, tier: freshnessTier(coverage.last_report, now), lastReport: coverage.last_report };
  });
  return { answer: body, citations, coverage: coverageOfCitations(citations), freshness };
}
