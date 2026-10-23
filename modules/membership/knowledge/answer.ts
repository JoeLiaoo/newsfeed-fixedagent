// Answering a question from the shared library. The answer reads the published pages and their citation
// metadata; it never reads the materials themselves, and it never claims coverage the pages do not have.
import { chatJson } from "@aihot/backend/providers/llm";
import { FRESHNESS_LABELS, freshnessTier } from "./catalog.ts";
import { ANSWER_SYSTEM } from "./prompts.ts";
import { answerSchema, type AnswerResult } from "./schema.ts";
import { aggregateCoverage, type RoutablePage } from "./routing.ts";

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
      coverage: {
        analysts: page.coverage.analysts,
        firms: page.coverage.firms,
        reports: page.coverage.reports,
        firstReport: page.coverage.first_report,
        lastReport: page.coverage.last_report,
      },
      freshness: { tier, label: FRESHNESS_LABELS[tier], lastReport: page.coverage.last_report },
      body: page.bodyMd.slice(0, 12_000),
    };
  });
}

export async function answerQuestion(question: string, pages: RoutablePage[], now = new Date()): Promise<AnswerResult> {
  const ceiling = aggregateCoverage(pages);
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: `wiki:answer:${question.slice(0, 40)}`,
    promptVersion: "wiki-answer-1",
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
        citations: "每个角标对应一条：label 与角标编号一致，pageSlug 是页面标识，分析师/机构/日期按页面里的实际归因",
        coverage: "本次回答实际用到的覆盖范围",
        freshness: "每个用到的页面的时效档位",
      },
    }),
    schema: answerSchema,
    temperature: 0.2,
    maxTokens: 4000,
  });
  return answer.data;
}
