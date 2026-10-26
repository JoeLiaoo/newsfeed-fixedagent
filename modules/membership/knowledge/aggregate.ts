// One target's page is the sum of what several materials say about it. Each material keeps its own
// structured contribution under the target's stable id, and the page is their aggregate: a new
// material for the same target adds to the page instead of replacing it, and taking one material
// away leaves the other materials' viewpoints standing.
import { isKnownDate } from "./render.ts";
import type { PageDraft, SourceRecord } from "./schema.ts";
import type { FigureFinding } from "./figure-model.ts";
import type { FigureCoverage } from "./figures.ts";

/** One material's structured contribution to a target's page. */
export type Contribution = {
  /** The material version the contribution was compiled from. */
  versionId: string;
  /** The document the material belongs to. */
  documentId: string;
  /** The version number of that material version, used for order and for the stale-build rule. */
  versionNo: number;
  /** When the contribution was written, so the page keeps the order the materials arrived in. */
  createdAt: string;
  /** The build that produced the contribution. */
  taskId: string | null;
  /** The stable id of the target the contribution belongs to. */
  targetKey: string;
  /** The page as the Builder drafted it and the Auditor corrected it. */
  page: PageDraft;
  /** The sources the material gave. */
  sources: SourceRecord[];
  /** The material's own attribution, used to label its statements when a target has several materials. */
  attribution: string | null;
  /** The material's title, the name a citation falls back to when the source names no institution. */
  materialTitle: string | null;
  figureFindings?: FigureFinding[];
  figureCoverage?: FigureCoverage | null;
};

export type MergedFigure = { figureId: string; documentId: string; versionId: string; label: string; finding: FigureFinding };

/** One citation on the merged page: what it points at, and who said it. */
export type MergedCitation = {
  label: string;
  analyst: string | null;
  organization: string | null;
  publishedOn: string | null;
  versionId: string;
  documentId: string;
  anchor: string | null;
  sourceTitle: string | null;
};

export type Aggregate = {
  /** The page the contributions add up to. */
  page: PageDraft;
  /** The sources of the page, each with the material it may be read in. */
  sources: SourceRecord[];
  /** The citations of the page, each with the attribution the library recorded. */
  citations: MergedCitation[];
  figures: MergedFigure[];
  figureCoverage: FigureCoverage | null;
  /** The material the page was last written from. */
  versionId: string | null;
  taskId: string | null;
};

/**
 * The stable id of a target: what the page is about, not which material said it. Two materials about
 * the same company land on the same id even when the Builder named their pages differently.
 */
export function targetKeyOf(page: PageDraft): string {
  const subject = (page.targetName ?? page.title ?? page.slug).trim().toLowerCase();
  return `${page.pageType}|${(page.targetType ?? "").trim().toLowerCase()}|${subject}`;
}

/** The refs a page points at: the sources of its stances and of its timeline. */
function refsOf(page: PageDraft): string[] {
  const refs: string[] = [];
  for (const stance of page.stances) if (stance.sourceRef) refs.push(stance.sourceRef);
  for (const entry of page.timeline) for (const ref of entry.sourceRefs ?? []) refs.push(ref);
  return refs;
}

/**
 * The labels the merged page gives to the sources. One material keeps the refs it wrote itself;
 * several materials get page-wide numbers, so two materials that both wrote "S1" stay apart.
 */
function labelMaps(contributions: Contribution[]): Map<string, string>[] {
  const several = contributions.length > 1;
  let counter = 0;
  return contributions.map(contribution => {
    const map = new Map<string, string>();
    const refs = [...new Set([...refsOf(contribution.page), ...contribution.sources.map(source => source.ref)])];
    for (const ref of refs) {
      if (!several) { map.set(ref, ref); continue; }
      counter += 1;
      map.set(ref, `S${counter}`);
    }
    return map;
  });
}

/** The same page with its refs renamed to the merged page's labels. */
function withRenamedRefs(page: PageDraft, map: Map<string, string>): PageDraft {
  const copy = structuredClone(page);
  for (const stance of copy.stances) if (stance.sourceRef) stance.sourceRef = map.get(stance.sourceRef) ?? stance.sourceRef;
  for (const entry of copy.timeline) {
    if (entry.sourceRefs) entry.sourceRefs = entry.sourceRefs.map(ref => map.get(ref) ?? ref);
  }
  return copy;
}

/** The lists of a merged page: every material's entries, the same entry kept once. */
function mergeLists<T>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The consensus of a merged page. One material speaks for itself; several materials each speak for
 * themselves, and each statement keeps the attribution of the material it came from.
 */
function mergedStatements(parts: Array<{ text: string; attribution: string | null }>): string {
  const usable = parts.filter(part => part.text);
  if (!usable.length) return "";
  if (usable.length === 1) return usable[0]!.text;
  return usable.map(part => part.attribution ? `${part.attribution}：${part.text}` : part.text).join("\n\n");
}

/** The citations one material's contribution rests on, with the attribution the draft gave them. */
export function citationsOf(contribution: Contribution): MergedCitation[] {
  const byRef = new Map(contribution.sources.map(source => [source.ref, source]));
  const citations = new Map<string, MergedCitation>();
  const source = (ref: string) => byRef.get(ref);
  for (const stance of contribution.page.stances) {
    if (!stance.sourceRef) continue;
    const key = `${stance.sourceRef}|${stance.analyst}|${stance.institution}|${stance.date}`;
    citations.set(key, {
      label: stance.sourceRef,
      analyst: stance.analyst || null,
      organization: stance.institution || null,
      publishedOn: isKnownDate(stance.date) ? stance.date : null,
      versionId: contribution.versionId,
      documentId: contribution.documentId,
      anchor: source(stance.sourceRef)?.dateBasis ?? null,
      sourceTitle: source(stance.sourceRef)?.institution ?? contribution.materialTitle,
    });
  }
  for (const entry of contribution.page.timeline) {
    for (const ref of entry.sourceRefs ?? []) {
      if ([...citations.values()].some(citation => citation.label === ref)) continue;
      const found = source(ref);
      citations.set(`${ref}||`, {
        label: ref,
        analyst: null,
        organization: found?.institution ?? null,
        publishedOn: found && isKnownDate(found.date) ? found.date : null,
        versionId: contribution.versionId,
        documentId: contribution.documentId,
        anchor: found?.dateBasis ?? null,
        sourceTitle: found?.institution ?? contribution.materialTitle,
      });
    }
  }
  const selected = new Set((contribution.page.figureRefs ?? []).flatMap(ref => ref.findingIds));
  let figureNo = 0;
  for (const finding of contribution.figureFindings ?? []) {
    if (!selected.has(finding.id)) continue;
    figureNo++;
    citations.set(`figure:${finding.id}`, { label: `F${figureNo}`, analyst: null, organization: null,
      publishedOn: null, versionId: contribution.versionId, documentId: contribution.documentId,
      anchor: `figure-${finding.figureId}`, sourceTitle: contribution.materialTitle });
  }
  // A page that quotes no viewpoint still rests on the material it was compiled from.
  if (!citations.size) {
    for (const found of byRef.values()) {
      citations.set(`${found.ref}||`, {
        label: found.ref,
        analyst: null,
        organization: found.institution ?? null,
        publishedOn: isKnownDate(found.date) ? found.date : null,
        versionId: contribution.versionId,
        documentId: contribution.documentId,
        anchor: found.dateBasis ?? null,
        sourceTitle: found.institution ?? contribution.materialTitle,
      });
    }
  }
  return [...citations.values()];
}

/**
 * The page the contributions add up to. The materials keep their own sources, versions and
 * attributions; only the page is shared.
 */
export function aggregateContributions(contributions: Contribution[]): Aggregate {
  const ordered = [...contributions].sort((left, right) =>
    left.versionNo - right.versionNo
    || left.createdAt.localeCompare(right.createdAt)
    || left.versionId.localeCompare(right.versionId));
  if (!ordered.length) throw new Error("knowledge_no_contributions");
  const maps = labelMaps(ordered);
  const pages = ordered.map((contribution, index) => withRenamedRefs(contribution.page, maps[index]!));
  const first = pages[0]!;
  const page: PageDraft = {
    ...first,
    consensus: mergedStatements(ordered.map((contribution, index) => ({
      text: text(pages[index]!.consensus),
      attribution: contribution.attribution,
    }))),
    answer: mergedStatements(ordered.map((contribution, index) => ({
      text: text(pages[index]!.answer),
      attribution: contribution.attribution,
    }))),
    definition: mergedStatements(ordered.map((contribution, index) => ({
      text: text(pages[index]!.definition),
      attribution: contribution.attribution,
    }))),
    divergences: mergeLists(pages.map(entry => entry.divergences)),
    marginalChanges: mergeLists(pages.map(entry => entry.marginalChanges)),
    stances: mergeLists(pages.map(entry => entry.stances)),
    expectations: mergeLists(pages.map(entry => entry.expectations)),
    risks: mergeLists(pages.map(entry => entry.risks)),
    timeline: mergeLists(pages.map(entry => entry.timeline)),
    structure: mergeLists(pages.map(entry => entry.structure)),
    inputs: mergeLists(pages.map(entry => entry.inputs)),
    outputs: mergeLists(pages.map(entry => entry.outputs)),
    anchors: mergeLists(pages.map(entry => entry.anchors)),
    metrics: mergeLists(pages.map(entry => entry.metrics)),
    related: mergeLists(pages.map(entry => entry.related)),
    figureRefs: mergeLists(pages.map(entry => entry.figureRefs ?? [])),
  };
  const sources: SourceRecord[] = [];
  const citations: MergedCitation[] = [];
  const figures: MergedFigure[] = [];
  let figureNo = 0;
  ordered.forEach((contribution, index) => {
    const map = maps[index]!;
    for (const source of contribution.sources) {
      sources.push({
        ...source,
        ref: map.get(source.ref) ?? source.ref,
        versionId: contribution.versionId,
        documentId: contribution.documentId,
      });
    }
    for (const citation of citationsOf(contribution)) {
      citations.push({ ...citation, label: citation.anchor?.startsWith("figure-") ? `F${++figureNo}` : map.get(citation.label) ?? citation.label });
    }
    const selected = new Set((contribution.page.figureRefs ?? []).flatMap(ref => ref.findingIds));
    for (const finding of contribution.figureFindings ?? []) {
      if (!selected.has(finding.id)) continue;
      const ownIndex = (contribution.figureFindings ?? []).filter(item => selected.has(item.id)).findIndex(item => item.id === finding.id);
      const preceding = ordered.slice(0, index).reduce((sum, item) => sum + (item.figureFindings ?? []).filter(one => (item.page.figureRefs ?? []).some(ref => ref.findingIds.includes(one.id))).length, 0);
      figures.push({ figureId: finding.figureId, documentId: contribution.documentId, versionId: contribution.versionId, label: `F${preceding + ownIndex + 1}`, finding });
    }
  });
  const latest = ordered.at(-1)!;
  const coverages = ordered.map(item => item.figureCoverage).filter((item): item is FigureCoverage => Boolean(item));
  const figureCoverage = coverages.length ? {
    status: coverages.some(item => item.status === "partial") ? "partial" as const : coverages.some(item => item.status === "unavailable") ? "unavailable" as const : coverages.every(item => item.status === "legacy_text_only") ? "legacy_text_only" as const : "complete" as const,
    read: coverages.some(item => item.read),
    candidates: coverages.reduce((sum, item) => sum + item.candidates, 0), processed: coverages.reduce((sum, item) => sum + item.processed, 0),
    evidenced: coverages.reduce((sum, item) => sum + item.evidenced, 0), unreadable: coverages.reduce((sum, item) => sum + item.unreadable, 0),
    unprocessed: coverages.reduce((sum, item) => sum + item.unprocessed, 0), truncated: coverages.some(item => item.truncated),
  } : null;
  return { page, sources, citations, figures, figureCoverage, versionId: latest.versionId, taskId: latest.taskId };
}
