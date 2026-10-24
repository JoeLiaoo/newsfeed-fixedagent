/**
 * The panorama runner: it walks the outbound-investment graph of one confirmed subject, one layer at a
 * time, and stops a chain where a rule says it stops. Every subject it could not read, and every rule
 * it could not decide, becomes a gap in the draft instead of a missing row.
 *
 * A subject is read once, but the rule that decides a chain belongs to the relation: the same subject
 * can be a minority holding on one chain and a control holding on another.
 */
import { collectProviderPages } from "../provider-pages.ts";
import { extractObject, findArrays, parseInvestmentPage, XINHUA_ALL_TIME } from "./data.ts";
import type { XinhuaCall } from "./xinhua.ts";
import {
  classifyChild, DEFAULT_PANORAMA_BUDGET, field, isPartnershipName, PANORAMA_LABELS, pctNumber,
  rowBelongsToSubject, rowPredatesSubject, subjectMatches, text,
  type PanoramaBudget, type PanoramaProfile, type PanoramaRelation, type PanoramaRule,
  type PanoramaShareholder, type PanoramaSubject, type PanoramaVerdict,
} from "./panorama.ts";

export type PanoramaCheckpointLine = { seq: number; nodeKey: string; depth: number; kind: string; tool: string; payload: unknown };

export type PanoramaCheckpointStore = {
  get(nodeKey: string, kind: string): Promise<PanoramaCheckpointLine | null>;
  put(line: Omit<PanoramaCheckpointLine, "seq">): Promise<void>;
};

export type PanoramaStatus = {
  profileStatus: string | null;
  revocationDate: string | null;
  cancellationDate: string | null;
  annualStatus: string | null;
  annualPublishedAt: string | null;
  annualHasInvestment: boolean | null;
  annualYears: string[];
};

export type PanoramaDisclosure = { year: string | null; publishedAt: string | null; investee: string | null };

/** A subject of the graph: what the provider says about it. */
export type PanoramaNode = {
  key: string;
  name: string;
  /** The depth of the first chain the subject appeared in. */
  depth: number;
  profile: PanoramaProfile | null;
  shareholders: PanoramaShareholder[] | null;
  status: PanoramaStatus;
  historyNames: string[];
  annualDisclosure: PanoramaDisclosure[];
  /** Rows the platform refused to read into the tables, each with its reason. */
  excluded: Array<{ name: string; reason: string }>;
  /** The gaps that belong to this subject. */
  gaps: string[];
  /** The relations of this subject that were read. */
  edges: string[];
  /** The rule of the chain that reached this subject; it decides how its own relations are read. */
  chainRule: PanoramaRule | null;
  /** Whether the subject is treated as exited and its chain suppressed. */
  exited: boolean;
};

/** One investment relation, with the rule that decides what happens to it. */
export type PanoramaEdge = {
  id: string;
  parentKey: string;
  childKey: string;
  /** The layer of the subject the relation points at. */
  depth: number;
  relation: PanoramaRelation;
  verdict: PanoramaVerdict;
  gaps: string[];
};

export type PanoramaRunResult = {
  root: PanoramaNode;
  nodes: PanoramaNode[];
  edges: PanoramaEdge[];
  gaps: Array<{ scope: string; text: string }>;
  stats: { calls: number; nodes: number; depth: number; limits: string[]; untreated: number };
};

export type PanoramaRunOptions = {
  call: XinhuaCall;
  root: PanoramaSubject;
  budget?: PanoramaBudget;
  checkpoint?: PanoramaCheckpointStore;
  /** Called after every provider call, so the worker can keep the task lease alive. */
  heartbeat?: () => void | Promise<void>;
};

const EXPIRED_STATUS_WORDS = ["注销", "吊销", "撤销", "解散", "清算"];

export class PanoramaLimitError extends Error {
  readonly limit: string;
  constructor(limit: string) { super(limit); this.limit = limit; }
}

function statusIsExpired(status: string | null) {
  if (!status) return false;
  return EXPIRED_STATUS_WORDS.some(word => status.includes(word));
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "工具调用失败";
}

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

export function mapAnnualBase(raw: unknown): PanoramaStatus {
  const groups = findArrays(extractObject(raw), ["company_annual_report_base_info", "results", "items", "data"]);
  const rows = groups.flat();
  const years = rows.map(row => field(row, "report_year")).filter((year): year is string => Boolean(year)).sort();
  const newest = rows.find(row => field(row, "report_year") === years[years.length - 1]) ?? null;
  const invested = newest ? text(newest.is_invested) : null;
  return {
    profileStatus: null,
    revocationDate: null,
    cancellationDate: null,
    annualStatus: newest ? field(newest, "company_status_name", "company_status") : null,
    annualPublishedAt: newest ? field(newest, "publish_date") : null,
    annualHasInvestment: invested === null ? null : invested === "1",
    annualYears: years,
  };
}

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

/** The query a provider call uses for a subject: the credit code when it is known, the registered name otherwise. */
function subjectQuery(subject: PanoramaSubject, creditCode: string | null) {
  const code = creditCode?.trim();
  return code ? { query: code, query_type: "credit_code" } : { query: subject.name, query_type: "company_name" };
}

/**
 * Walks the graph. A subject is read once; a chain is followed while a rule says it continues. A read
 * that fails marks that subject and does not stop its siblings.
 */
export async function runPanorama(options: PanoramaRunOptions): Promise<PanoramaRunResult> {
  const budget = options.budget ?? DEFAULT_PANORAMA_BUDGET;
  const limits: string[] = [];
  const gaps: Array<{ scope: string; text: string }> = [];
  const nodes = new Map<string, PanoramaNode>();
  const edges: PanoramaEdge[] = [];
  const related: PanoramaSubject[] = [];
  let calls = 0;
  let untreated = 0;

  const providerCall = async (tool: Parameters<XinhuaCall>[0], args: Record<string, unknown>, nodeKey: string, depth: number, kind: string) => {
    if (calls >= budget.maxCalls) {
      limits.push("调用次数上限");
      throw new PanoramaLimitError("调用次数上限");
    }
    calls += 1;
    const cached = await options.checkpoint?.get(nodeKey, kind);
    if (cached) return cached.payload;
    const payload = await options.call(tool, args);
    await options.checkpoint?.put({ nodeKey, depth, kind, tool, payload });
    await options.heartbeat?.();
    return payload;
  };

  const addGap = (scope: string, text: string) => {
    if (!gaps.some(gap => gap.scope === scope && gap.text === text)) gaps.push({ scope, text });
  };

  const rootNode: PanoramaNode = {
    key: options.root.key, name: options.root.name, depth: 0,
    profile: null, shareholders: null,
    status: { profileStatus: null, revocationDate: null, cancellationDate: null, annualStatus: null, annualPublishedAt: null, annualHasInvestment: null, annualYears: [] },
    historyNames: [], annualDisclosure: [], excluded: [], gaps: [], edges: [], chainRule: null, exited: false,
  };
  nodes.set(rootNode.key, rootNode);
  related.push({ key: rootNode.key, name: rootNode.name, companyId: options.root.companyId, aliases: options.root.aliases, creditCode: options.root.creditCode ?? null });

  /** Reads a subject once: its registration picture and, when the control caliber needs it, its shareholders. */
  const readSubject = async (relation: PanoramaRelation, depth: number): Promise<PanoramaNode> => {
    const key = relation.companyId ? `company:${relation.companyId}` : `name:${relation.name}`;
    const existing = nodes.get(key);
    if (existing) return existing;
    const node: PanoramaNode = {
      key, name: relation.name, depth, profile: null, shareholders: null,
      status: { profileStatus: null, revocationDate: null, cancellationDate: null, annualStatus: null, annualPublishedAt: null, annualHasInvestment: null, annualYears: [] },
      historyNames: [], annualDisclosure: [], excluded: [], gaps: [], edges: [], chainRule: null, exited: false,
    };
    nodes.set(key, node);
    try {
      const raw = await providerCall("get_company_profile", { query: relation.name, query_type: "company_name", time: XINHUA_ALL_TIME }, key, depth, "profile");
      node.profile = mapProfile(raw);
      node.status.profileStatus = node.profile.status;
      if (node.profile.originalName) {
        node.historyNames = [...new Set([...node.historyNames, ...node.profile.originalName.split(/[;；]/).map(part => part.trim()).filter(Boolean)])];
      }
      if (node.profile.name && node.profile.name !== relation.name) {
        // The picture answers with another name: it is the same subject only when the registry lists the
        // investment record's name as one of its old names.
        try {
          const history = mapHistoryNames(await providerCall("get_history_company_name", { query: relation.name, query_type: "company_name" }, key, depth, "history_names"));
          node.historyNames = [...new Set([...node.historyNames, ...history])];
          if (!history.includes(relation.name)) {
            node.gaps.push("画像返回名称与投资记录名称不一致，未确认是同一主体，该分支未继续下钻。");
            addGap(node.name, "画像返回名称与投资记录名称不一致，未确认是同一主体，该分支未继续下钻。");
            return node;
          }
        } catch (error) {
          if (error instanceof PanoramaLimitError) throw error;
          node.gaps.push("曾用名未取到，名称不一致的主体未确认是否同一主体，该分支未继续下钻。");
          addGap(node.name, "曾用名未取到，名称不一致的主体未确认是否同一主体，该分支未继续下钻。");
          return node;
        }
      }
      if (!node.profile.name && !node.profile.companyId && !node.profile.creditCode) {
        node.gaps.push("主体画像未取到（平台未返回该主体的登记信息），该分支未继续下钻。");
        addGap(node.name, "主体画像未取到，该分支未继续下钻。");
        return node;
      }
    } catch (error) {
      if (error instanceof PanoramaLimitError) throw error;
      node.gaps.push(`主体画像未取到（${errorText(error)}），该分支未继续下钻。`);
      addGap(node.name, "主体画像未取到，该分支未继续下钻。");
      return node;
    }

    // The shareholders decide the control caliber; they are only read when the row alone cannot.
    const holding = pctNumber(relation.pct);
    const needsShareholders = holding === null || holding < 50 || isPartnershipName(relation.name) || (node.profile?.typeName ?? "").includes("合伙");
    if (needsShareholders) {
      try {
        const query = node.profile?.creditCode?.trim()
          ? { query: node.profile.creditCode.trim(), query_type: "credit_code" }
          : { query: relation.name, query_type: "company_name" };
        node.shareholders = mapShareholders(await providerCall("get_company_shareholder", query, key, depth, "shareholders"));
      } catch (error) {
        if (error instanceof PanoramaLimitError) throw error;
        node.shareholders = null;
        node.gaps.push("股东名单未取到，控制口径按单一持股口径处理。");
        addGap(node.name, "股东名单未取到，控制口径按单一持股口径处理。");
      }
    }
    return node;
  };

  /** Decides one relation: which rule stops or continues its chain. */
  const decide = (parent: PanoramaNode, child: PanoramaNode, relation: PanoramaRelation, depth: number): PanoramaEdge => {
    // The branch a chain runs in follows the rule that reached the parent.
    const inPartnershipBranch = parent.chainRule === "rule3_unregistered";
    const budgetLeft = depth < budget.maxDepth && nodes.size < budget.maxNodes && calls < budget.maxCalls;
    const verdict = classifyChild({
      relation, profile: child.profile, shareholders: child.shareholders, related, inPartnershipBranch, budgetLeft,
    });
    const edge: PanoramaEdge = {
      id: `S${edges.length + 1}`, parentKey: parent.key, childKey: child.key, depth, relation, verdict, gaps: [...verdict.gaps],
    };
    if (depth > budget.maxDepth) {
      edge.verdict = { ...verdict, rule: "budget", label: PANORAMA_LABELS.budget, drill: false };
      edge.gaps.push("已达本次层级上限，该分支未继续下钻。");
      limits.push("层级上限");
    }
    edges.push(edge);
    parent.edges.push(edge.id);
    for (const gap of edge.gaps) addGap(child.name, gap);
    return edge;
  };

  const stack: PanoramaNode[] = [rootNode];
  while (stack.length) {
    const node = stack.pop()!;
    const subject: PanoramaSubject = { key: node.key, name: node.name, companyId: node.profile?.companyId ?? null, aliases: node.historyNames, creditCode: node.profile?.creditCode ?? null };

    // The subject's own registration state decides whether its chain is read at all.
    if (!node.profile) {
      try {
        const raw = await providerCall("get_company_profile", { ...subjectQuery(subject, subject.creditCode ?? null), time: XINHUA_ALL_TIME }, node.key, node.depth, "profile");
        node.profile = mapProfile(raw);
        node.status.profileStatus = node.profile.status;
        if (node.profile.originalName) {
          node.historyNames = [...new Set([...node.historyNames, ...node.profile.originalName.split(/[;；]/).map(part => part.trim()).filter(Boolean)])];
        }
      } catch (error) {
        if (error instanceof PanoramaLimitError) { limits.push("调用次数上限"); break; }
        node.gaps.push(`主体画像未取到（${errorText(error)}），该主体未继续下钻。`);
        addGap(node.name, "主体画像未取到，该主体未继续下钻。");
        continue;
      }
    }
    if (!node.profile.name && !node.profile.companyId && !node.profile.creditCode) {
      node.gaps.push("主体画像未取到（平台未返回该主体的登记信息），该主体未继续下钻。");
      addGap(node.name, "主体画像未取到，该主体未继续下钻。");
      continue;
    }

    const expired = statusIsExpired(node.profile?.status ?? null);
    if (expired) {
      node.exited = true;
      try {
        const canRev = mapCanRev(await providerCall("get_company_can_rev", subjectQuery(subject, subject.creditCode ?? null), node.key, node.depth, "can_rev"));
        node.status.revocationDate = canRev.revocationDate;
        node.status.cancellationDate = canRev.cancellationDate;
      } catch (error) {
        if (error instanceof PanoramaLimitError) { limits.push("调用次数上限"); break; }
        node.gaps.push("注销吊销记录未取到，注销或吊销日期缺失。");
        addGap(node.name, "注销吊销记录未取到，注销或吊销日期缺失。");
      }
      node.gaps.push("登记状态显示该主体已注销、吊销或撤销，其对外投资随链抑制。");
      continue;
    }

    // The outbound-investment list of this subject.
    let relations: PanoramaRelation[] = [];
    let relationsPartial = false;
    let providerSaysEmpty = false;
    try {
      const creditCode = node.profile?.creditCode?.trim();
      const pages = await collectProviderPages<Record<string, unknown>>({
        pageSize: 50, maxPages: 10, identity: row => field(row, "record_id", "company_id", "comp_id"),
        fetchPage: async (offset, limit) => {
          const page = parseInvestmentPage(await providerCall("get_direct_investment", {
            query: creditCode || node.name, query_type: creditCode ? "credit_code" : "company_name",
            limit, offset, time: XINHUA_ALL_TIME,
          }, node.key, node.depth, `relations:${offset}`));
          if (!page.rows.length && page.hasMore === false) providerSaysEmpty = true;
          return page;
        },
      });
      relations = mapRelations(pages.rows);
      // A provider that answers "no rows, no further page" has read the whole list; only an unfinished
      // page makes the draft incomplete.
      relationsPartial = !pages.complete && !(providerSaysEmpty && !pages.rows.length);
    } catch (error) {
      if (error instanceof PanoramaLimitError) { limits.push("调用次数上限"); break; }
      node.gaps.push(`对外直接投资未取到（${errorText(error)}）。`);
      addGap(node.name, "对外直接投资未取到，该主体的对外投资未覆盖。");
    }
    if (relationsPartial) {
      node.gaps.push("对外直接投资分页未读完，该主体的对外投资可能不完整。");
      addGap(node.name, "对外直接投资分页未读完，该主体的对外投资可能不完整。");
    }

    // Existence check: a row of another shareholder, or a row dated before the subject existed, is not
    // an investment of this subject.
    const usable: PanoramaRelation[] = [];
    for (const relation of relations) {
      if (relation.deleted) { node.excluded.push({ name: relation.name, reason: "记录标记为已删除" }); continue; }
      if (!rowBelongsToSubject(relation, subject)) { node.excluded.push({ name: relation.name, reason: "投资方名称与查询主体不符" }); continue; }
      if (rowPredatesSubject(relation, node.profile?.startDate ?? null)) { node.excluded.push({ name: relation.name, reason: "认缴出资日期早于主体成立日期" }); continue; }
      usable.push(relation);
    }

    if (!usable.length) {
      // A subject with no live investment is checked against its annual reports before it is called empty.
      try {
        const annual = mapAnnualBase(await providerCall("get_company_annual_report_base_info", subjectQuery(subject, subject.creditCode ?? null), node.key, node.depth, "annual_base"));
        node.status.annualStatus = annual.annualStatus;
        node.status.annualPublishedAt = annual.annualPublishedAt;
        node.status.annualHasInvestment = annual.annualHasInvestment;
        node.status.annualYears = annual.annualYears;
        if (annual.annualYears.length) {
          const disclosure = mapAnnualInvestment(await providerCall("get_company_annual_report_investment_info", subjectQuery(subject, subject.creditCode ?? null), node.key, node.depth, "annual_investment"));
          node.annualDisclosure = disclosure;
          if (disclosure.length) {
            node.gaps.push("年报披露过对外投资但当前在投清单为空，退出性质未由平台工具确认。");
            addGap(node.name, "年报披露过对外投资但当前在投清单为空；退出性质与接手股东无对等工具，无法确认退出时间与方式。");
          }
        }
      } catch (error) {
        if (error instanceof PanoramaLimitError) { limits.push("调用次数上限"); break; }
        node.gaps.push("年报信息未取到，该主体的对外投资为空这一事实尚未交叉核验。");
        addGap(node.name, "年报信息未取到，该主体的对外投资为空这一事实尚未交叉核验。");
      }
      continue;
    }

    const pending: PanoramaNode[] = [];
    let treated = 0;
    for (const relation of usable) {
      if (treated >= budget.maxChildrenPerNode) {
        node.excluded.push({ name: relation.name, reason: "超出本节点处理上限" });
        untreated += 1;
        continue;
      }
      if (nodes.size >= budget.maxNodes) {
        limits.push("主体数上限");
        node.excluded.push({ name: relation.name, reason: "超出本次主体数上限" });
        untreated += 1;
        continue;
      }
      if (calls >= budget.maxCalls) {
        limits.push("调用次数上限");
        node.excluded.push({ name: relation.name, reason: "超出本次调用次数上限" });
        untreated += 1;
        break;
      }
      treated += 1;
      const depth = node.depth + 1;
      const child = await readSubject(relation, depth);
      const repeated = edges.find(edge => edge.parentKey === node.key && edge.childKey === child.key);
      if (repeated) {
        // The same relation reached twice: one row per relation, and the first decision stands.
        node.gaps.push("同一出资关系重复出现，按首次到达的链条判定。");
        addGap(child.name, "同一出资关系重复出现，按首次到达的链条判定。");
        continue;
      }
      const edge = decide(node, child, relation, depth);
      if (child.chainRule === null) child.chainRule = edge.verdict.rule;
      if (!related.some(entry => entry.key === child.key)) {
        related.push({ key: child.key, name: child.name, companyId: child.profile?.companyId ?? relation.companyId ?? null, aliases: child.historyNames, creditCode: child.profile?.creditCode ?? null });
      }
      if (edge.verdict.drill && !child.exited) pending.push(child);
    }
    if (treated >= budget.maxChildrenPerNode) limits.push("单节点处理上限");
    // One branch is finished before the next one starts.
    for (const child of pending.reverse()) stack.push(child);
  }

  const ordered = [...nodes.values()];
  const depth = edges.reduce((max, edge) => Math.max(max, edge.depth), 0);
  return {
    root: rootNode,
    nodes: ordered,
    edges,
    gaps,
    stats: { calls, nodes: ordered.length, depth, limits: [...new Set(limits)], untreated },
  };
}

/** The partners of a limited partnership, quoted for the draft. */
export function partnerRows(node: PanoramaNode) {
  return (node.shareholders ?? [])
    .filter(holder => holder.name)
    .slice(0, 5)
    .map(holder => `${holder.name}（持股 ${holder.pct ?? "未提供"}%，认缴 ${holder.subscribed ?? "未提供"}${holder.subscribedUnit ? ` ${holder.subscribedUnit}` : ""}）`);
}

/** Whether a subject of this graph is one of ours, used by the shareholder merge caliber. */
export function isOwnSubject(subject: PanoramaSubject, name: string | null | undefined, companyId: string | null | undefined) {
  return subjectMatches(subject, name, companyId);
}
