/**
 * The panorama runner: it walks the outbound-investment graph of one confirmed subject, one layer at a
 * time, and stops a chain where a rule says it stops. Every subject it could not read, and every rule
 * it could not decide, becomes a gap in the draft instead of a missing row.
 *
 * A subject is read once, but the rule that decides a chain belongs to the relation: the same subject
 * can be a minority holding on one chain and a control holding on another.
 */
import { collectProviderPages } from "../provider-pages.ts";
import { hasNotFoundMarker, isBranchType, parseInvestmentPage, XINHUA_ALL_TIME } from "./data.ts";
import { mapAnnualBase, mapAnnualInvestment, mapCanRev, mapHistoryNames, mapProfile, mapRelations, mapShareholders, type PanoramaDisclosure } from "./panorama-fields.ts";
import type { XinhuaCall } from "./xinhua.ts";
import {
  classifyChild, DEFAULT_PANORAMA_BUDGET, field, isPartnershipName, PANORAMA_LABELS, pctNumber,
  rowBelongsToSubject, rowPredatesSubject, subjectMatches, text,
  type PanoramaBudget, type PanoramaProfile, type PanoramaRelation, type PanoramaRule,
  type PanoramaShareholder, type PanoramaSubject, type PanoramaVerdict,
} from "./panorama.ts";

export type { PanoramaDisclosure };
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
  stats: { calls: number; nodes: number; depth: number; limits: string[]; untreated: number; incomplete: boolean };
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

function errorText(_error: unknown) { return "平台企业信息查询未返回可用结果"; }

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
    const cached = await options.checkpoint?.get(nodeKey, kind);
    if (cached) return cached.payload;
    if (calls >= budget.maxCalls) {
      limits.push("调用次数上限");
      throw new PanoramaLimitError("调用次数上限");
    }
    calls += 1;
    const payload = await options.call(tool, args);
    await options.checkpoint?.put({ nodeKey, depth, kind, tool, payload });
    await options.heartbeat?.();
    return payload;
  };

  const addGap = (scope: string, text: string) => {
    if (!gaps.some(gap => gap.scope === scope && gap.text === text)) gaps.push({ scope, text });
  };
  const recordNodeGap = (node: PanoramaNode, detail: string, summary = detail) => {
    node.gaps.push(detail);
    addGap(node.name, summary);
  };
  /** A branch holds no outbound investments of its own: the draft says so instead of reading it as empty. */
  const recordBranchGap = (node: PanoramaNode) => {
    if (!isBranchType(node.profile?.typeName)) return;
    recordNodeGap(node, "该主体在登记上是分支机构，其对外投资清单通常为空；本次结果不代表母公司的对外投资。", "该主体是分支机构，其对外投资清单通常为空；本次结果不代表母公司的对外投资。");
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
      recordBranchGap(node);
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
            recordNodeGap(node, "画像返回名称与投资记录名称不一致，未确认是同一主体，该分支未继续下钻。");
            return node;
          }
        } catch (error) {
          if (error instanceof PanoramaLimitError) throw error;
          recordNodeGap(node, "曾用名未取到，名称不一致的主体未确认是否同一主体，该分支未继续下钻。");
          return node;
        }
      }
      if (!node.profile.name && !node.profile.companyId && !node.profile.creditCode) {
        recordNodeGap(node, "主体画像未取到（平台未返回该主体的登记信息），该分支未继续下钻。", "主体画像未取到，该分支未继续下钻。");
        return node;
      }
    } catch (error) {
      if (error instanceof PanoramaLimitError) throw error;
      recordNodeGap(node, `主体画像未取到（${errorText(error)}），该分支未继续下钻。`, "主体画像未取到，该分支未继续下钻。");
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
        recordNodeGap(node, "股东名单未取到，控制口径按单一持股口径处理。");
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
        recordBranchGap(node);
        if (node.profile.originalName) {
          node.historyNames = [...new Set([...node.historyNames, ...node.profile.originalName.split(/[;；]/).map(part => part.trim()).filter(Boolean)])];
        }
      } catch (error) {
        if (error instanceof PanoramaLimitError) { recordNodeGap(node, "已达调用次数上限，该主体尚有信息未读取或交叉核验。"); break; }
        recordNodeGap(node, `主体画像未取到（${errorText(error)}），该主体未继续下钻。`, "主体画像未取到，该主体未继续下钻。");
        continue;
      }
    }
    if (!node.profile.name && !node.profile.companyId && !node.profile.creditCode) {
      recordNodeGap(node, "主体画像未取到（平台未返回该主体的登记信息），该主体未继续下钻。", "主体画像未取到，该主体未继续下钻。");
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
        if (error instanceof PanoramaLimitError) { recordNodeGap(node, "已达调用次数上限，该主体尚有信息未读取或交叉核验。"); break; }
        recordNodeGap(node, "注销吊销记录未取到，注销或吊销日期缺失。");
      }
      recordNodeGap(node, "登记状态显示该主体已注销、吊销或撤销，其对外投资随链抑制。");
      continue;
    }

    // The outbound-investment list of this subject.
    let relations: PanoramaRelation[] = [];
    let relationsPartial = false;
    let providerSaysEmpty = false;
    let providerHasNoRecord = false;
    try {
      const creditCode = node.profile?.creditCode?.trim();
      const pages = await collectProviderPages<Record<string, unknown>>({
        pageSize: 50, maxPages: 10, identity: row => field(row, "record_id", "company_id", "comp_id"),
        fetchPage: async (offset, limit) => {
          const page = parseInvestmentPage(await providerCall("get_direct_investment", {
            query: creditCode || node.name, query_type: creditCode ? "credit_code" : "company_name",
            limit, offset, time: XINHUA_ALL_TIME,
          }, node.key, node.depth, `relations:${offset}`));
          if (page.notFound) providerHasNoRecord = true;
          if (!page.rows.length && page.hasMore === false) providerSaysEmpty = true;
          return page;
        },
      });
      relations = mapRelations(pages.rows);
      relationsPartial = !pages.complete && !(providerSaysEmpty && !pages.rows.length);
    } catch (error) {
      if (error instanceof PanoramaLimitError) { recordNodeGap(node, "已达调用次数上限，该主体尚有信息未读取或交叉核验。"); break; }
      recordNodeGap(node, `对外直接投资未取到（${errorText(error)}）。`, "对外直接投资未取到，该主体的对外投资未覆盖。");
    }
    if (providerHasNoRecord) {
      // The provider answered "no such record". That is an answer about the coverage, not an
      // unfinished page: the draft says the list is not covered instead of reading it as a partial read.
      relations = [];
      relationsPartial = false;
      recordNodeGap(node, "平台企业信息查询未返回该主体的对外投资记录（查询结果 not_found）；不能据此断定该主体没有对外投资。", "对外直接投资列表未取到（平台返回 not_found），该主体的对外投资未覆盖。");
    } else if (relationsPartial) {
      recordNodeGap(node, "对外直接投资分页未读完，该主体的对外投资可能不完整。");
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
        const annualRaw = await providerCall("get_company_annual_report_base_info", subjectQuery(subject, subject.creditCode ?? null), node.key, node.depth, "annual_base");
        const annual = mapAnnualBase(annualRaw);
        node.status.annualStatus = annual.annualStatus;
        node.status.annualPublishedAt = annual.annualPublishedAt;
        node.status.annualHasInvestment = annual.annualHasInvestment;
        node.status.annualYears = annual.annualYears;
        if (hasNotFoundMarker(annualRaw)) {
          recordNodeGap(node, "平台企业信息查询未返回该主体的年报基础信息（查询结果 not_found）；该主体的年报披露未覆盖。");
        } else if (annual.annualYears.length) {
          const investmentRaw = await providerCall("get_company_annual_report_investment_info", subjectQuery(subject, subject.creditCode ?? null), node.key, node.depth, "annual_investment");
          const disclosure = mapAnnualInvestment(investmentRaw);
          node.annualDisclosure = disclosure;
          if (disclosure.length) {
            recordNodeGap(node, "年报披露过对外投资但当前在投清单为空，退出性质未由平台工具确认。", "年报披露过对外投资但当前在投清单为空；退出性质与接手股东无对等工具，无法确认退出时间与方式。");
          } else if (hasNotFoundMarker(investmentRaw)) {
            recordNodeGap(node, "平台企业信息查询未返回该主体的年报对外投资明细（查询结果 not_found）；年报披露的对外投资未覆盖。");
          }
        }
      } catch (error) {
        if (error instanceof PanoramaLimitError) { recordNodeGap(node, "已达调用次数上限，该主体尚有信息未读取或交叉核验。"); break; }
        recordNodeGap(node, "年报信息未取到，该主体的对外投资为空这一事实尚未交叉核验。");
      }
      continue;
    }

    // maxDepth counts investment layers below the confirmed root. Once a node at that
    // depth has a readable outbound list, disclose those rows as untreated without
    // fetching profiles or emitting a fifth (or later) layer into the report.
    if (node.depth >= budget.maxDepth) {
      for (const relation of usable) node.excluded.push({ name: relation.name, reason: "超出本次层级上限" });
      untreated += usable.length;
      limits.push("层级上限");
      recordNodeGap(node, `已达层级上限，该主体另有 ${usable.length} 条对外投资关系未读取主体详情或继续下钻。`);
      continue;
    }

    const pending: PanoramaNode[] = [];
    let treated = 0;
    let budgetUntreated = 0;
    for (const relation of usable) {
      if (treated >= budget.maxChildrenPerNode) {
        node.excluded.push({ name: relation.name, reason: "超出本节点处理上限" });
        untreated += 1;
        budgetUntreated += 1;
        continue;
      }
      if (nodes.size >= budget.maxNodes) {
        limits.push("主体数上限");
        node.excluded.push({ name: relation.name, reason: "超出本次主体数上限" });
        untreated += 1;
        budgetUntreated += 1;
        continue;
      }
      const depth = node.depth + 1;
      let child: PanoramaNode;
      try {
        // Only providerCall can decide whether a read needs a fresh query: cached
        // profiles and shareholders remain usable even when this run spent its budget.
        child = await readSubject(relation, depth);
      } catch (error) {
        if (!(error instanceof PanoramaLimitError)) throw error;
        const key = relation.companyId ? `company:${relation.companyId}` : `name:${relation.name}`;
        const partial = nodes.get(key);
        if (partial) recordNodeGap(partial, "已达调用次数上限，主体核验未完成，该关系未判定或继续下钻。");
        const remaining = usable.slice(usable.indexOf(relation));
        for (const skipped of remaining) node.excluded.push({ name: skipped.name, reason: "超出本次调用次数上限" });
        untreated += remaining.length;
        budgetUntreated += remaining.length;
        break;
      }
      treated += 1;
      const repeated = edges.find(edge => edge.parentKey === node.key && edge.childKey === child.key);
      if (repeated) {
        // The same relation reached twice: one row per relation, and the first decision stands.
        recordNodeGap(node, "同一出资关系重复出现，按首次到达的链条判定。", `同一出资关系到达 ${child.name} 多次，按首次链条判定。`);
        continue;
      }
      const edge = decide(node, child, relation, depth);
      if (child.chainRule === null) child.chainRule = edge.verdict.rule;
      if (!related.some(entry => entry.key === child.key)) {
        related.push({ key: child.key, name: child.name, companyId: child.profile?.companyId ?? relation.companyId ?? null, aliases: child.historyNames, creditCode: child.profile?.creditCode ?? null });
      }
      if (edge.verdict.drill && !child.exited) pending.push(child);
    }
    if (treated >= budget.maxChildrenPerNode && usable.length > budget.maxChildrenPerNode) limits.push("单节点处理上限");
    if (budgetUntreated) {
      const reasons = [...new Set(node.excluded.flatMap(row => {
        if (row.reason === "超出本节点处理上限") return ["单节点处理上限"];
        if (row.reason === "超出本次主体数上限") return ["主体数上限"];
        if (row.reason === "超出本次调用次数上限") return ["调用次数上限"];
        return [];
      }))];
      recordNodeGap(node, `${budgetUntreated} 条关系因${reasons.join("、")}未处理。`);
    }
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
    stats: { calls, nodes: ordered.length, depth, limits: [...new Set(limits)], untreated, incomplete: limits.length > 0 || gaps.length > 0 },
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
