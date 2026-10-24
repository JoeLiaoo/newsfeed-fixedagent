/**
 * The panorama draft: layered tables, the share chains, the structure tree, the summary and the gaps.
 * Cells hold data and short labels; every explanation goes into a table note.
 */
import { PANORAMA_LABELS } from "./panorama.ts";
import { partnerRows, type PanoramaEdge, type PanoramaNode, type PanoramaRunResult } from "./panorama-run.ts";

export type PanoramaRenderInput = {
  run: PanoramaRunResult;
  root: { name: string; id: string };
  queriedAt: string;
  /** The capability names of the tools the run used. */
  toolLabels: string[];
  narrative?: { summary: string; openQuestions: string[] };
};

export type PanoramaRenderResult = { markdown: string; evidenceIds: string[] };

function cell(value: string | null | undefined) {
  if (value === null || value === undefined) return "未提供";
  const text = String(value).replace(/[|\r\n\t]+/g, " ").trim();
  return text.length ? text : "未提供";
}

function subjectTypeLabel(type: PanoramaEdge["verdict"]["subjectType"]) {
  if (type === "partnership") return "有限合伙";
  if (type === "fund") return "基金类主体";
  if (type === "company") return "公司";
  return "未提供";
}

function investedText(edge: PanoramaEdge) {
  const relation = edge.relation;
  const parts = [relation.subscribed ?? "未提供"];
  if (relation.subscribedUnit) parts.push(relation.subscribedUnit);
  return parts.join(" ");
}

function childOf(run: PanoramaRunResult, edge: PanoramaEdge) {
  return run.nodes.find(node => node.key === edge.childKey);
}

/** The layered tables: one table per subject whose investments were read. */
function layerSections(run: PanoramaRunResult) {
  const lines: string[] = [];
  const parents = run.nodes.filter(node => node.edges.length);
  parents.sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name, "zh"));
  for (const parent of parents) {
    const edges = parent.edges.map(id => run.edges.find(edge => edge.id === id)).filter((edge): edge is PanoramaEdge => Boolean(edge));
    lines.push(`### L${parent.depth + 1} · ${parent.name} 的对外投资`);
    lines.push("");
    if (!edges.length) {
      lines.push("本次未读到该主体的对外投资记录。");
      lines.push("");
      continue;
    }
    lines.push("| 编号 | 被投主体 | 主体类型 | 持股比例（原始字段） | 认缴（原始字段） | 认缴出资日期（原始字段） | 数据日期 | 处理 |");
    lines.push("|---|---|---|---:|---:|---|---|---|");
    for (const edge of edges) {
      const child = childOf(run, edge);
      lines.push(`| ${edge.id} | ${cell(child?.name ?? edge.relation.name)} | ${subjectTypeLabel(edge.verdict.subjectType)} | ${cell(edge.relation.pct)} | ${cell(investedText(edge))} | ${cell(edge.relation.subscribedDate)} | ${cell(edge.relation.dataDate)} | ${cell(edge.verdict.label)} |`);
    }
    lines.push("");
    const notes = edges.flatMap(edge => edge.verdict.notes.map(note => `${childOf(run, edge)?.name ?? edge.relation.name}：${note}`));
    const excluded = parent.excluded.map(row => `${row.name}：${row.reason}`);
    if (notes.length) lines.push(`> 表注·处理依据：${notes.join("；")}`);
    if (excluded.length) lines.push(`> 表注·已剔除记录：${excluded.join("；")}。剔除依据见第七节缺口清单。`);
    lines.push("");
  }
  return lines;
}

/** The limited-partnership share chains, with the partners the provider listed. */
function shareChainSection(run: PanoramaRunResult) {
  const chains = run.edges.filter(edge => childOf(run, edge)?.profile?.typeName?.includes("合伙") || /合伙/.test(edge.relation.name));
  const lines: string[] = ["## 二、有限合伙份额链", ""];
  if (!chains.length) {
    lines.push("本次未读到有限合伙份额。");
    lines.push("");
    return lines;
  }
  lines.push("| 编号 | 层级 | 有限合伙名称 | 合伙人名单（按持股比例排序，取前五） | 登记负责人 | 备案状态 | 入股时间（原始字段） | 我方认缴（原始字段） | 处理 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const edge of chains) {
    const child = childOf(run, edge);
    lines.push(`| ${edge.id} | L${edge.depth} | ${cell(child?.name ?? edge.relation.name)} | ${cell(child ? partnerRows(child).join("；") || null : null)} | ${cell(child?.profile?.operatorName)} | 未由平台工具确认 | ${cell(edge.relation.subscribedDate)} | ${cell(investedText(edge))} | ${cell(edge.verdict.label)} |`);
  }
  lines.push("");
  lines.push("> 表注·备案状态：平台没有基金备案查询能力，备案号与管理人登记未核实；带基金字样的有限合伙按规则3即止，未披露其对外投资组合。");
  lines.push("> 表注·执行事务合伙人：平台没有单独的合伙人角色字段，此处按登记负责人字段与股东名单列示，角色未确认。");
  lines.push("");
  return lines;
}

/** The structure tree: the chains that were followed, one line per level. */
function structureSection(run: PanoramaRunResult) {
  const lines: string[] = ["## 三、结构树（逐层持股）", ""];
  const chains: string[] = [];
  const walk = (parentKey: string, prefix: string) => {
    const parent = run.nodes.find(node => node.key === parentKey);
    const edges = parent?.edges.map(id => run.edges.find(edge => edge.id === id)).filter((edge): edge is PanoramaEdge => Boolean(edge)) ?? [];
    for (const edge of edges) {
      const child = childOf(run, edge);
      const holding = edge.relation.pct ? `（持股 ${edge.relation.pct}%）` : "（持股未提供）";
      const label = edge.verdict.subjectType === "partnership" ? "有限合伙" : edge.verdict.subjectType === "fund" ? "基金类主体" : "主体";
      chains.push(`${prefix}└─ ${child?.name ?? edge.relation.name}${holding} · ${label} · ${edge.verdict.label}`);
      if (child?.edges.length) walk(child.key, `${prefix}   `);
    }
  };
  walk(run.root.key, "");
  if (!chains.length) {
    lines.push("本次未形成可展示的持股链条。");
    lines.push("");
    return lines;
  }
  lines.push(`${run.root.name}（核查起点）`);
  lines.push(...chains);
  lines.push("");
  lines.push("> 表注·比例逐字引用平台返回的持股比例字段，未跨层相乘自算。");
  lines.push("");
  return lines;
}

/** The panorama summary: the surviving chains by subject type, and the roles worth a second look. */
function summarySection(run: PanoramaRunResult) {
  const alive = run.edges.filter(edge => !childOf(run, edge)?.exited);
  const of = (type: string) => alive.filter(edge => edge.verdict.subjectType === type);
  const lines: string[] = ["## 四、全景汇总", ""];

  const table = (title: string, edges: PanoramaEdge[]) => {
    lines.push(`### ${title}`);
    lines.push("");
    if (!edges.length) {
      lines.push("本次未读到该类主体。");
      lines.push("");
      return;
    }
    lines.push("| 编号 | 主体名称 | 层级 | 持股比例（原始字段） | 认缴（原始字段） | 处理 |");
    lines.push("|---|---|---|---:|---:|---|");
    for (const edge of edges) {
      lines.push(`| ${edge.id} | ${cell(childOf(run, edge)?.name ?? edge.relation.name)} | L${edge.depth} | ${cell(edge.relation.pct)} | ${cell(investedText(edge))} | ${cell(edge.verdict.label)} |`);
    }
    lines.push("");
  };

  table("汇总A·存续（公司）", of("company"));
  table("汇总B·存续（有限合伙）", of("partnership"));
  table("汇总C·存续（基金类主体）", of("fund"));

  lines.push("### 汇总D·关键主体清单");
  lines.push("");
  const roles = alive.filter(edge => edge.verdict.subjectType === "partnership" || edge.verdict.rule === "rule2_exception1" || edge.verdict.rule === "rule2_exception2" || edge.verdict.rule === "rule6_company_fund");
  if (!roles.length) {
    lines.push("本次未读到合伙人、管理人候选或投资平台类主体。");
    lines.push("");
  } else {
    lines.push("| 主体名称 | 角色 | 出现于 | 注册资本（原始字段） |");
    lines.push("|---|---|---|---|");
    for (const edge of roles) {
      const child = childOf(run, edge);
      const role = edge.verdict.subjectType === "partnership" ? "有限合伙·执行事务合伙人待核" : edge.verdict.rule === "rule6_company_fund" ? "公司制基金" : "投资平台/SPV";
      const parent = run.nodes.find(node => node.key === edge.parentKey);
      lines.push(`| ${cell(child?.name ?? edge.relation.name)} | ${role} | ${cell(parent?.name ?? null)} | ${cell(child?.profile?.registCapital ?? null)} |`);
    }
    lines.push("");
    lines.push("> 表注·关键主体清单只列主体与角色，不展开其对外投资；注册资本取自主体画像的原始字段。");
    lines.push("");
  }
  return lines;
}

/** The exited part, kept apart from the surviving chains. */
function exitedSection(run: PanoramaRunResult) {
  const exited = run.edges.filter(edge => childOf(run, edge)?.exited);
  const lines: string[] = ["## 五、已退出对外投资", ""];
  lines.push("> 存续与已退出分表：已注销、吊销或撤销的主体只出现在本节，其对外投资随链抑制。");
  lines.push("");
  if (!exited.length) {
    lines.push("本次未读到登记状态为已注销、吊销或撤销的主体。");
    lines.push("");
  } else {
    lines.push("| 编号 | 被投主体 | 主体类型 | 原持股主体 | 持股比例（原始字段） | 认缴（原始字段） | 退出时间 | 退出方式 | 接手股东 |");
    lines.push("|---|---|---|---|---:|---:|---|---|---|");
    for (const edge of exited) {
      const child = childOf(run, edge);
      const parent = run.nodes.find(node => node.key === edge.parentKey);
      const when = child?.status.cancellationDate ?? child?.status.revocationDate;
      lines.push(`| ${edge.id} | ${cell(child?.name ?? edge.relation.name)} | ${subjectTypeLabel(edge.verdict.subjectType)} | ${cell(parent?.name ?? null)} | ${cell(edge.relation.pct)} | ${cell(investedText(edge))} | ${cell(when)} | ${cell(child?.status.cancellationDate ? "注销" : child?.status.revocationDate ? "吊销" : null)} | 无对等工具，未确认 |`);
    }
    lines.push("");
    lines.push("> 表注·退出性质：平台没有历史退出查询工具，转让、定向回购、上市减持等退出情形与接手股东均未确认，此处不作推断。");
    lines.push("");
  }
  lines.push("> 缺口：历史退出（转让、定向回购、上市减持）与接手股东没有对等工具；年报披露只作辅助披露时间，不作为退出性质。");
  lines.push("");
  return lines;
}

/** The annual-report cross-check, used as supporting disclosure only. */
function annualSection(run: PanoramaRunResult) {
  const withDisclosure = run.nodes.filter(node => node.annualDisclosure.length || node.status.annualYears.length);
  const lines: string[] = ["## 六、年报披露交叉", ""];
  if (!withDisclosure.length) {
    lines.push("本次未读取到年报披露信息。");
    lines.push("");
    return lines;
  }
  lines.push("| 主体名称 | 年报年度 | 披露日期 | 披露被投企业 | 在投清单 |");
  lines.push("|---|---|---|---|---|");
  for (const node of withDisclosure) {
    const years = node.status.annualYears.length ? node.status.annualYears.join("、") : "未提供";
    const invested = node.status.annualHasInvestment === null ? "未提供" : node.status.annualHasInvestment ? "年报显示有对外投资" : "年报显示无对外投资";
    if (!node.annualDisclosure.length) {
      lines.push(`| ${cell(node.name)} | ${cell(years)} | ${cell(node.status.annualPublishedAt)} | 未提供 | ${cell(invested)} |`);
      continue;
    }
    for (const disclosure of node.annualDisclosure) {
      lines.push(`| ${cell(node.name)} | ${cell(disclosure.year)} | ${cell(disclosure.publishedAt)} | ${cell(disclosure.investee)} | ${cell(invested)} |`);
    }
  }
  lines.push("");
  lines.push("> 表注·年报披露日期只是披露时间，不是投资发生时间；年报披露与在投清单的差异写入缺口清单。");
  lines.push("");
  return lines;
}

/** The gaps: what the platform could not confirm, and what that means for the draft. */
function gapSection(run: PanoramaRunResult) {
  const lines: string[] = ["## 七、缺口与待核清单", ""];
  if (!run.gaps.length) {
    lines.push("本次未记录能力缺口。");
    lines.push("");
  } else {
    lines.push("| 涉及主体 | 缺口 |");
    lines.push("|---|---|");
    for (const gap of run.gaps) lines.push(`| ${cell(gap.scope)} | ${cell(gap.text)} |`);
    lines.push("");
  }
  lines.push("平台整体口径缺口（对本次全部主体成立）：");
  lines.push("");
  lines.push("- 基金备案状态、备案号与私募基金管理人登记没有对等工具，带基金字样的主体按备案未核处理。");
  lines.push("- 历史退出与接手股东没有对等工具，退出表只列登记状态可证实的注销或吊销。");
  lines.push("- 关联方关系证据没有对等工具，合并口径按本次图谱内主体近似计算。");
  lines.push("- 上市公司识别只有登记经济类型这一弱信号，证券代码与上市地未确认。");
  lines.push("- 投资发生日期没有对等工具，认缴出资日期、数据日期与披露日期不得互相替代。");
  lines.push("");
  return lines;
}

/** The collection ledger: what was read, so a later run can resume from it. */
function ledgerSection(run: PanoramaRunResult) {
  const stopRules = new Set(["rule1_minority", "rule3_fund", "rule3_exit_company", "rule5_listed", "rule6_company_fund", "budget", "gap"]);
  const lines: string[] = ["## 八、采集台账（断点续跑）", ""];
  lines.push("| 主体 | 层级 | 读取状态 | 对外投资条数 |");
  lines.push("|---|---|---|---:|");
  for (const node of run.nodes) {
    const state = node.exited
      ? "已退出·随链抑制"
      : node.edges.length
        ? "已读取并下钻"
        : node.chainRule && stopRules.has(node.chainRule)
          ? "已判定即止·未继续下钻"
          : node.profile
            ? "已读取·在投清单为空"
            : "未取到";
    lines.push(`| ${cell(node.name)} | L${node.depth} | ${state} | ${node.edges.length} |`);
  }
  lines.push("");
  lines.push(`> 本次调用 ${run.stats.calls} 次，读到 ${run.stats.nodes} 个主体，最深 ${run.stats.depth} 层。`);
  if (run.stats.limits.length) lines.push(`> 本次触及上限：${run.stats.limits.join("、")}；触及上限的部分未继续下钻，结果不完整。`);
  else if (run.stats.incomplete) lines.push("> 本次存在未能核实的数据缺口，底稿结果不完整；详见第七节。");
  if (run.stats.untreated) lines.push(`> 本次有 ${run.stats.untreated} 条关系未处理（超出上限），未进入任何表格。`);
  lines.push("");
  return lines;
}

/** The summary the model wrote, checked against the evidence numbers the draft contains. */
function narrativeSection(narrative: PanoramaRenderInput["narrative"], validIds: Set<string>) {
  const lines: string[] = ["## 九、摘要整理", ""];
  if (!narrative) {
    lines.push("本次未生成文字摘要。");
    lines.push("");
    return lines;
  }
  const summary = narrative.summary.replace(/\[?\b(S\d+)\b\]?/g, (_match, reference: string) => (validIds.has(reference) ? `[${reference}]` : `[未提供的引用编号 ${reference}]`));
  lines.push(summary);
  lines.push("");
  lines.push("## 十、待核事项");
  lines.push("");
  const questions = narrative.openQuestions.length ? narrative.openQuestions : ["复核主体匹配、字段语义、关联方口径与数据完整性。"];
  for (const question of questions) lines.push(`- ${question}`);
  lines.push("");
  return lines;
}

export function renderPanorama(input: PanoramaRenderInput): PanoramaRenderResult {
  const { run } = input;
  const evidenceIds = run.edges.map(edge => edge.id);

  const lines: string[] = [];
  lines.push("# 对外投资全景图");
  lines.push("");
  lines.push("> 范围：从已确认主体出发的对外投资穿透底稿。所有结论需人工复核。");
  lines.push("");
  lines.push(`- 核查主体：${cell(input.root.name)}`);
  lines.push(`- 主体 ID：${cell(input.root.id)}`);
  lines.push(`- 读取时间：${input.queriedAt}`);
  lines.push(`- 数据来源：${input.toolLabels.join("、")}`);
  lines.push(`- 覆盖层级：${run.stats.depth} 层；主体 ${run.stats.nodes} 个；对外投资关系 ${run.edges.length} 条；调用 ${run.stats.calls} 次`);
  lines.push(run.stats.incomplete
    ? `- 完整性：结果不完整；${run.stats.limits.length ? `触及上限（${run.stats.limits.join("、")}）` : "存在未能核实的数据缺口"}，详见第七节与第八节`
    : "- 完整性：本次未触及预算上限且未记录单体读取缺口，仍需按第八节台账核对覆盖范围");
  lines.push("");
  lines.push("## 一、逐层投资明细");
  lines.push("");
  lines.push(...layerSections(run));
  lines.push(...shareChainSection(run));
  lines.push(...structureSection(run));
  lines.push(...summarySection(run));
  lines.push(...exitedSection(run));
  lines.push(...annualSection(run));
  lines.push(...gapSection(run));
  lines.push(...ledgerSection(run));
  lines.push(...narrativeSection(input.narrative, new Set(evidenceIds)));
  lines.push("## 十一、使用说明");
  lines.push("");
  lines.push("- 表格单元格只放数据与短标签；判断依据、剔除记录与能力缺口见各表表注与第七节。");
  lines.push("- 比例、认缴额与日期均为平台返回的原始字段，未做单位换算，也未跨层相乘。");
  lines.push("- 本底稿只覆盖平台已接入能力可读到的部分；未覆盖的规则已在第七节逐项标注。");
  lines.push("");

  return { markdown: lines.join("\n"), evidenceIds };
}

export { PANORAMA_LABELS };
