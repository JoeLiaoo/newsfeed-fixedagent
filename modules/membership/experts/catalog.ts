export const XINHUA_ALLOWED_TOOLS = [
  "fuzzy_search_company_list",
  "get_company_profile",
  "get_direct_investment",
  "get_company_shareholder",
  "get_company_can_rev",
  "get_history_company_name",
  "get_company_annual_report_base_info",
  "get_company_annual_report_investment_info",
] as const;

/** The three capabilities the one-layer expert reads; an imported skill must declare all of them. */
export const XINHUA_BASE_TOOLS = ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] as const;

/** Every capability the platform reads on its own: the one-layer expert and the panorama together. */
export const XINHUA_USED_TOOLS = XINHUA_ALLOWED_TOOLS;

export const EXPERT_SLUG = "external-investment-landscape-xinhua-adapter";

/**
 * The status of an expert the platform no longer offers as a catalog entry. `blocked` would mean
 * missing dependencies and would show the wrong badge; `hidden` means the row and its worker stay,
 * so tasks that were created before the hiding keep running, but no employee sees the entry and no
 * new task starts on it.
 */
export const HIDDEN_EXPERT_STATUS = "hidden";

/** The builtins the employee platform keeps but does not offer as a catalog entry. */
export const HIDDEN_BUILTIN_SLUGS = new Set<string>([EXPERT_SLUG, "company-sentiment-report"]);

/**
 * The status of an expert the platform plans to offer. `blocked` would mean missing dependencies and
 * `hidden` means the catalog drops the entry; `coming_soon` keeps the entry visible for every role so
 * employees can see what is on the way, but it starts no task and shows no execution mode.
 */
export const COMING_SOON_EXPERT_STATUS = "coming_soon";

export const EXPERT_SKILL = `# 企业一层对外投资核查

本专家使用平台已授权的企业信息查询能力与文本整理能力。当前按已确认主体读取工商画像和一层直接投资，生成可复核的底稿。

只使用工具返回的主体、投资关系、比例和日期。不能把入库时间推断成投资发生时间；不能补造金额、轮次、控制关系、基金备案或退出事实。每项结论须保留来源工具和查询时间，未提供的字段写“未提供”。

从经员工确认的企业实体开始，读取该主体的直接投资和工商画像，按证据生成一层关系清单。实体同名时必须由员工选择匹配主体。任务结果只覆盖一层关系，不是集团穿透报告。

控股/参股判断、关联方合并、投资类主体例外、上市公司识别、基金备案、公司制基金识别、有限合伙 GP/管理人、历史退出、基金组合披露、退出性质及全谱系断点续跑等能力，当前数据与规则引擎未完整支持时逐项标记缺口，不得推断通过。
`;

/**
 * The one-layer builtin. It keeps its row, its skill text and its worker, so tasks that were created
 * before it was hidden keep running, but the employee catalog does not offer it as an entry and no
 * new task starts on it (Joe, 2026-10-24).
 */
export const BUILTIN_EXPERT = {
  slug: EXPERT_SLUG,
  name: "企业一层对外投资核查",
  description: "查询已确认主体的工商画像与一层直接投资，生成带来源和待核事项的底稿。",
  version: "0.1.0",
  skillMd: EXPERT_SKILL,
  missingDependencies: [],
};

export const PANORAMA_EXPERT_SLUG = "outbound-investment-panorama";
export const PANORAMA_EXPERT_SKILL = `# 对外投资全景图

本专家从经员工确认的企业主体出发，逐层核查其对外投资链条，产出分层底稿：逐层投资明细、有限合伙份额链、结构树、全景汇总、已退出部分、年报交叉、缺口清单与采集台账。

穿透规则按顺序判断：非上市参股即止；控股或合并口径的第一大股东续钻；投资、管理、咨询类主体与投资平台按例外继续下钻；有限合伙份额链未备案分支继续下钻、出到公司即止；上市公司即止；公司制基金即止。

能力边界（平台没有对等工具，逐项写进底稿的缺口清单，不作推断）：
- 基金备案状态、备案号与私募基金管理人登记没有对等工具；带基金字样的主体按备案未核处理。
- 历史退出与接手股东没有对等工具；年报披露只作辅助披露时间，不作为退出性质。
- 关联方关系证据没有对等工具，合并口径按本次图谱内主体近似计算。
- 上市公司识别只有登记经济类型这一弱信号，证券代码与上市地未确认。
- 认缴出资日期、数据日期与年报披露日期不得互相替代为投资发生日。

穿透受层级、主体数与调用次数上限约束；触及上限时底稿标注为不完整，未处理的关系不进入任何表格。只使用工具返回的主体、关系、比例与日期，不补造金额、轮次、控制关系、基金备案或退出事实，未提供的字段写“未提供”。
`;

export const PANORAMA_EXPERT = {
  slug: PANORAMA_EXPERT_SLUG,
  name: "对外投资全景图",
  description: "从已确认主体出发逐层穿透对外投资，按终止条件与穿透规则分层出表，并标注每项能力缺口。",
  version: "0.1.0",
  skillMd: PANORAMA_EXPERT_SKILL,
  missingDependencies: [],
};

/** The retired entry remains as a hidden row so historical tasks retain their expert reference. */
export const COMING_SOON_EXPERT_SLUG = "company-sentiment-report";

export const COMING_SOON_EXPERT_SKILL = `# 企业舆情报告

旧目录入口已隐藏，仅保留历史任务关联；不提供新任务，也不产出舆情报告。当前版本不声明任何工具依赖。
`;

export const COMING_SOON_EXPERT = {
  slug: COMING_SOON_EXPERT_SLUG,
  name: "企业舆情报告",
  description: "旧目录入口已隐藏，仅保留历史任务关联。",
  version: "0.1.0",
  skillMd: COMING_SOON_EXPERT_SKILL,
  missingDependencies: [],
};

export const SECTOR_PEER_EXPERT_SLUG = "sector-peer-landscape";
export const SECTOR_PEER_EXPERT_SKILL = `# 赛道同业竞争看板

输入一个企业或赛道名称。P0 仅保存原始查询并生成空的网页看板；企业与赛道的消歧在 P1 完成。主视图以中国同业、人民币基金和境内交易为主；美国同业与融资只作参考带。

看板回答三个问题：同业是谁、发展到哪（公开阶段信号）、资本市场认可（公开融资／并购／IPO 密度）。仅使用公开资料。后续接入数据时，每个数字、事件和判断都须附可访问的来源 URL 与时间口径；缺少可靠证据写“未披露／未检索到”，不得补造。内部 IC 笔记、未披露估值及真实 LP 管线不属于数据范围。

P0 不声明任何工具依赖，不调用企业信息查询或模型研究，也不接入实时公开信源。
`;
export const SECTOR_PEER_EXPERT = {
  slug: SECTOR_PEER_EXPERT_SLUG,
  name: "赛道同业竞争看板",
  description: "从同业是谁、公开阶段信号与公开融资／并购／IPO 密度看赛道竞争；中国为主，美国同业作参考。P0 数据源未接入。",
  version: "0.1.0",
  skillMd: SECTOR_PEER_EXPERT_SKILL,
  missingDependencies: [],
};

export const FRONTIER_PODCAST_EXPERT_SLUG = "frontier-podcast";
export const FRONTIER_PODCAST_EXPERT_SKILL = `# 前沿播客

输入一个话题（中文或英文），在公开播客文字库中检索最相关的节目，取回每一集的中文要点与摘要，生成网页预览与 Markdown 产物。

只使用检索接口返回的节目标题、节目名、日期、时长、要点、摘要、参与者标签与来源链接。缺失的字段写“未提供”，不补造嘉宾观点、数字、结论或节目未提及的事实。要点与摘要是公开播客文字库对原节目的整理稿，平台未逐条核验；引用前须回到该集的来源页面核对。

检索结果被标记为部分结果（回退到最近若干集的子串匹配）时，产物与页面都写明结果不完整，不当作全量命中。收录集数受接口匹配结果限制，不等于该话题的全部节目。
`;
export const FRONTIER_PODCAST_EXPERT = {
  slug: FRONTIER_PODCAST_EXPERT_SLUG,
  name: "前沿播客",
  description: "输入一个话题，检索公开播客文字库，取回最相关几集的中文要点与摘要，生成网页预览与 Markdown 产物。",
  version: "0.1.0",
  skillMd: FRONTIER_PODCAST_EXPERT_SKILL,
  missingDependencies: [],
};

/** The experts that take a topic query instead of an entity or a written brief. */
export const QUERY_EXPERT_SLUGS = new Set<string>([SECTOR_PEER_EXPERT_SLUG, FRONTIER_PODCAST_EXPERT_SLUG]);

/** The experts whose result is shown as a webpage in the task card. */
export const HTML_PREVIEW_EXPERT_SLUGS = new Set<string>([SECTOR_PEER_EXPERT_SLUG, FRONTIER_PODCAST_EXPERT_SLUG]);

/** The experts the platform ships; their tasks take an entity name instead of a written brief. */
export const BUILTIN_SLUGS = new Set<string>([EXPERT_SLUG, PANORAMA_EXPERT_SLUG]);

/** What an employee reads on a card or a detail page for each state of an expert. */
export const EXPERT_STATUS_BADGES: Record<string, { label: string; variant: "success" | "warning" | "secondary" }> = {
  available: { label: "可运行", variant: "success" },
  coming_soon: { label: "开发中", variant: "secondary" },
  blocked: { label: "缺少依赖", variant: "warning" },
};

/** The stage of a task in the words the employee reads; an unknown stage keeps its own name. */
export const EXPERT_STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  entity_search: "检索主体",
  choose_entity: "等待选择主体",
  processing: "执行中",
  complete: "已完成",
  failed: "失败",
  cancelled: "已取消",
  recovered: "已重新排队",
};

/** The badge of an expert's state; an unknown state keeps its own name instead of borrowing one. */
export function expertStatusBadge(status: string) {
  return EXPERT_STATUS_BADGES[status] ?? { label: status, variant: "secondary" as const };
}

/**
 * Employee-facing labels for an execution mode. They name the capability an employee gets, never the
 * upstream tool or model that runs it; those stay internal (`xinhua_trial`, provider hostnames, env vars).
 */
export const EXPERT_MODE_LABELS: Record<"xinhua_trial" | "xinhua_panorama" | "text_only" | "podcast_search", string> = {
  xinhua_trial: "一层对外投资核查",
  xinhua_panorama: "对外投资全景图",
  text_only: "文本任务专家",
  podcast_search: "公开播客检索",
};

/** What the employee has to supply in each mode, so the mode label explains itself. */
export const EXPERT_MODE_INPUTS: Record<"xinhua_trial" | "xinhua_panorama" | "text_only" | "podcast_search", string> = {
  xinhua_trial: "需先确认企业主体",
  xinhua_panorama: "需先确认企业主体",
  text_only: "直接填写任务要求",
  podcast_search: "直接填写话题",
};

/** The modes that need a confirmed entity before the run can start. */
export function modeNeedsEntity(mode: string) {
  return mode === "xinhua_trial" || mode === "xinhua_panorama";
}

export const SAMPLE_COMPANIES = [
  "上海天之际创业投资合伙企业（有限合伙）",
  "杭州市国有资本投资运营有限公司",
];

/** What an employee reads for the state of a task. */
export const EXPERT_TASK_STATE_LABELS: Record<string, string> = {
  queued: "排队中",
  waiting_input: "等待选择主体",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/** The badge of a task's state; an unknown state keeps its own name instead of borrowing one. */
export const EXPERT_TASK_STATE_VARIANTS: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  queued: "warning",
  waiting_input: "warning",
  running: "default",
  succeeded: "success",
  failed: "destructive",
  cancelled: "secondary",
};

/** The step a task is at; the state says how a task ended, the step says where it is. */
export const EXPERT_TASK_STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  processing: "生成报告",
  entity_search: "检索企业主体",
  choose_entity: "等待确认主体",
  complete: "已完成",
  failed: "失败",
  cancelled: "已取消",
  recovered: "已恢复并重新排队",
};

/**
 * What an employee reads when a task failed. The codes stay internal; the sentences name the
 * capability that stopped, never the service or the model behind it.
 */
export const EXPERT_TASK_ERROR_LABELS: Record<string, string> = {
  xinhua_not_configured: "企业信息查询服务尚未配置，请联系管理员。",
  xinhua_unavailable: "企业信息查询服务暂时不可用。",
  xinhua_tool_unavailable: "当前账号缺少所需工具，任务未完成。",
  xinhua_tool_failed: "企业信息查询未返回可用结果。",
  xinhua_no_candidates: "未匹配到该名称的企业主体，请核对登记名称或改用更短的关键词。",
  xinhua_entity_id_missing: "查询返回的主体缺少可核验的唯一标识，报告已停止。",
  xinhua_response_invalid: "查询返回内容无法解析，报告已停止。",
  xinhua_identity_unverified: "未能按唯一 ID 或完整信用代码核验主体，报告已停止。",
  xinhua_entity_mismatch: "查询返回的主体与所选企业不一致，报告已停止。",
  expert_execution_failed: "任务未完成，请检查配置后重试。",
};

export const XINHUA_TOOL_LABELS: Record<string, string> = {
  fuzzy_search_company_list: "主体名称候选检索",
  get_company_profile: "企业基础画像",
  get_direct_investment: "对外直接投资",
  get_company_shareholder: "股东信息",
  get_company_can_rev: "注销吊销信息",
  get_history_company_name: "历史名称",
  get_company_annual_report_base_info: "年报基础信息",
  get_company_annual_report_investment_info: "年报对外投资",
};

/** The capabilities one panorama run reads, named for the employee. */
export const PANORAMA_TOOL_LABELS = [
  XINHUA_TOOL_LABELS.get_company_profile,
  XINHUA_TOOL_LABELS.get_direct_investment,
  XINHUA_TOOL_LABELS.get_company_shareholder,
  XINHUA_TOOL_LABELS.get_company_can_rev,
  XINHUA_TOOL_LABELS.get_history_company_name,
  XINHUA_TOOL_LABELS.get_company_annual_report_base_info,
  XINHUA_TOOL_LABELS.get_company_annual_report_investment_info,
];
