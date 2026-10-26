// The mechanical check of a drafted library: the rules a machine can decide. What it finds is a quality
// issue on the page, shown to everyone; what it cannot decide is left to the Auditor and to the reader.
import { STANCE_WORDS } from "./catalog.ts";
import type { CompiledDraft, Finding, PageDraft } from "./schema.ts";
import { isKnownDate } from "./render.ts";
import type { FigureFinding } from "./figure-model.ts";

/** Attributions that name nobody. */
const VAGUE = ["某券商", "某分析师", "某机构", "机构人士", "市场人士", "有分析师", "部分分析师", "业内", "市场", "unknown", "n/a", "tbd"];

function vague(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return VAGUE.some(word => text === word.toLowerCase() || text.includes(word));
}

function missing(value: string): boolean {
  return !value || !value.trim();
}

function dateProblem(value: string | null | undefined): string | null {
  if (isKnownDate(value)) return null;
  const text = (value ?? "").trim();
  if (text === "未知" || text === "") return null;
  return `日期「${value}」既不是 YYYY-MM-DD，也不是「未知」`;
}

/** The checks on one page. */
export function lintPage(page: PageDraft, knownSlugs: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const target = page.slug;
  const report = (level: Finding["level"], category: string, message: string, evidence: string | null = null) =>
    findings.push({ level, category, target, message, evidence });

  const seen = new Map<string, string>();
  page.stances.forEach((stance, index) => {
    if (missing(stance.analyst)) report("P1", "attribution-missing", `观点分布第 ${index + 1} 行缺少分析师。`);
    else if (vague(stance.analyst)) report("P1", "attribution-vague", `观点分布第 ${index + 1} 行的分析师归因无法识别。`, stance.analyst);
    if (missing(stance.institution)) report("P1", "attribution-missing", `观点分布第 ${index + 1} 行缺少机构。`);
    else if (vague(stance.institution)) report("P1", "attribution-vague", `观点分布第 ${index + 1} 行的机构归因无法识别。`, stance.institution);
    if (missing(stance.stance)) report("P1", "stance-missing", `观点分布第 ${index + 1} 行没有立场（评级）。`);
    else if (!STANCE_WORDS.includes(stance.stance as (typeof STANCE_WORDS)[number])) report("P1", "stance-vocabulary", `观点分布第 ${index + 1} 行的立场词「${stance.stance}」不在封闭词表内。`, stance.stance);
    if (missing(stance.sourceRef)) report("P1", "source-missing", `观点分布第 ${index + 1} 行没有可核对的来源引用。`);
    const date = dateProblem(stance.date);
    if (date) report("P0", "time-anchor-missing", `观点分布第 ${index + 1} 行的时间锚无效：${date}。`);
    const key = `${stance.analyst}|${stance.institution}`;
    const earlier = seen.get(key);
    if (earlier && earlier !== stance.stance) report("P1", "duplicate-identity", `同一位分析师（${stance.analyst}/${stance.institution}）出现不同立场，需要确认是否同一人。`, `${earlier} 与 ${stance.stance}`);
    if (!earlier) seen.set(key, stance.stance);
    if (missing(stance.argument)) report("advisory", "claim-without-evidence", `观点分布第 ${index + 1} 行没有核心论据。`);
  });

  page.timeline.forEach((entry, index) => {
    const date = dateProblem(entry.date);
    if (date) report("P0", "time-anchor-missing", `观点时间线第 ${index + 1} 条的时间锚无效：${date}。`);
    (entry.notes ?? []).forEach((note, noteIndex) => {
      if (vague(note.attribution)) report("P1", "attribution-vague", `观点时间线第 ${index + 1} 条的第 ${noteIndex + 1} 项归因无法识别。`, note.attribution);
    });
  });

  page.divergences.forEach((item, index) => {
    if (missing(item.point)) report("P1", "claim-without-evidence", `关键争议点第 ${index + 1} 条没有内容。`);
    item.sides.forEach((side, sideIndex) => {
      if (vague(side.attribution)) report("P1", "attribution-vague", `关键争议点第 ${index + 1} 条的第 ${sideIndex + 1} 侧归因无法识别。`, side.attribution);
    });
  });

  page.risks.forEach((risk, index) => {
    if (vague(risk.attribution)) report("P1", "attribution-vague", `风险与证伪信号第 ${index + 1} 条的归因无法识别。`, risk.attribution);
    if (missing(risk.threshold)) report("P1", "claim-without-evidence", `风险与证伪信号第 ${index + 1} 条没有可观测的阈值。`);
  });

  page.marginalChanges.forEach((item, index) => {
    const date = dateProblem(item.date);
    if (date) report("P1", "time-anchor-missing", `边际变化第 ${index + 1} 条的时间锚无效：${date}。`);
  });

  if (page.pageType === "view" && page.stances.length >= 3 && !/\d/.test(page.consensus)) {
    report("advisory", "coverage-mismatch", "共识段没有写明覆盖范围（机构数、分析师数或材料数）。");
  }
  if (page.pageType === "query" && /\d{1,2}\s*月(补充|更新)/.test(page.answer ?? "")) {
    report("P1", "query-changelog", "预编译问答退化成了按月追加的流水账，应改写为当前结论。");
  }
  for (const slug of page.related) {
    if (slug && slug !== page.slug && !knownSlugs.has(slug)) report("P1", "related-target-missing", `Related Pages 指向不存在的页面：${slug}。`);
  }
  return findings;
}

/** The checks on a whole build. */
export function lintDraft(draft: CompiledDraft, knownSlugs: Set<string>, verifiedFigures: FigureFinding[] = []): Finding[] {
  const findings: Finding[] = [];
  const slugs = new Set<string>();
  const reachable = new Set([...knownSlugs, ...draft.pages.map(page => page.slug)]);
  for (const page of draft.pages) {
    if (slugs.has(page.slug)) findings.push({ level: "P0", category: "duplicate-page", target: page.slug, message: "同一批里出现了两个同名页面。", evidence: null });
    slugs.add(page.slug);
    findings.push(...lintPage(page, reachable));
    const byId = new Map(verifiedFigures.map(item => [item.id, item]));
    for (const ref of page.figureRefs ?? []) {
      if (!ref.findingIds.length || ref.findingIds.some(id => byId.get(id)?.figureId !== ref.figureId)) {
        findings.push({ level: "P0", category: "figure-reference-invalid", target: page.slug,
          message: "图表引用不属于本次已核实的图片证据。", evidence: null });
      }
    }
  }
  return findings;
}

/** The findings that keep a page from being published. */
export function blockingFindings(findings: Finding[]): Finding[] {
  return findings.filter(finding => finding.level === "P0");
}
