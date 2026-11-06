export type ProjectCollection = {
  title: string;
  path: string;
  group?: "citic-alliance";
  /** 联盟页把母基金显示成投资机构，并去掉子基金。 */
  institutions?: { label: string; allLabel: string };
};

type Filters = { motherFund: string; subfund: string; sector: string; province: string };
type FundLine = { mother_fund_name: string | null; subfund_name: string | null; project_province: string };

export function projectQueryFilters(collection: ProjectCollection, params: URLSearchParams): Filters {
  return {
    motherFund: params.get("motherFund") || "",
    subfund: collection.institutions ? "" : (params.get("subfund") || ""),
    sector: params.get("sector") || "",
    province: params.get("province") || "",
  };
}

/** 卡片上的机构一行。联盟页不写子基金。 */
export function projectCardFundLine(collection: ProjectCollection, item: FundLine): string {
  const province = `项目区域（省）：${item.project_province}`;
  if (collection.institutions) return `${collection.institutions.label}：${item.mother_fund_name || "未知"} · ${province}`;
  return `母基金：${item.mother_fund_name || "未知"} · 子基金：${item.subfund_name || "未知"} · ${province}`;
}
