/**
 * The provider's own fields, read as they are: every mapper quotes the field the service returned and
 * never converts a unit, a date or a status.
 */
import { extractObject, findArrays } from "./data.ts";
import { field, text, type PanoramaProfile, type PanoramaRelation, type PanoramaShareholder } from "./panorama.ts";

export function mapProfile(raw: unknown): PanoramaProfile {
  const row = extractObject(raw);
  return {
    companyId: field(row, "company_id", "comp_id"),
    creditCode: field(row, "credit_code", "unified_social_credit_code"),
    name: field(row, "company_name", "name"),
    status: field(row, "company_status_name", "company_status", "status"),
    typeName: field(row, "company_type_name", "company_type"),
    econKind: field(row, "econ_kind"),
    scope: field(row, "scope"),
    startDate: field(row, "start_date", "establish_date"),
    registCapital: field(row, "regist_capi", "registered_capital"),
    operatorName: field(row, "oper_name", "legal_person_name"),
    originalName: field(row, "original_name"),
  };
}

export function mapRelations(rows: Array<Record<string, unknown>>): PanoramaRelation[] {
  return rows.map(row => ({
    recordId: field(row, "record_id"),
    companyId: field(row, "company_id", "comp_id"),
    name: field(row, "company_name", "investee_name", "name") ?? "名称未提供",
    pct: field(row, "stock_percent", "stock_proportion", "holding_ratio"),
    subscribed: field(row, "should_capi", "should_capi_value", "should_capital", "subscribed_capital"),
    subscribedUnit: field(row, "should_capi_unit"),
    subscribedDate: field(row, "shoud_date", "should_date"),
    capitalDate: field(row, "capi_date"),
    dataDate: field(row, "dates"),
    investorName: field(row, "stock_name"),
    investorType: field(row, "stock_type"),
    deleted: text(row.is_del) === "1",
  }));
}

export function mapShareholders(raw: unknown): PanoramaShareholder[] {
  const groups = findArrays(extractObject(raw), ["shareholder_info", "results", "items", "data"]);
  return groups.flat().map(row => ({
    companyId: field(row, "company_id", "comp_id"),
    name: field(row, "stock_name", "company_name", "name"),
    pct: field(row, "stock_percent", "stock_proportion", "holding_ratio"),
    type: field(row, "stock_type"),
    subscribed: field(row, "should_capi", "should_capi_value", "should_capital"),
    subscribedUnit: field(row, "should_capi_unit"),
    subscribedDate: field(row, "shoud_date", "should_date"),
  }));
}

export function mapCanRev(raw: unknown): { revocationDate: string | null; cancellationDate: string | null } {
  const groups = findArrays(extractObject(raw), ["company_can_rev_info", "results", "items", "data"]);
  const rows = groups.flat();
  const pick = (key: string) => {
    for (const row of rows) {
      const value = field(row, key);
      if (value) return value;
    }
    return null;
  };
  return { revocationDate: pick("revocation_date"), cancellationDate: pick("cancellation_date") };
}

export function mapAnnualBase(raw: unknown): { annualStatus: string | null; annualPublishedAt: string | null; annualHasInvestment: boolean | null; annualYears: string[] } {  const groups = findArrays(extractObject(raw), ["company_annual_report_base_info", "results", "items", "data"]);
  const rows = groups.flat();
  const years = rows.map(row => field(row, "report_year")).filter((year): year is string => Boolean(year)).sort();
  const newest = rows.find(row => field(row, "report_year") === years[years.length - 1]) ?? null;
  const invested = newest ? text(newest.is_invested) : null;
  return {
    annualStatus: newest ? field(newest, "company_status_name", "company_status") : null,
    annualPublishedAt: newest ? field(newest, "publish_date") : null,
    annualHasInvestment: invested === null ? null : invested === "1",
    annualYears: years,
  };
}

/** One row of an annual report's outbound-investment disclosure. */
export type PanoramaDisclosure = { year: string | null; publishedAt: string | null; investee: string | null };

export function mapAnnualInvestment(raw: unknown): PanoramaDisclosure[] {
  const groups = findArrays(extractObject(raw), ["company_annual_report_investment_info", "results", "items", "data"]);
  return groups.flat().map(row => ({
    year: field(row, "report_year"),
    publishedAt: field(row, "publish_date"),
    investee: field(row, "investee_company_name", "investee_company"),
  }));
}

export function mapHistoryNames(raw: unknown): string[] {
  const groups = findArrays(extractObject(raw), ["history_company_name_info", "results", "items", "data"]);
  return groups.flat().map(row => field(row, "his_company_name")).filter((name): name is string => Boolean(name));
}
