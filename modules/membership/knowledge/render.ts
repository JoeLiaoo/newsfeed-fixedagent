// Turning a draft into a page. The platform renders the page, not the model: the section order, the
// table shape, the coverage counts and the source labels are all decided here, so every page in the
// library reads the same way and can be checked by machine.
import type { CompiledDraft, Correction, Finding, PageDraft, SourceRecord } from "./schema.ts";
import { FRESHNESS_TIERS, isRealDay, today } from "./catalog.ts";

export type Coverage = {
  analysts: number;
  firms: number;
  reports: number;
  first_report: string | null;
  last_report: string | null;
};

const UNKNOWN = "未知";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a value is a day the platform knows: the shape of a date and a day the calendar has. A
 * string that only looks like a date (2026-02-30) is not a date, so it never counts as one, and it
 * never reaches the timeline or the freshness of a page.
 */
export function isKnownDate(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  return isRealDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** A single-line value for the frontmatter. */
function line(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cell(value: string | null | undefined): string {
  const text = line(value);
  return text.replace(/\|/g, "\\|") || UNKNOWN;
}

/**
 * The paragraphs of a statement. A page that holds several materials keeps each material's
 * statement apart, so the reader can tell whose words they are.
 */
export function paragraphs(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\n{2,}/)
    .map(part => line(part))
    .filter(Boolean);
}

/**
 * The coverage of a page, counted from what the page itself names: distinct analysts, distinct
 * institutions and the sources cited, and the first and last known source dates. Material whose author
 * or date is unknown stays out of the count; the content itself stays on the page.
 */
export function coverageOf(page: PageDraft): Coverage {
  const analysts = new Set<string>();
  const firms = new Set<string>();
  const sources = new Set<string>();
  const dates: string[] = [];
  for (const stance of page.stances) {
    if (stance.analyst && stance.analyst !== UNKNOWN) analysts.add(stance.analyst);
    if (stance.institution && stance.institution !== UNKNOWN) firms.add(stance.institution);
    if (stance.sourceRef) sources.add(stance.sourceRef);
    if (isKnownDate(stance.date)) dates.push(stance.date);
  }
  for (const entry of page.timeline) {
    if (entry.sourceRefs?.length) for (const ref of entry.sourceRefs) sources.add(ref);
    if (isKnownDate(entry.date)) dates.push(entry.date);
    for (const note of entry.notes ?? []) if (isKnownDate(note.date)) dates.push(note.date);
  }
  for (const item of page.expectations ?? []) if (isKnownDate(item.date)) dates.push(item.date);
  dates.sort();
  return {
    analysts: analysts.size,
    firms: firms.size,
    reports: sources.size,
    first_report: dates[0] ?? null,
    last_report: dates.at(-1) ?? null,
  };
}

/** The pages' freshness, read from the newest source date on the page. */
export function pageFreshness(page: PageDraft, now = new Date()): { tier: (typeof FRESHNESS_TIERS)[number]; lastReport: string | null } {
  const coverage = coverageOf(page);
  const days = coverage.last_report ? (now.getTime() - Date.parse(`${coverage.last_report}T00:00:00Z`)) / 86_400_000 : Infinity;
  if (!coverage.last_report) return { tier: "undated", lastReport: null };
  if (days <= 183) return { tier: "fresh", lastReport: coverage.last_report };
  if (days <= 365) return { tier: "semi", lastReport: coverage.last_report };
  return { tier: "stale", lastReport: coverage.last_report };
}

function sourceLabel(source: SourceRecord | undefined, ref: string): string {
  if (!source) return ref;
  const who = source.institution ?? UNKNOWN;
  const when = source.date ?? UNKNOWN;
  return `${who} ${when}`;
}

/** The timeline of a page: newest first, and the entries without a date at the end. */
export function orderedTimeline(page: PageDraft): PageDraft["timeline"] {
  const dated = page.timeline.filter(entry => isKnownDate(entry.date)).sort((left, right) => right.date.localeCompare(left.date));
  const undated = page.timeline.filter(entry => !isKnownDate(entry.date));
  return [...dated, ...undated];
}

/**
 * Applies the Auditor's corrections. It may withdraw an entry or lower an attribution to unknown; it
 * may never add one, so a correction can only make a page smaller or less certain than the draft.
 *
 * The Auditor's indices point at the draft it read, so they are read as they are and never as the
 * indices of a list that is already being shortened: the attributions are lowered on the original
 * entries first, and the withdrawn entries are removed afterwards, by their original index.
 */
export function applyCorrections(draft: CompiledDraft, corrections: Correction[]): { draft: CompiledDraft; findings: Finding[] } {
  const findings: Finding[] = [];
  const pages = draft.pages.map(original => {
    const page = structuredClone(original);
    const own = corrections.filter(item => item.pageSlug === page.slug);
    // The entries to withdraw, by the index they had in the draft the Auditor read.
    const withdrawn = new Map<string, Set<number>>();
    for (const correction of own) {
      const reason = line(correction.reason) || "独立复核要求调整";
      if (correction.section === "consensus") {
        if (correction.action === "remove" && !page.consensus.startsWith("（该共识经独立复核撤回")) {
          page.consensus = "（该共识经独立复核撤回：缺少原文依据）";
          findings.push({
            level: "P1",
            category: "attribution-vague",
            target: page.slug,
            message: `共识段被独立复核调整：${reason}`,
            evidence: null,
          });
        }
        continue;
      }
      const list = page[correction.section] as Array<Record<string, unknown>> | undefined;
      if (!list) continue;
      const index = correction.index;
      if (!Number.isInteger(index) || index < 0 || index >= list.length) {
        findings.push({
          level: "advisory",
          category: "correction-out-of-range",
          target: `${page.slug}#${correction.section}[${index}]`,
          message: `复核指向的${sectionLabel(correction.section)}不存在或已越界，已忽略：${reason}`,
          evidence: null,
        });
        continue;
      }
      if (correction.action === "remove") {
        const indices = withdrawn.get(correction.section) ?? new Set<number>();
        indices.add(index);
        withdrawn.set(correction.section, indices);
        findings.push({
          level: "P1",
          category: "claim-without-evidence",
          target: `${page.slug}#${correction.section}[${index}]`,
          message: `撤回一条缺少依据的${sectionLabel(correction.section)}：${reason}`,
          evidence: null,
        });
        continue;
      }
      if (correction.field) {
        list[index]![correction.field] = UNKNOWN;
        findings.push({
          level: "P1",
          category: "attribution-missing",
          target: `${page.slug}#${correction.section}[${index}]`,
          message: `归因改为「未知」：${reason}`,
          evidence: null,
        });
      }
    }
    // The withdrawn entries leave the list by their original index, so the entries after them keep
    // the meaning the Auditor gave them.
    for (const [section, indices] of withdrawn) {
      const list = page[section as keyof PageDraft] as unknown as Array<Record<string, unknown>>;
      if (!Array.isArray(list)) continue;
      const kept = list.filter((_entry, index) => !indices.has(index));
      (page as unknown as Record<string, unknown>)[section] = kept;
    }
    return page;
  });
  return { draft: { ...draft, pages }, findings };
}

function sectionLabel(section: string): string {
  return ({
    stances: "观点",
    timeline: "时间线条目",
    divergences: "争议点",
    risks: "风险条目",
    marginalChanges: "边际变化条目",
    expectations: "一致预期行",
  } as Record<string, string>)[section] ?? "条目";
}

function frontmatter(page: PageDraft, coverage: Coverage): string {
  const lines = [
    "---",
    `slug: ${line(page.slug)}`,
    `title: ${line(page.title)}`,
  ];
  if (page.targetType) lines.push(`target_type: ${line(page.targetType)}`);
  if (page.targetName) lines.push(`target_name: ${line(page.targetName)}`);
  if (page.track) lines.push(`track: ${line(page.track)}`);
  if (page.pageType === "query" && page.question) lines.push(`question: ${line(page.question)}`);
  lines.push("coverage:");
  lines.push(`  analysts: ${coverage.analysts}`);
  lines.push(`  firms: ${coverage.firms}`);
  lines.push(`  reports: ${coverage.reports}`);
  lines.push(`  first_report: ${coverage.first_report ?? "null"}`);
  lines.push(`  last_report: ${coverage.last_report ?? "null"}`);
  lines.push(`last_updated: ${today()}`);
  lines.push("---");
  return lines.join("\n");
}

/**
 * The page. A viewpoint page keeps the seven sections in one order; a precompiled answer, a judgment
 * framework and a monitoring scale keep their own sections. Everything a page shows, it shows with the
 * attribution it was given.
 */
export function renderPage(page: PageDraft, sources: SourceRecord[], documentId: string): { bodyMd: string; coverage: Coverage } {
  const coverage = coverageOf(page);
  const byRef = new Map(sources.map(source => [source.ref, source]));
  const head = frontmatter(page, coverage);
  // A page may hold several materials; each source points at the material it may be read in.
  const link = (ref: string) => `[${ref}](/knowledge/documents/${byRef.get(ref)?.documentId ?? documentId}#${ref})`;
  const related = (slugs: string[]) => slugs.filter(Boolean).map(slug => `- [${slug}](/knowledge/targets/${slug})`).join("\n") || "- 暂无";
  const statement = (value: string | null | undefined) => {
    const parts = paragraphs(value);
    return parts.length ? parts.flatMap(part => [part, ""]) : [UNKNOWN, ""];
  };

  if (page.pageType === "query") {
    const body = [
      head,
      "",
      "## 简答",
      "",
      ...statement(page.answer),
      "## 推理路径",
      "",
      ...statement(page.consensus),
      ...(page.timeline.length ? ["## 依据", "", ...orderedTimeline(page).map(entry => `- [${isKnownDate(entry.date) ? entry.date : "日期未知"}] ${line(entry.headline)}${entry.sourceRefs.length ? `（${entry.sourceRefs.map(link).join("、")}）` : ""}`), ""] : []),
      "## Related Pages",
      "",
      related(page.related),
    ];
    return { bodyMd: body.join("\n"), coverage };
  }

  if (page.pageType === "concept") {
    const body = [
      head,
      "",
      "## 一句话定义",
      "",
      ...statement(page.definition),
      "## 框架结构",
      "",
      ...(page.structure.length ? page.structure.map((step, index) => `${index + 1}. ${line(step)}`) : ["- 未知"]),
      "",
      "## 输入与输出",
      "",
      ...(page.inputs.length ? page.inputs.map(item => `- 输入：${line(item)}`) : []),
      ...(page.outputs.length ? page.outputs.map(item => `- 输出：${line(item)}`) : []),
      ...(page.inputs.length || page.outputs.length ? [] : ["- 未知"]),
      "",
      "## 量化锚点",
      "",
      ...(page.anchors.length ? page.anchors.map(anchor => `- ${line(anchor)}`) : ["- 来源未给量化阈值"]),
      "",
      "## 与相关框架的关系",
      "",
      related(page.related),
      "",
      "## 来源",
      "",
      ...(sources.length ? sources.map(source => `- ${source.ref}：${line(source.institution) || UNKNOWN}，${line(source.date) || "日期未知"}${source.dateBasis ? `（依据：${line(source.dateBasis)}）` : ""}${source.authors.length ? `，作者：${source.authors.map(line).join("、")}` : ""}`) : ["- 未知"]),
      "",
      "## Related Pages",
      "",
      related(page.related),
    ];
    return { bodyMd: body.join("\n"), coverage };
  }

  if (page.pageType === "monitor") {
    const body = [
      head,
      "",
      "## 监测标尺",
      "",
      "| 指标 | 对象 | 阈值规则 | 解读 | 归因 | 最近引用 |",
      "|---|---|---|---|---|---|",
      ...(page.metrics.length ? page.metrics.map(metric => `| ${cell(metric.metric)} | ${cell(metric.object)} | ${cell(metric.threshold)} | ${cell(metric.interpretation)} | ${cell(metric.attribution)} | ${cell(metric.lastCited)} |`) : ["| 未知 | 未知 | 未知 | 未知 | 未知 | 未知 |"]),
      "",
      "## 来源",
      "",
      ...(sources.length ? sources.map(source => `- ${source.ref}：${line(source.institution) || UNKNOWN}，${line(source.date) || "日期未知"}`) : ["- 未知"]),
      "",
      "## Related Pages",
      "",
      related(page.related),
    ];
    return { bodyMd: body.join("\n"), coverage };
  }

  const stanceRows = page.stances.map(stance => `| ${cell(stance.analyst)} | ${cell(stance.institution)} | ${cell(stance.stance)} | ${isKnownDate(stance.date) ? stance.date : UNKNOWN} | ${cell(stance.argument)} | ${stance.sourceRef ? link(stance.sourceRef) : UNKNOWN} |`);
  const expectationRows = page.expectations.map(item => `| ${cell(item.analyst)} | ${cell(item.institution)} | ${cell(item.metric)} | ${cell(item.value)} | ${isKnownDate(item.date) ? item.date : UNKNOWN} |`);
  const body = [
    head,
    "",
    "## 共识与分歧",
    "",
    ...statement(page.consensus),
    ...(page.divergences.length ? ["**关键争议点**：", ...page.divergences.map((item, index) => `${index + 1}. **${line(item.point)}**${item.sides.length ? `：${item.sides.map(side => `${line(side.attribution)}（${isKnownDate(side.date) ? side.date : "日期未知"}）${line(side.argument)}`).join("；")}` : ""}`), ""] : []),
    "## 边际变化",
    "",
    ...(page.marginalChanges.length ? page.marginalChanges.map(item => `- ${isKnownDate(item.date) ? item.date : "日期未知"}｜${line(item.attribution)}：${line(item.note)}`) : ["- 近 3 个月材料未见可确认的观点变化或新论据"]),
    "",
    "## 观点分布",
    "",
    "| 分析师 | 机构 | 立场 | 日期 | 核心论据 | 来源 |",
    "|---|---|---|---|---|---|",
    ...(stanceRows.length ? stanceRows : ["| 未知 | 未知 | 未知 | 未知 | 未知 | 未知 |"]),
    "",
    "## 一致预期",
    "",
    "| 分析师 | 机构 | 指标 | 数值 | 日期 |",
    "|---|---|---|---|---|",
    ...(expectationRows.length ? expectationRows : ["| 未知 | 未知 | 未知 | — | 未知 |"]),
    "",
    "## 风险与证伪信号",
    "",
    ...(page.risks.length ? page.risks.map(risk => `- ${line(risk.threshold)} —— ${line(risk.interpretation)}（${line(risk.attribution)}，${isKnownDate(risk.date) ? risk.date : "日期未知"}）`) : ["- 未知"]),
    "",
    "## 观点时间线",
    "",
    ...orderedTimeline(page).flatMap(entry => [
      `- [${isKnownDate(entry.date) ? entry.date : "日期未知"}] **${line(entry.headline)}**${entry.notes?.length ? `：${entry.notes.map(note => `${line(note.attribution)}（${isKnownDate(note.date) ? note.date : "日期未知"}）${line(note.note)}`).join("；")}` : ""}${entry.sourceRefs?.length ? ` [来源: ${entry.sourceRefs.map(ref => `${ref} ${sourceLabel(byRef.get(ref), ref)}`).join("、")}]` : ""}`,
    ]),
    ...(orderedTimeline(page).length ? [] : ["- 暂无"]),
    "",
    "## Related Pages",
    "",
    related(page.related),
  ];
  return { bodyMd: body.join("\n"), coverage };
}
