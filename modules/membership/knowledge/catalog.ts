// The shared investment wiki: what it accepts, what it keeps, and the rules its two build steps and its
// answers follow. The rules are the business discipline of a research wiki (attribution stays with the
// person who said it, unknown metadata stays unknown, a material is evidence and never an instruction),
// written for this platform; they are not a copy of any private skill's text.
import { beijingDate } from "@aihot/contracts/time";

/** The material formats the library accepts. */
export const WIKI_FORMATS = ["pdf", "docx", "markdown"] as const;
export type SupportedWikiFormat = (typeof WIKI_FORMATS)[number];
/** Existing versions can still record PPTX; new uploads and extraction reject it. */
export type WikiFormat = SupportedWikiFormat | "pptx";

export const FORMAT_EXTENSIONS: Record<SupportedWikiFormat, string[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
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

/** Shared budget for worker lease recovery and an employee's manual retry. */
export const MAX_WIKI_ATTEMPTS = 5;

/**
 * The limits of the figure pipeline: how much of a public page's imagery one build may read.
 * These are product protection values, not the limits of any image or model service; the image
 * decode limits themselves live with the image helper.
 */
export const FIGURE_LIMITS = {
  /** Image candidates collected from one page; beyond this the collection is marked truncated. */
  candidates: 40,
  /** Downloads actually attempted; a failed attempt still costs one. */
  downloadAttempts: 12,
  /** Images that may enter the visual steps. */
  visualImages: 8,
  /** Bytes one image download may read. */
  imageBytes: 4 * 1024 * 1024,
  /** Bytes all image downloads of one build may read. */
  downloadBytes: 24 * 1024 * 1024,
  /** The whole download stage may take. */
  downloadStageMs: 60_000,
  /** One image download may take, redirects included. */
  imageTimeoutMs: 10_000,
  /** Images one model call may carry. */
  batchSize: 2,
  /** Model calls the visual steps may make in one build, across resumes. */
  visionRequests: 8,
  /** The whole visual stage may take. */
  visualStageMs: 480_000,
  /** One visual call may take. */
  visualCallMs: 45_000,
  /** Bytes the normalized images of one build may take. */
  normalizedBytes: 8 * 1024 * 1024,
  /** Bytes one serialized model request may take, images included. */
  requestBytes: 8 * 1024 * 1024,
  /** Findings one image may yield. */
  findingsPerImage: 6,
  /** Output tokens the reading call and the verifying call may use. */
  readTokens: 4096,
  verifyTokens: 2048,
  /**
   * The bounded page rendering of a PDF. A research report draws its charts as vectors, so the
   * page itself is the picture: the renderer turns the first pages into images and the same
   * reading, reviewing and citation chain follows. The limits are the product's, not the
   * renderer's: one page at a time, in a process that may be stopped.
   */
  pdfPages: {
    /** The pages of one PDF that may enter the visual steps; the rest are read as text only. */
    maxPages: 8,
    /** One page render may take, the process start included. */
    pageTimeoutMs: 10_000,
    /** The whole render stage may take. */
    totalBudgetMs: 90_000,
    /** The heap the render process starts with; more than this ends the render. */
    memoryMb: 512,
    /** The scale a page is rendered at, at most. */
    maxScale: 2,
    /** The longest edge of a rendered page, in pixels. */
    maxEdge: 1600,
    /** The pixels a rendered page may have. */
    maxPixels: 2_000_000,
    /** The bytes one rendered page may carry back from the render process. */
    pageBytes: 16 * 1024 * 1024,
  },
} as const;

/** The stance words a viewpoint table may hold; the set is closed so a page cannot grow a new one. */
export const STANCE_WORDS = ["看多", "看好", "中性", "看空", "超配", "标配", "低配", "上行", "震荡", "下行"] as const;

/** The subject kinds a viewpoint page may cover. */
export const TARGET_TYPES = ["公司", "行业", "主题", "宏观策略"] as const;

/** The page kinds the library holds. */
export const PAGE_TYPES = ["view", "query", "concept", "monitor"] as const;

/** The freshness tiers of a page, read from the date of its newest source. */
export const FRESHNESS_TIERS = ["fresh", "semi", "stale", "undated"] as const;
export type FreshnessTier = (typeof FRESHNESS_TIERS)[number];

/** The number of days of a month; February depends on the year. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/**
 * Whether the three numbers are a day the calendar has. A date is only a date when the calendar says
 * so: 2026-02-30 and 2025-02-29 are not days, and a year or a year and a month name no day at all.
 * The platform never completes a day the material did not write.
 */
export function isRealDay(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

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
  knowledge_file_type_unsupported: "文件格式不受支持（仅支持 PDF、DOCX、Markdown；PPT 请先转换为 PDF）。",
  knowledge_file_unreadable: "文件无法读取或已损坏。",
  knowledge_text_unavailable: "未能从文件中提取出可用文本，未生成知识页。",
  knowledge_text_empty: "材料内容超出单次构建上限且未能截取到有效文本，未生成知识页。",
  knowledge_content_empty: "材料没有足够的正文，也没有通过复核的图表证据，未生成知识页。",
  knowledge_pdf_cover_only: "这份扫描件只识别到封面，没有取得可核实的正文图表证据，未生成知识页。",
  knowledge_figure_evidence_changed: "图表证据与已保存的草稿不一致，本次构建未发布任何页面，可重试。",
  knowledge_model_failed: "模型调用失败，构建未完成，可重试。",
  knowledge_model_output_invalid: "模型输出无法解析，构建未完成，可重试。",
  knowledge_audit_failed: "独立复核未完成，未发布任何页面，可重试。",
  knowledge_audit_invalid: "独立复核结果无法解析，未发布任何页面，可重试。",
  knowledge_lint_blocked: "结构与引用检查未通过，未发布任何页面，可重试。",
  knowledge_publish_failed: "发布环节失败，旧版页面仍可阅读，可重试。",
  knowledge_publish_stale: "该材料已有更新版本发布，本次构建未覆盖当前页面。",
  knowledge_lease_lost: "构建已交由其他进程处理或材料已撤回，本次构建未发布任何页面。",
  knowledge_retry_exhausted: "构建自动恢复次数已用尽，请联系管理员检查后重新上传材料。",
  knowledge_document_withdrawn: "该材料已撤回，本次构建未发布任何页面。",
  knowledge_task_cancelled: "任务已取消。",
  knowledge_task_not_retryable: "任务当前不可重试。",
  knowledge_task_not_found: "任务不存在。",
  knowledge_document_not_found: "材料不存在。",
  knowledge_not_permitted: "没有权限执行该操作。",
  knowledge_answer_failed: "问答生成失败，可重试。",
  knowledge_answer_unverified: "回答未能绑定共享库里的可核对引用，本次未生成回答；请重试或换一种问法。",
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
