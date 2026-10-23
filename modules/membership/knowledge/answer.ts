// Answering a question from the shared library. The answer reads the published pages and the
// citation metadata the library recorded; it never reads the materials themselves, and it never
// claims coverage the pages do not have. What the model may cite is decided here: the model names
// a citation it was given, and the library says who said it and when.
import { chatJson } from "@aihot/backend/providers/llm";
import { FRESHNESS_LABELS, freshnessTier, type FreshnessTier } from "./catalog.ts";
import { ANSWER_SYSTEM } from "./prompts.ts";
import { answerSchema } from "./schema.ts";
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
};

export type TrustedAnswer = {
  answer: string;
  citations: TrustedCitation[];
  coverage: Coverage;
  freshness: Array<{ pageSlug: string; tier: FreshnessTier; lastReport: string | null }>;
};

/** The pages given to the model, with what each of them covers and how current it is. */
function pagesPayload(pages: RoutablePage[], now = new Date()) {
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
      availableCitations: page.citations.map(citation => ({
        citationId: citation.id,
        label: citation.label,
        analyst: citation.analyst,
        organization: citation.organization,
        publishedOn: citation.publishedOn,
        sourceTitle: citation.sourceTitle,
      })),
      body: page.bodyMd.slice(0, 12_000),
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

/**
 * Asks the question and keeps only what can be checked. A footnote may only point at a citation
 * this turn offered, on the page that citation belongs to; the attribution, the coverage and the
 * freshness are read from the library's own records, not from what the model wrote.
 */
export async function answerQuestion(question: string, pages: RoutablePage[], now = new Date()): Promise<TrustedAnswer> {
  const ceiling = aggregateCoverage(pages);
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: `wiki:answer:${question.slice(0, 40)}`,
    promptVersion: "wiki-answer-2",
    system: ANSWER_SYSTEM,
    user: JSON.stringify({
      question,
      availablePages: pagesPayload(pages, now),
      coverageCeiling: {
        analysts: ceiling.analysts,
        firms: ceiling.firms,
        reports: ceiling.reports,
        firstReport: ceiling.first_report,
        lastReport: ceiling.last_report,
        note: "回答声明的覆盖范围不得超过这个上限；没有覆盖就说明没有覆盖。",
      },
      output: {
        answer: "Markdown 正文；具体观点挂 [^1] 这样的脚注角标",
        citations: "每个角标对应一条：label 与角标编号一致，citationId 只能取该页 availableCitations 里的 id，pageSlug 必须是该引用所在的页面",
      },
    }),
    schema: answerSchema,
    temperature: 0.2,
    maxTokens: 4000,
  });
  const byId = new Map<string, { page: RoutablePage; citation: RoutableCitation }>();
  for (const page of pages) for (const citation of page.citations) byId.set(citation.id, { page, citation });
  const citations: TrustedCitation[] = [];
  const seen = new Set<string>();
  for (const claim of answer.data.citations) {
    const found = byId.get(claim.citationId);
    // A citation this turn never offered, or one the model put on another page, is not kept.
    if (!found) continue;
    if (claim.pageSlug && claim.pageSlug !== found.page.slug) continue;
    if (seen.has(claim.citationId)) continue;
    seen.add(claim.citationId);
    citations.push({
      label: claim.label,
      pageSlug: found.page.slug,
      title: found.page.title,
      analyst: found.citation.analyst,
      organization: found.citation.organization,
      publishedOn: found.citation.publishedOn,
      anchor: found.citation.anchor,
      citationId: claim.citationId,
      versionId: found.citation.versionId,
    });
  }
  const used = new Set(citations.map(citation => citation.pageSlug));
  const freshness = pages
    .filter(page => used.has(page.slug))
    .map(page => ({ pageSlug: page.slug, tier: freshnessTier(page.coverage.last_report, now), lastReport: page.coverage.last_report }));
  return { answer: answer.data.answer, citations, coverage: coverageOfCitations(citations), freshness };
}
