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
export const EXPERT_SKILL = `# 对外投资全景图核查（新华财经适配试运行版）

本版本参考 reference/SKILL.md，仅使用平台授权的新华财经企业基础信息 MCP 与 DeepSeek。原技能以悟道 MCP 及 10/11/12 专项 skill 为依赖，本适配版不声称等价执行。

只使用工具返回的主体、投资关系、比例和日期。不能把入库时间推断成投资发生时间；不能补造金额、轮次、控制关系、基金备案或退出事实。每项结论须保留来源工具和查询时间，未提供的字段写“未提供”。

适配版当前从经员工确认的企业实体开始，读取该主体的直接投资和工商画像，按证据生成一层关系清单。实体同名时必须由员工选择匹配主体。任务结果是试运行底稿，不是完整穿透报告。

对于控股/参股、关联方合并、投资类主体例外、上市公司终止、基金备案、公司制基金终止、有限合伙 GP/管理人、历史退出、基金组合披露、退出性质及全谱系断点续跑等原规则，当前数据与规则引擎未完整支持时逐项标记缺口，不得推断通过。
`;

export const BUILTIN_EXPERT = {
  slug: EXPERT_SLUG,
  name: "单体分析09 · 对外投资全景图核查（新华财经适配版）",
  description: "以新华财经工商信息查询已确认主体的一层直接投资，附带来源证据和缺口；试运行，不替代原悟道技能。",
  version: "0.1.0-trial",
  skillMd: EXPERT_SKILL,
  missingDependencies: ["reference/SKILL.md 中的悟道 MCP（wudao_mcp_gateway）及 10/11/12 专项 skill"],
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
