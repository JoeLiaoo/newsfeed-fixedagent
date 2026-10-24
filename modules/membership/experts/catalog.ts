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
export const XINHUA_USED_TOOLS = ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] as const;

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

/**
 * Employee-facing labels for an execution mode. They name the capability an employee gets, never the
 * upstream tool or model that runs it; those stay internal (`xinhua_trial`, provider hostnames, env vars).
 */
export const EXPERT_MODE_LABELS: Record<"xinhua_trial" | "text_only", string> = {
  xinhua_trial: "一层对外投资核查",
  text_only: "文本任务专家",
};

/** What the employee has to supply in each mode, so the mode label explains itself. */
export const EXPERT_MODE_INPUTS: Record<"xinhua_trial" | "text_only", string> = {
  xinhua_trial: "需先确认企业主体",
  text_only: "直接填写任务要求",
};

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
