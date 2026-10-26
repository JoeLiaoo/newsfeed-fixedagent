// The two build steps. The Builder compiles a material into a draft; the Auditor reviews that draft in
// its own context, with the material in front of it and the Builder's reasoning out of reach. Each step
// is a separate model call, so the review is a real second reading and not a continuation.
import { chatJson } from "@aihot/backend/providers/llm";
import { AUDITOR_SYSTEM, BUILDER_SYSTEM } from "./prompts.ts";
import { normalizeAuditResult, normalizeCompiledDraft } from "./normalize.ts";
import { auditResultSchema, compiledDraftSchema, type AuditResult, type CompiledDraft } from "./schema.ts";
import type { FigureFinding } from "./figure-model.ts";

/** The Builder is asked for few pages on purpose: the platform accepts more, but a long draft is a long
 *  answer, and a long answer is one that runs into the output limit. */
const BUILDER_PAGES_ASKED = 4;

export type MaterialInput = {
  versionId: string;
  title: string;
  fileName: string;
  /** What the uploader wrote down about the material; it is the material's own attribution, as given. */
  declared: { author: string | null; organization: string | null; date: string | null; kind: string | null };
  text: string;
  verifiedFigures?: FigureFinding[];
  evidenceDigest?: string;
};

/** What the Builder is given: the material and the attribution the uploader recorded with it. */
function builderUser(material: MaterialInput): string {
  return JSON.stringify({
    task: `把这份研究材料编译成投研知识库的页面草稿。只返回一个 JSON 对象，键只能是 pages、sources、notes；pages 最多 ${BUILDER_PAGES_ASKED} 个，宁少勿多。`,
    material: {
      title: material.title,
      fileName: material.fileName,
      declaredAttribution: {
        author: material.declared.author,
        organization: material.declared.organization,
        date: material.declared.date,
        kind: material.declared.kind,
        note: "这是上传者填写的原始来源信息；与正文署名冲突时以正文为准，冲突写进 notes。",
      },
    },
    materialText: material.text,
    verifiedFigures: material.verifiedFigures ?? [],
    evidenceDigest: material.evidenceDigest ?? null,
    figureRule: "只在 figureRefs 中选择 verifiedFigures 已有的 figureId 与 finding id；不能改写图中事实，也不能把图中结论写进 consensus。若正文很短，仅用已核实图表确定页面主题，文字事实字段留空。",
    // The contract is the shape the answer must have. The model drifts from it more often than the
    // schema can forgive, so it is written out here rather than left to the example of the fields.
    outputContract: {
      root: "必须是 { pages: Page[], sources: Source[], notes: string }，不要外层 type 字段",
      pageType: "只能取 view | query | concept | monitor；禁止 theme/stock/article 等自造值",
      targetType: "只能取 公司 | 行业 | 主题 | 宏观策略，或 null；主题类内容用「主题」",
      everyPageMustInclude: {
        pageType: "string enum",
        slug: "string",
        title: "string",
        targetType: "enum or null",
        targetName: "string or null",
        track: "string or null",
        consensus: "string，没有共识就写空字符串",
        divergences: "array，可空",
        marginalChanges: "array，可空",
        stances: "array，可空；无评级式立场就空数组",
        expectations: "array，可空",
        risks: "array，可空",
        timeline: "array，可空",
        question: "string or null",
        answer: "string or null",
        definition: "string or null；concept 页把定义写这里",
        structure: "string[]，可空",
        inputs: "string[]，可空",
        outputs: "string[]，可空",
        anchors: "string[]，可空",
        metrics: "array，可空",
        related: "string[]，可空",
        figureRefs: "{figureId:string,findingIds:string[]}[]，只选 verifiedFigures 中已有 ID，可空",
      },
      sources: "材料里的来源：ref 用 S1、S2 递增；机构、作者、日期按材料给出，材料没写就填 null 或空数组",
      notes: "路由决定、逐份来源的去向说明、被排除内容为什么不沉淀",
      pageTypeGuide: {
        concept: "定义与框架，用 definition/structure/inputs/outputs/anchors",
        view: "标的观点页，用 consensus/divergences/stances/timeline 等",
        query: "问答页，用 question/answer",
        monitor: "跟踪指标页，用 metrics",
      },
    },
  });
}

/** What the Auditor is given: the material again, and the draft to review. */
function auditorUser(material: MaterialInput, draft: CompiledDraft): string {
  return JSON.stringify({
    task: "独立复核这份草稿：对原文核实、撤回无依据的内容、把无法证实的归因降为未知",
    materialText: material.text,
    verifiedFigures: material.verifiedFigures ?? [],
    evidenceDigest: material.evidenceDigest ?? null,
    draft,
    corrections: {
      section: "stances | timeline | divergences | risks | consensus | marginalChanges | expectations",
      index: "该 section 数组里的下标（从 0 开始）",
      action: "remove 撤回该条目；unknown_attribution 把 field 指定的字段改为「未知」",
      field: "analyst | institution | date，只能用于能定位到这三个字段的 section",
    },
    verdict: "pass | pass_with_issues | fail",
  });
}

export async function compileMaterial(material: MaterialInput): Promise<CompiledDraft> {
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: `wiki:build:${material.versionId}`,
    promptVersion: material.evidenceDigest ? "wiki-builder-figures-1" : "wiki-builder-1c",
    system: BUILDER_SYSTEM,
    user: builderUser(material),
    schema: compiledDraftSchema,
    temperature: 0,
    // A draft with several pages runs long; a cut-off answer is a build that never publishes.
    maxTokens: 12000,
    // The answer is read into the platform's own shape before the schema sees it.
    parse: normalizeCompiledDraft,
  });
  return answer.data;
}

export async function auditMaterial(material: MaterialInput, draft: CompiledDraft): Promise<AuditResult> {
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: `wiki:audit:${material.versionId}`,
    promptVersion: material.evidenceDigest ? "wiki-auditor-figures-1" : "wiki-auditor-1e",
    system: AUDITOR_SYSTEM,
    user: auditorUser(material, draft),
    schema: auditResultSchema,
    temperature: 0,
    // The Auditor reads the whole draft and answers about every part of it: a truncated review is a
    // review that did not happen.
    maxTokens: 8000,
    parse: normalizeAuditResult,
  });
  return answer.data;
}
