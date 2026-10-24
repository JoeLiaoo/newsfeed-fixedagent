/**
 * The outbound-investment panorama: the reference skill's three stop conditions and six penetration
 * rules, expressed over the tools this platform is allowed to call.
 *
 * The rules are kept; the data that a rule needs and the platform cannot provide is reported as an
 * explicit gap. Nothing here decides a fact the tools did not return: a rule that cannot be decided
 * stops the branch and says why, instead of guessing.
 */

/** What one panorama run may spend. A run that reaches a limit says so in the draft. */
export type PanoramaBudget = {
  /** How many layers below the confirmed subject are followed. */
  maxDepth: number;
  /** How many subjects may be read in one run. */
  maxNodes: number;
  /** How many provider calls one run may make. */
  maxCalls: number;
  /** How many children of one subject are classified before the rest are reported as untreated. */
  maxChildrenPerNode: number;
};

export const DEFAULT_PANORAMA_BUDGET: PanoramaBudget = { maxDepth: 4, maxNodes: 25, maxCalls: 90, maxChildrenPerNode: 20 };

/** A rule as it stops or continues a chain. The label is the short cell text; the notes explain it. */
export type PanoramaRule =
  | "root"
  | "rule1_minority"
  | "rule2_control"
  | "rule2_reference_control"
  | "rule2_exception1"
  | "rule2_exception2"
  | "rule3_fund"
  | "rule3_unregistered"
  | "rule3_exit_company"
  | "rule5_listed"
  | "rule6_company_fund"
  | "exited_status"
  | "budget"
  | "gap";

export type PanoramaSubjectType = "company" | "partnership" | "fund" | "unknown";

export type PanoramaVerdict = {
  rule: PanoramaRule;
  label: string;
  drill: boolean;
  subjectType: PanoramaSubjectType;
  /** Table-note material: why the rule decided what it decided. */
  notes: string[];
  /** Gaps: what the platform could not confirm for this row. */
  gaps: string[];
  /** The merged holding caliber, quoted as the provider returned it. */
  mergedPct: string | null;
  /** Whether our side is the first shareholder in the provider's list. */
  firstLargest: boolean | null;
};

/** One investment relationship the provider returned. */
export type PanoramaRelation = {
  recordId: string | null;
  companyId: string | null;
  name: string;
  pct: string | null;
  subscribed: string | null;
  subscribedUnit: string | null;
  subscribedDate: string | null;
  capitalDate: string | null;
  dataDate: string | null;
  investorName: string | null;
  investorType: string | null;
  /** The provider marked the relation as deleted. */
  deleted: boolean;
};

export type PanoramaProfile = {
  companyId: string | null;
  creditCode: string | null;
  name: string | null;
  status: string | null;
  typeName: string | null;
  econKind: string | null;
  scope: string | null;
  startDate: string | null;
  /** The registered capital, quoted as the provider returned it. */
  registCapital: string | null;
  /** The registered responsible party; for a partnership this is the field the registry uses for its executive partner. */
  operatorName: string | null;
  originalName: string | null;
};

export type PanoramaShareholder = {
  companyId: string | null;
  name: string | null;
  pct: string | null;
  type: string | null;
  subscribed: string | null;
  subscribedUnit: string | null;
  subscribedDate: string | null;
};

export const PANORAMA_LABELS: Record<PanoramaRule, string> = {
  root: "核查起点",
  rule1_minority: "规则1·参股尽头",
  rule2_control: "规则2·控股续钻",
  rule2_reference_control: "规则2·参考控股·合并第一大股东",
  rule2_exception1: "规则2·例外1·投资类主体续钻",
  rule2_exception2: "规则2·例外2·投资平台续钻",
  rule3_fund: "规则3·即止·备案状态未核",
  rule3_unregistered: "规则3·份额链穿透",
  rule3_exit_company: "规则3·出到公司即止",
  rule5_listed: "规则5·上市公司即止·待核",
  rule6_company_fund: "规则6·公司制基金即止",
  exited_status: "已注销/吊销·随链抑制",
  budget: "预算上限·未继续穿透",
  gap: "控制口径待核·未继续穿透",
};

const FUND_NAME_WORDS = ["基金", "私募", "资管", "母基金"];
const INVESTMENT_NAME_WORDS = ["投资", "管理", "咨询", "资本", "产投"];
const INVESTMENT_SCOPE_WORDS = ["股权投资", "创业投资", "实业投资", "产业投资", "投资管理", "资产管理", "以自有资金从事投资"];
const FUND_SCOPE_WORDS = ["私募基金管理", "基金管理业务", "基金募集", "基金销售"];
const LISTED_ECON_KIND = "上市";

export function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function field(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function containsAny(value: string | null, words: string[]) {
  if (!value) return false;
  return words.some(word => value.includes(word));
}

/** A registered name written as a partnership. */
export function isPartnershipName(name: string | null | undefined) {
  if (!name) return false;
  return name.includes("有限合伙") || name.includes("普通合伙") || name.includes("合伙企业");
}

/** A subject that carries fund wording in its name or in its business scope. */
export function isFundLike(name: string | null | undefined, scope: string | null | undefined) {
  return containsAny(name ?? null, FUND_NAME_WORDS) || containsAny(scope ?? null, FUND_SCOPE_WORDS);
}

/** A subject that carries investment wording: the reference skill's exception 1. */
export function isInvestmentLike(name: string | null | undefined, scope: string | null | undefined) {
  return containsAny(name ?? null, INVESTMENT_NAME_WORDS) || containsAny(scope ?? null, INVESTMENT_SCOPE_WORDS);
}

/** The listed-company signal this platform can offer: the registry's economic type. It is a weak signal. */
export function looksListed(econKind: string | null | undefined) {
  return containsAny(econKind ?? null, [LISTED_ECON_KIND]);
}

/** The provider's holding percentage as a number, when it is one. */
export function pctNumber(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Sums the provider's own holding fields; the platform never computes a ratio the provider did not give. */
export function sumPcts(values: Array<string | null | undefined>): string | null {
  const numbers = values.map(pctNumber).filter((value): value is number => value !== null);
  if (!numbers.length) return null;
  return numbers.reduce((total, value) => total + value, 0).toFixed(4);
}

/** A subject of this graph: a name, an identifier, and the names it was also known by. */
export type PanoramaSubject = { key: string; name: string; companyId: string | null; aliases: string[]; creditCode?: string | null };

export function subjectMatches(holder: PanoramaSubject, name: string | null | undefined, companyId: string | null | undefined) {
  if (!name) return false;
  if (companyId && holder.companyId && companyId === holder.companyId) return true;
  const trimmed = name.trim();
  return holder.name === trimmed || holder.aliases.includes(trimmed);
}

export type ClassifyInput = {
  relation: PanoramaRelation;
  profile: PanoramaProfile | null;
  shareholders: PanoramaShareholder[] | null;
  /** The subjects already in this graph; their holdings are the affiliate merge caliber. */
  related: PanoramaSubject[];
  /** The chain is an unregistered limited-partnership share chain: a company in it ends the chain. */
  inPartnershipBranch: boolean;
  /** The run may still spend calls and layers. */
  budgetLeft: boolean;
};

/**
 * Decides one row of the outbound-investment list: which rule stops or continues the chain, and what
 * the platform could not confirm. The order is the reference skill's: stop conditions first, then the
 * control caliber, then the exceptions.
 */
export function classifyChild(input: ClassifyInput): PanoramaVerdict {
  const { relation, profile, shareholders, related, inPartnershipBranch, budgetLeft } = input;
  const name = relation.name;
  const notes: string[] = [];
  const gaps: string[] = [];
  const typeName = profile?.typeName ?? null;
  const scope = profile?.scope ?? null;
  const partnership = isPartnershipName(name) || (typeName ? typeName.includes("合伙") : false);
  const fundLike = isFundLike(name, scope);
  const subjectType: PanoramaSubjectType = partnership ? "partnership" : fundLike ? "fund" : "company";

  if (looksListed(profile?.econKind)) {
    notes.push(`登记经济类型含“${LISTED_ECON_KIND}”，按规则5停止下钻；证券代码与上市地未由平台工具确认。`);
    gaps.push("证券代码与上市地未由平台工具确认，按弱信号处理。");
    return { rule: "rule5_listed", label: PANORAMA_LABELS.rule5_listed, drill: false, subjectType, notes, gaps, mergedPct: relation.pct, firstLargest: null };
  }

  if (partnership && fundLike) {
    notes.push("有限合伙主体带基金字样，按规则3停止下钻，不披露其对外投资组合。");
    gaps.push("基金备案状态与管理人登记未由平台工具确认，未核实备案号。");
    return { rule: "rule3_fund", label: PANORAMA_LABELS.rule3_fund, drill: false, subjectType, notes, gaps, mergedPct: relation.pct, firstLargest: null };
  }

  if (!partnership && fundLike) {
    notes.push("公司制主体带基金字样，按规则6视同备案基金停止下钻，不披露其对外投资组合。");
    gaps.push("基金备案状态与管理人登记未由平台工具确认，未核实备案号。");
    return { rule: "rule6_company_fund", label: PANORAMA_LABELS.rule6_company_fund, drill: false, subjectType, notes, gaps, mergedPct: relation.pct, firstLargest: null };
  }

  // The control caliber: our own holding, plus the holdings of the other subjects of this graph.
  const ourPct = pctNumber(relation.pct);
  const relatedShareholders = shareholders?.filter(holder => related.some(subject => subjectMatches(subject, holder.name, holder.companyId))) ?? [];
  const mergedPct = relatedShareholders.length
    ? sumPcts(relatedShareholders.map(holder => holder.pct))
    : relation.pct;
  const mergedNumber = pctNumber(mergedPct);
  let firstLargest: boolean | null = null;
  if (shareholders?.length) {
    const ranked = shareholders
      .map(holder => ({ holder, value: pctNumber(holder.pct) }))
      .filter(entry => entry.value !== null)
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
    if (ranked.length) {
      const top = ranked[0]!;
      firstLargest = related.some(subject => subjectMatches(subject, top.holder.name, top.holder.companyId));
      if (ranked.length > 1 && ranked[1]!.value === top.value) firstLargest = firstLargest || related.some(subject => subjectMatches(subject, ranked[1]!.holder.name, ranked[1]!.holder.companyId));
    }
  }

  const controlNotes = (): void => {
    if (relatedShareholders.length > 1) {
      notes.push(`关联方合并口径：${relatedShareholders.map(holder => `${holder.name ?? "名称未提供"} ${holder.pct ?? "比例未提供"}%`).join("、")}，合计 ${mergedPct ?? "未提供"}%。`);
    } else {
      notes.push(`单一持股口径 ${relation.pct ?? "未提供"}%；关联方合并口径按本次图谱已识别主体近似计算。`);
    }
    gaps.push("关联方关系证据未接入，合并口径以本次图谱内主体近似。");
  };

  const control = (): PanoramaVerdict => {
    if (shareholders === null) {
      if (ourPct !== null && ourPct >= 50) {
        controlNotes();
        gaps.push("持股比例已达 50% 以上，未读取股东名单；关联方合并口径未计算。");
        return { rule: "rule2_control", label: PANORAMA_LABELS.rule2_control, drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
      }
      gaps.push("股东名单未取到，第一大股东判定缺少证据，该分支未继续穿透。");
      return { rule: "gap", label: PANORAMA_LABELS.gap, drill: false, subjectType, notes, gaps, mergedPct, firstLargest };
    }
    if (!shareholders.length) gaps.push("股东名单为空，第一大股东判定未确认。");
    controlNotes();
    if (mergedNumber !== null && mergedNumber >= 50) {
      return { rule: "rule2_control", label: PANORAMA_LABELS.rule2_control, drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
    }
    if (firstLargest) {
      notes.push("合并口径不足 50%，但本方为第一大股东，按参考控股继续下钻。");
      return { rule: "rule2_reference_control", label: PANORAMA_LABELS.rule2_reference_control, drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
    }
    return { rule: "rule1_minority", label: PANORAMA_LABELS.rule1_minority, drill: false, subjectType, notes, gaps, mergedPct, firstLargest };
  };

  if (partnership) {
    // Rule 3: without a filing tool the unregistered branch is the only one that can be walked, and it
    // is labelled as such wherever it appears.
    gaps.push("基金备案状态未由平台工具确认；此处按未备案分支处理。");
    if (!budgetLeft) {
      notes.push("本次已达穿透上限，该份额链未继续下钻。");
      return { rule: "budget", label: PANORAMA_LABELS.budget, drill: false, subjectType, notes, gaps, mergedPct, firstLargest };
    }
    notes.push("有限合伙份额按规则3未备案分支继续下钻，出到公司即止。");
    return { rule: "rule3_unregistered", label: PANORAMA_LABELS.rule3_unregistered, drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
  }

  if (inPartnershipBranch) {
    const investmentLike = isInvestmentLike(name, scope);
    if (investmentLike) {
      notes.push("份额链内的投资类主体按例外1继续下钻。");
      return { rule: "rule2_exception1", label: PANORAMA_LABELS.rule2_exception1, drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
    }
    notes.push("未备案份额链出到公司，按规则3即止。");
    return { rule: "rule3_exit_company", label: PANORAMA_LABELS.rule3_exit_company, drill: false, subjectType, notes, gaps, mergedPct, firstLargest };
  }

  const verdict = control();
  if (verdict.drill || verdict.rule === "gap") return verdict;

  // Exceptions 1 and 2 continue a chain that the control caliber alone would stop.
  const investmentLike = isInvestmentLike(name, scope);
  if (investmentLike) {
    const platform = scope ? containsAny(scope, INVESTMENT_SCOPE_WORDS) : false;
    const rule: PanoramaRule = platform && !containsAny(name ?? null, ["咨询"]) ? "rule2_exception2" : "rule2_exception1";
    notes.push(rule === "rule2_exception2"
      ? "有限公司形式且经营范围以投资为主，按例外2投资平台继续下钻，至公司制基金即止。"
      : "名称或经营范围带投资、管理、咨询字样，按例外1继续下钻。");
    gaps.push("例外下钻依据来自名称与经营范围原文，未接入正式规则引擎。");
    return { rule, label: PANORAMA_LABELS[rule], drill: true, subjectType, notes, gaps, mergedPct, firstLargest };
  }
  return verdict;
}

/** Whether a provider row is a relation of the subject that was asked about. */
export function rowBelongsToSubject(row: PanoramaRelation, subject: PanoramaSubject) {
  if (!row.investorName) return true;
  return subjectMatches(subject, row.investorName, null);
}

/** A relation dated before the subject existed cannot be an investment of that subject. */
export function rowPredatesSubject(row: PanoramaRelation, startDate: string | null) {
  if (!row.subscribedDate || !startDate) return false;
  const relation = row.subscribedDate.trim();
  const start = startDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(relation) || !/^\d{4}-\d{2}-\d{2}/.test(start)) return false;
  return relation < start;
}
