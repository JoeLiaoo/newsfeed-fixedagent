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
export const EXPERT_SKILL = `# 企业一层对外投资核查

本专家使用平台已授权的企业信息查询能力与文本整理能力。当前按已确认主体读取工商画像和一层直接投资，生成可复核的底稿。

只使用工具返回的主体、投资关系、比例和日期。不能把入库时间推断成投资发生时间；不能补造金额、轮次、控制关系、基金备案或退出事实。每项结论须保留来源工具和查询时间，未提供的字段写“未提供”。

从经员工确认的企业实体开始，读取该主体的直接投资和工商画像，按证据生成一层关系清单。实体同名时必须由员工选择匹配主体。任务结果只覆盖一层关系，不是集团穿透报告。

控股/参股判断、关联方合并、投资类主体例外、上市公司识别、基金备案、公司制基金识别、有限合伙 GP/管理人、历史退出、基金组合披露、退出性质及全谱系断点续跑等能力，当前数据与规则引擎未完整支持时逐项标记缺口，不得推断通过。
`;

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

/** The experts the platform ships; their tasks take an entity name instead of a written brief. */
export const BUILTIN_SLUGS = new Set<string>([EXPERT_SLUG, PANORAMA_EXPERT_SLUG]);

/**
 * Employee-facing labels for an execution mode. They name the capability an employee gets, never the
 * upstream tool or model that runs it; those stay internal (`xinhua_trial`, provider hostnames, env vars).
 */
export const EXPERT_MODE_LABELS: Record<"xinhua_trial" | "xinhua_panorama" | "text_only", string> = {
  xinhua_trial: "一层对外投资核查",
  xinhua_panorama: "对外投资全景图",
  text_only: "文本任务专家",
};

/** What the employee has to supply in each mode, so the mode label explains itself. */
export const EXPERT_MODE_INPUTS: Record<"xinhua_trial" | "xinhua_panorama" | "text_only", string> = {
  xinhua_trial: "需先确认企业主体",
  xinhua_panorama: "需先确认企业主体",
  text_only: "直接填写任务要求",
};

/** The modes that need a confirmed entity before the run can start. */
export function modeNeedsEntity(mode: string) {
  return mode === "xinhua_trial" || mode === "xinhua_panorama";
}

export const SAMPLE_COMPANIES = [
  "上海天之际创业投资合伙企业（有限合伙）",
  "杭州市国有资本投资运营有限公司",
];

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
