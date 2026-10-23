// The two build steps. The Builder compiles a material into a draft; the Auditor reviews that draft in
// its own context, with the material in front of it and the Builder's reasoning out of reach. Each step
// is a separate model call, so the review is a real second reading and not a continuation.
import { chatJson } from "@aihot/backend/providers/llm";
import { AUDITOR_SYSTEM, BUILDER_SYSTEM } from "./prompts.ts";
import { auditResultSchema, compiledDraftSchema, type AuditResult, type CompiledDraft } from "./schema.ts";

export type MaterialInput = {
  versionId: string;
  title: string;
  fileName: string;
  /** What the uploader wrote down about the material; it is the material's own attribution, as given. */
  declared: { author: string | null; organization: string | null; date: string | null; kind: string | null };
  text: string;
};

/** What the Builder is given: the material and the attribution the uploader recorded with it. */
function builderUser(material: MaterialInput): string {
  return JSON.stringify({
    task: "把这份研究材料编译成投研知识库的页面草稿",
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
    output: {
      pages: "每个页面给出 pageType、slug、title、targetType、targetName、track 和该页面类型需要的字段",
      sources: "材料里的来源：ref 用 S1、S2 递增；机构、作者、日期按材料给出，材料没写就填 null 或空数组",
      notes: "路由决定、逐份来源的去向说明、被排除内容为什么不沉淀",
    },
  });
}

/** What the Auditor is given: the material again, and the draft to review. */
function auditorUser(material: MaterialInput, draft: CompiledDraft): string {
  return JSON.stringify({
    task: "独立复核这份草稿：对原文核实、撤回无依据的内容、把无法证实的归因降为未知",
    materialText: material.text,
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
    promptVersion: "wiki-builder-1",
    system: BUILDER_SYSTEM,
    user: builderUser(material),
    schema: compiledDraftSchema,
    temperature: 0,
    maxTokens: 6000,
  });
  return answer.data;
}

export async function auditMaterial(material: MaterialInput, draft: CompiledDraft): Promise<AuditResult> {
  const answer = await chatJson({
    model: "default",
    purpose: "knowledge",
    subject: `wiki:audit:${material.versionId}`,
    promptVersion: "wiki-auditor-1",
    system: AUDITOR_SYSTEM,
    user: auditorUser(material, draft),
    schema: auditResultSchema,
    temperature: 0,
    maxTokens: 3000,
  });
  return answer.data;
}
