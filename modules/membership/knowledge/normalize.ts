// The model answers in its own shape: it names a page kind the platform does not have, spells a date the
// way a human does, calls a source by another name, or leaves an array out. This module is the seam
// between the model's answer and the platform's schema. Everything here reads what the model wrote into
// the vocabulary the platform holds; nothing here invents a fact. A value that cannot be read becomes
// 「未知」 or an empty list, which the lint then shows as a quality issue on the page, instead of a whole
// build that never reaches a page.
import { escapeControlCharsInStrings } from "@aihot/backend/providers/llm";
import { MAX_PAGES_PER_BUILD, PAGE_TYPES, TARGET_TYPES } from "./catalog.ts";

/** A value the model wrote, read as a plain string. Anything else is the fallback. */
export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** The page kinds a model may use in place of the platform's own. */
const PAGE_TYPE_ALIASES: Record<string, string> = {
  theme: "concept", article: "view", stock: "view", company: "view", industry: "view",
  event: "concept", person: "concept", topic: "concept", framework: "concept",
};

/** The subject kinds a model may use in place of the platform's own. */
const TARGET_TYPE_ALIASES: Record<string, string> = {
  theme: "主题", topic: "主题", event: "主题", person: "主题", stock: "公司", company: "公司",
  industry: "行业", macro: "宏观策略", "宏观": "宏观策略",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{1,2}:\d{2}.*)?$/;
const SLASHED_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const SLASHED_MONTH = /^(\d{4})[-/.](\d{1,2})$/;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const CHINESE_DATE = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/;
const CHINESE_MONTH = /^(\d{4})\s*年\s*(\d{1,2})\s*月/;
const CHINESE_YEAR = /^(\d{4})\s*年/;

/** The words a model writes when it does not know a date. */
const UNKNOWN_DATE_WORDS = ["未知", "日期未知", "不详", "unknown", "n/a", "none", "null"];

/** A calendar day as the platform writes it, or 「未知」 when the numbers are not a day. */
function calendarDate(year: string, month: string, day: string): string {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "未知";
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return "未知";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date the model wrote, read as YYYY-MM-DD or as 「未知」. A day written the way a human writes it
 * 「2026年6月20日」「2026/06/20」「20260620」 is read as the day it names; a year or a year and a month
 * become the first day of that period. A date the lint cannot read is a P0 that keeps a page from being
 * published, so a date that cannot be read is 「未知」 rather than a string the lint will refuse.
 */
export function coerceDate(value: unknown): string {
  const text = asString(value).trim();
  if (!text) return "";
  if (UNKNOWN_DATE_WORDS.includes(text.toLowerCase())) return "未知";
  if (ISO_DATE.test(text)) return text;
  const iso = ISO_PREFIX.exec(text);
  if (iso) return iso[1]!;
  const chineseDate = CHINESE_DATE.exec(text);
  if (chineseDate) return calendarDate(chineseDate[1]!, chineseDate[2]!, chineseDate[3]!);
  const chineseMonth = CHINESE_MONTH.exec(text);
  if (chineseMonth) return calendarDate(chineseMonth[1]!, chineseMonth[2]!, "1");
  const chineseYear = CHINESE_YEAR.exec(text);
  if (chineseYear) return calendarDate(chineseYear[1]!, "1", "1");
  const slashedDate = SLASHED_DATE.exec(text);
  if (slashedDate) return calendarDate(slashedDate[1]!, slashedDate[2]!, slashedDate[3]!);
  const slashedMonth = SLASHED_MONTH.exec(text);
  if (slashedMonth) return calendarDate(slashedMonth[1]!, slashedMonth[2]!, "1");
  const compact = COMPACT_DATE.exec(text);
  if (compact) return calendarDate(compact[1]!, compact[2]!, compact[3]!);
  if (/^\d{4}$/.test(text)) return `${text}-01-01`;
  return "未知";
}

/** A list the model wrote, read as a list of short strings. */
export function asStringArray(value: unknown, max = 12, itemMax = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === "string") return item.slice(0, itemMax);
      if (item && typeof item === "object" && "note" in (item as Record<string, unknown>)) return asString((item as { note?: unknown }).note).slice(0, itemMax);
      return JSON.stringify(item).slice(0, itemMax);
    })
    .filter(Boolean)
    .slice(0, max);
}

/**
 * The model's answer, read as a JSON object. The answer may arrive as the raw text of a reply — a
 * fenced block, or prose around the object — so the object is taken out of it before it is read. An
 * answer that holds no object at all is an error: an empty draft would look like a build that
 * legitimately found nothing.
 */
export function parseJsonObject(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    let text = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fence) text = fence[1]!;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in model output");
    const body = text.slice(start, end + 1);
    try {
      value = JSON.parse(body);
    } catch {
      // Models sometimes write a raw newline inside a JSON string; only those are escaped.
      value = JSON.parse(escapeControlCharsInStrings(body));
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** The page kind, folded into one the platform holds. */
function normalizePageType(value: unknown): string {
  const text = asString(value).trim().toLowerCase();
  const mapped = PAGE_TYPE_ALIASES[text] ?? text;
  return (PAGE_TYPES as readonly string[]).includes(mapped) ? mapped : "concept";
}

/** The subject kind, folded into one the platform holds. */
function normalizeTargetType(value: unknown): string | null {
  if (value == null) return null;
  const text = asString(value).trim();
  if (!text) return null;
  const mapped = TARGET_TYPE_ALIASES[text] ?? text;
  return (TARGET_TYPES as readonly string[]).includes(mapped) ? mapped : "主题";
}

/** One note of a timeline entry. */
function normalizeTimelineNote(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const note = value as Record<string, unknown>;
  return {
    attribution: asString(note.attribution, "未知").slice(0, 120),
    note: asString(note.note ?? note.text).slice(0, 240),
    date: coerceDate(note.date),
  };
}

/** One page of the draft, read into the platform's own page shape. */
function normalizePage(item: unknown): Record<string, unknown> {
  const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
  // A model may nest the page's own fields under `fields`; the platform's shape is flat.
  const nested = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? raw.fields as Record<string, unknown> : {};
  const page = { ...nested, ...raw };
  const pageType = normalizePageType(page.pageType);

  const timeline = (Array.isArray(page.timeline) ? page.timeline : []).map(row => {
    if (!row || typeof row !== "object") return null;
    const entry = row as Record<string, unknown>;
    const headline = asString(entry.headline) || asString(entry.event) || asString(entry.note) || asString(entry.title);
    const notes = Array.isArray(entry.notes)
      ? entry.notes.map(normalizeTimelineNote).filter(Boolean).slice(0, 8)
      : (asString(entry.note) ? [{ attribution: "未知", note: asString(entry.note).slice(0, 240), date: coerceDate(entry.date) }] : []);
    const sourceRefs = Array.isArray(entry.sourceRefs)
      ? entry.sourceRefs.map(ref => String(ref).slice(0, 40))
      : (entry.sourceRef ? [String(entry.sourceRef).slice(0, 40)] : []);
    return {
      date: coerceDate(entry.date),
      headline: headline.slice(0, 240),
      notes,
      sourceRefs: sourceRefs.slice(0, 8),
    };
  }).filter(Boolean).slice(0, 60);

  const marginalChanges = (Array.isArray(page.marginalChanges) ? page.marginalChanges : []).map(row => {
    if (typeof row === "string") {
      const match = /^(\d{4}-\d{2}-\d{2})[：:]\s*(.*)$/.exec(row);
      return { date: match ? match[1]! : "", attribution: "未知", note: (match ? match[2]! : row).slice(0, 240) };
    }
    if (!row || typeof row !== "object") return null;
    const change = row as Record<string, unknown>;
    return {
      date: coerceDate(change.date),
      attribution: asString(change.attribution, "未知").slice(0, 120),
      note: asString(change.note || change.headline || change.event).slice(0, 240),
    };
  }).filter(Boolean).slice(0, 16);

  const stances = (Array.isArray(page.stances) ? page.stances : []).map(row => {
    if (!row || typeof row !== "object") return null;
    const stance = row as Record<string, unknown>;
    return {
      analyst: asString(stance.analyst ?? stance.author, "未知").slice(0, 80),
      institution: asString(stance.institution ?? stance.org, "未知").slice(0, 80),
      stance: asString(stance.stance, "中性").trim().slice(0, 20),
      date: coerceDate(stance.date),
      argument: asString(stance.argument ?? stance.note ?? stance.reason).slice(0, 160),
      sourceRef: asString(stance.sourceRef ?? stance.ref, "S1").slice(0, 40),
    };
  }).filter(Boolean).slice(0, 60);

  const expectations = (Array.isArray(page.expectations) ? page.expectations : []).map(row => {
    if (typeof row === "string") return { analyst: "未知", institution: "未知", metric: "预期", value: row.slice(0, 80), date: "" };
    if (!row || typeof row !== "object") return null;
    const expectation = row as Record<string, unknown>;
    return {
      analyst: asString(expectation.analyst ?? expectation.author, "未知").slice(0, 80),
      institution: asString(expectation.institution ?? expectation.org, "未知").slice(0, 80),
      metric: asString(expectation.metric, "预期").slice(0, 80),
      value: asString(expectation.value || expectation.note || expectation.text).slice(0, 80),
      date: coerceDate(expectation.date),
    };
  }).filter(Boolean).slice(0, 30);

  const risks = (Array.isArray(page.risks) ? page.risks : []).map(row => {
    if (typeof row === "string") return { threshold: row.slice(0, 240), interpretation: "", attribution: "未知", date: "" };
    if (!row || typeof row !== "object") return null;
    const risk = row as Record<string, unknown>;
    return {
      threshold: asString(risk.threshold || risk.risk || risk.note || risk.text).slice(0, 240),
      interpretation: asString(risk.interpretation).slice(0, 240),
      attribution: asString(risk.attribution, "未知").slice(0, 120),
      date: coerceDate(risk.date),
    };
  }).filter(Boolean).slice(0, 16);

  const divergences = (Array.isArray(page.divergences) ? page.divergences : []).map(row => {
    if (!row || typeof row !== "object") return null;
    const divergence = row as Record<string, unknown>;
    const sides = (Array.isArray(divergence.sides) ? divergence.sides : []).filter(side => side && typeof side === "object").map(side => {
      const one = side as Record<string, unknown>;
      return {
        attribution: asString(one.attribution, "未知").slice(0, 120),
        argument: asString(one.argument ?? one.note).slice(0, 240),
        date: coerceDate(one.date),
      };
    }).slice(0, 8);
    return { point: asString(divergence.point ?? divergence.topic).slice(0, 240), sides };
  }).filter(Boolean).slice(0, 8);

  const metrics = (Array.isArray(page.metrics) ? page.metrics : []).map(row => {
    if (!row || typeof row !== "object") return null;
    const metric = row as Record<string, unknown>;
    return {
      metric: asString(metric.metric).slice(0, 120),
      object: asString(metric.object ?? metric.target).slice(0, 120),
      threshold: asString(metric.threshold).slice(0, 240),
      interpretation: asString(metric.interpretation ?? metric.note).slice(0, 240),
      attribution: asString(metric.attribution, "未知").slice(0, 120),
      lastCited: coerceDate(metric.lastCited ?? metric.date),
    };
  }).filter(Boolean).slice(0, 30);

  return {
    pageType,
    slug: asString(page.slug, "untitled").slice(0, 80),
    title: asString(page.title, "未命名").slice(0, 120),
    targetType: normalizeTargetType(page.targetType),
    targetName: page.targetName == null ? null : asString(page.targetName).slice(0, 80),
    track: page.track == null ? null : asString(page.track).slice(0, 60),
    consensus: asString(page.consensus || page.summary).slice(0, 800),
    divergences,
    marginalChanges,
    stances,
    expectations,
    risks,
    timeline,
    question: page.question == null ? null : asString(page.question).slice(0, 300),
    answer: page.answer == null ? null : asString(page.answer).slice(0, 2000),
    definition: page.definition == null
      ? (pageType === "concept" ? asString(page.summary || page.consensus).slice(0, 1000) || null : null)
      : asString(page.definition).slice(0, 1000),
    structure: asStringArray(page.structure || page.keyPoints, 12, 240),
    inputs: asStringArray(page.inputs, 12, 160),
    outputs: asStringArray(page.outputs, 12, 160),
    anchors: asStringArray(page.anchors, 12, 240),
    metrics,
    related: asStringArray(page.related, 16, 80),
  };
}

/** One source of the material, read into the platform's own source shape. */
function normalizeSource(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const authors = Array.isArray(source.authors)
    ? source.authors.map(author => asString(author).slice(0, 80)).filter(Boolean).slice(0, 20)
    : (asString(source.author) ? asString(source.author).split(/[、,，/]/).map(author => author.trim().slice(0, 80)).filter(Boolean).slice(0, 20) : []);
  const institution = source.institution ?? source.organization;
  return {
    ref: asString(source.ref, "S1").slice(0, 40),
    institution: institution == null || institution === "" ? null : asString(institution).slice(0, 120),
    authors,
    date: source.date == null || source.date === "" ? null : coerceDate(source.date),
    dateBasis: source.dateBasis == null || source.dateBasis === "" ? null : asString(source.dateBasis).slice(0, 120),
    kind: source.kind == null || source.kind === "" ? null : asString(source.kind).slice(0, 60),
  };
}

/**
 * The draft the Builder wrote, read into the platform's own draft shape. The result is what the schema
 * is asked to accept, so a model that came close still builds; what it could not answer for is left
 * empty, and the lint shows it as a quality issue.
 */
export function normalizeCompiledDraft(raw: unknown): unknown {
  const root = parseJsonObject(raw);
  const pagesIn = Array.isArray(root.pages) ? root.pages : [];
  const sourcesIn = Array.isArray(root.sources) ? root.sources : [];
  return {
    pages: pagesIn.slice(0, MAX_PAGES_PER_BUILD).map(normalizePage),
    sources: sourcesIn.map(normalizeSource).filter(Boolean).slice(0, 30),
    notes: asString(root.notes).slice(0, 4000),
  };
}

/** What the Auditor may change: a section, an index, an action. */
const AUDIT_SECTIONS = new Set(["stances", "timeline", "divergences", "risks", "consensus", "marginalChanges", "expectations"]);
const AUDIT_FIELDS = new Set(["analyst", "institution", "date"]);

/** One quality issue the Auditor found. */
function normalizeFinding(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const finding = row as Record<string, unknown>;
  const level = asString(finding.level, "advisory");
  return {
    level: ["P0", "P1", "advisory"].includes(level) ? level : "advisory",
    category: asString(finding.category || finding.type, "issue").slice(0, 40),
    target: finding.target == null ? null : asString(finding.target).slice(0, 120),
    message: asString(finding.message || finding.detail || finding.note).slice(0, 400),
    evidence: finding.evidence == null ? null : asString(finding.evidence).slice(0, 400),
  };
}

/**
 * The verdict the Auditor gave, read into the platform's own verdict shape. A correction that names a
 * section or an action the platform does not hold is dropped: it cannot be applied to a page, and a
 * correction that cannot be applied is worse than one that is not made.
 */
export function normalizeAuditResult(raw: unknown): unknown {
  const root = parseJsonObject(raw);
  const verdictRaw = asString(root.verdict, "pass_with_issues");
  const verdict = ["pass", "pass_with_issues", "fail"].includes(verdictRaw) ? verdictRaw : "pass_with_issues";

  const corrections = (Array.isArray(root.corrections) ? root.corrections : []).map(row => {
    if (!row || typeof row !== "object") return null;
    const correction = row as Record<string, unknown>;
    const section = asString(correction.section);
    if (!AUDIT_SECTIONS.has(section)) return null;
    const action = asString(correction.action);
    if (action !== "remove" && action !== "unknown_attribution") return null;
    const fieldRaw = correction.field == null || correction.field === "" ? null : asString(correction.field);
    const field = fieldRaw && AUDIT_FIELDS.has(fieldRaw) ? fieldRaw : null;
    const index = typeof correction.index === "number" ? correction.index : Number(correction.index);
    if (!Number.isFinite(index) || index < 0) return null;
    return {
      pageSlug: asString(correction.pageSlug || correction.slug, "unknown").slice(0, 80),
      section,
      index: Math.min(200, Math.floor(index)),
      action,
      field,
      reason: asString(correction.reason || correction.detail || correction.message, "模型未写明原因").slice(0, 300),
    };
  }).filter(Boolean).slice(0, 80);

  let findings: unknown[] = [];
  if (Array.isArray(root.findings)) {
    findings = root.findings.map(normalizeFinding).filter(Boolean);
  } else if (Array.isArray(root.issues)) {
    findings = root.issues.map(row => {
      if (!row || typeof row !== "object") return null;
      const issue = row as Record<string, unknown>;
      return {
        level: "P1",
        category: asString(issue.type || issue.category, "issue").slice(0, 40),
        target: null,
        message: asString(issue.detail || issue.message || issue.note).slice(0, 400),
        evidence: null,
      };
    }).filter(Boolean);
  } else if (Array.isArray(root.qualityIssues)) {
    findings = root.qualityIssues.map(row => ({ level: "advisory", category: "quality", target: null, message: asString(row).slice(0, 400), evidence: null }));
  }

  return { verdict, corrections, findings: findings.slice(0, 60), notes: asString(root.notes || root.reason).slice(0, 4000) };
}
