// The shared investment wiki: what it accepts, what it keeps, and the rules its two build steps and its
// answers follow. The rules are the business discipline of a research wiki (attribution stays with the
// person who said it, unknown metadata stays unknown, a material is evidence and never an instruction),
// written for this platform; they are not a copy of any private skill's text.
import { beijingDate } from "@aihot/contracts/time";

/** The material formats the library accepts. */
export const WIKI_FORMATS = ["pdf", "docx", "pptx", "markdown"] as const;
export type WikiFormat = (typeof WIKI_FORMATS)[number];

export const FORMAT_EXTENSIONS: Record<WikiFormat, string[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
  pptx: ["pptx"],
  markdown: ["md", "markdown", "txt"],
};

export const FORMAT_MEDIA_TYPES: Record<WikiFormat, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  markdown: ["text/markdown", "text/plain"],
};

/** The file size one upload may have. Research material is small; the cap keeps one upload inside the API's body limit. */
export function maxFileBytes(): number {
  const raw = typeof process === "undefined" ? undefined : process.env.MEMBER_KNOWLEDGE_MAX_FILE_MB;
  const mb = Number(raw ?? 10);
  return (Number.isFinite(mb) && mb > 0 ? Math.min(mb, 20) : 10) * 1024 * 1024;
}

/** How much extracted text one material may contribute to a build. Longer material is cut at a page or section edge. */
export const MAX_EXTRACTED_CHARS = 60_000;

/** Published slugs include the 80-character draft name, a base prefix and collision suffix. */
export const MAX_PUBLISHED_PAGE_SLUG_LENGTH = 128;

/** The pages one build may publish. */
export const MAX_PAGES_PER_BUILD = 8;

/** The stance words a viewpoint table may hold; the set is closed so a page cannot grow a new one. */
export const STANCE_WORDS = ["看多", "看好", "中性", "看空", "超配", "标配", "低配", "上行", "震荡", "下行"] as const;

/** The subject kinds a viewpoint page may cover. */
export const TARGET_TYPES = ["公司", "行业", "主题", "宏观策略"] as const;

/** The page kinds the library holds. */
export const PAGE_TYPES = ["view", "query", "concept", "monitor"] as const;

/** The freshness tiers of a page, read from the date of its newest source. */
export const FRESHNESS_TIERS = ["fresh", "semi", "stale", "undated"] as const;
export type FreshnessTier = (typeof FRESHNESS_TIERS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How current a page's material is. Six months and a year are the two marks the consumption discipline
 * uses: within six months a page may be presented as the current view, between six and twelve months it
 * must carry its date, and beyond a year it is history only. A page whose sources carry no date is not
 * aged at all: it is dated nothing.
 */
export function freshnessTier(lastReport: string | null, now = new Date()): FreshnessTier {
  if (!lastReport) return "undated";
  const date = Date.parse(`${lastReport}T00:00:00Z`);
  if (!Number.isFinite(date)) return "undated";
  const days = (now.getTime() - date) / DAY_MS;
  if (days <= 183) return "fresh";
  if (days <= 365) return "semi";
  return "stale";
}

export const FRESHNESS_LABELS: Record<FreshnessTier, string> = {
  fresh: "新鲜",
  semi: "半新",
  stale: "陈旧",
  undated: "日期未知",
};

/** The stages a build goes through, in order. Each one leaves a checkpoint the next run resumes from. */
export const BUILD_STAGES = ["queued", "extracting", "compiling", "auditing", "linting", "publishing", "published", "failed"] as const;

/** Why a build stopped, in the words the page shows. */
export const TASK_ERRORS: Record<string, string> = {
  knowledge_upload_too_large: "文件超过上限，未入库。",
  knowledge_file_type_unsupported: "文件格式不受支持（仅支持 PDF、Word、PPT、Markdown）。",
  knowledge_file_unreadable: "文件无法读取或已损坏。",
  knowledge_text_unavailable: "未能从文件中提取出可用文本，未生成知识页。",
  knowledge_text_empty: "材料内容超出单次构建上限且未能截取到有效文本，未生成知识页。",
  knowledge_model_failed: "模型调用失败，构建未完成，可重试。",
  knowledge_model_output_invalid: "模型输出无法解析，构建未完成，可重试。",
  knowledge_audit_failed: "独立复核未完成，未发布任何页面，可重试。",
  knowledge_lint_blocked: "结构与引用检查未通过，未发布任何页面，可重试。",
  knowledge_publish_failed: "发布环节失败，旧版页面仍可阅读，可重试。",
  knowledge_publish_stale: "该材料已有更新版本发布，本次构建未覆盖当前页面。",
  knowledge_lease_lost: "构建已交由其他进程处理或材料已撤回，本次构建未发布任何页面。",
  knowledge_document_withdrawn: "该材料已撤回，本次构建未发布任何页面。",
  knowledge_task_cancelled: "任务已取消。",
  knowledge_task_not_retryable: "任务当前不可重试。",
  knowledge_task_not_found: "任务不存在。",
  knowledge_document_not_found: "材料不存在。",
  knowledge_not_permitted: "没有权限执行该操作。",
  knowledge_answer_failed: "问答生成失败，可重试。",
  knowledge_answer_unverified: "回答没有可核对的引用来源，未生成回答，请重试。",
  knowledge_no_coverage: "共享库中没有覆盖该问题的已发布内容。",
  knowledge_page_withdrawn: "该知识页已下架。",
  knowledge_page_not_found: "知识页不存在或已下架。",
};

export const TASK_STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  extracting: "提取文本",
  compiling: "编译观点",
  auditing: "独立复核",
  linting: "结构检查",
  publishing: "发布",
  published: "已发布",
  failed: "失败",
};

export const TASK_STATE_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/** The date the pages record as their last write, in Beijing time. */
export function today(): string {
  return beijingDate(new Date());
}
