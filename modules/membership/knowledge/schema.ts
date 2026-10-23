// What the two build steps and the answer may say. The model fills these shapes; the platform renders
// the pages and checks the pages, so the shape of a page is never the model's choice.
import { z } from "zod";
import { MAX_PAGES_PER_BUILD, MAX_PUBLISHED_PAGE_SLUG_LENGTH, PAGE_TYPES, TARGET_TYPES } from "./catalog.ts";

/** The attribution of one viewpoint: who said it, for whom, when, and on what ground. */
export const stanceSchema = z.object({
  analyst: z.string().max(80),
  institution: z.string().max(80),
  // The closed stance vocabulary is checked by the lint, not by the parser: a word outside it is a
  // quality issue to show, not a reason to lose a whole build.
  stance: z.string().max(20),
  date: z.string().max(10),
  argument: z.string().max(160),
  sourceRef: z.string().max(40),
});

export const divergenceSchema = z.object({
  point: z.string().max(240),
  sides: z.array(z.object({
    attribution: z.string().max(120),
    argument: z.string().max(240),
    date: z.string().max(10),
  })).max(8),
});

export const marginalSchema = z.object({
  date: z.string().max(10),
  attribution: z.string().max(120),
  note: z.string().max(240),
});

export const expectationSchema = z.object({
  analyst: z.string().max(80),
  institution: z.string().max(80),
  metric: z.string().max(80),
  value: z.string().max(80),
  date: z.string().max(10),
});

export const riskSchema = z.object({
  threshold: z.string().max(240),
  interpretation: z.string().max(240),
  attribution: z.string().max(120),
  date: z.string().max(10),
});

export const timelineSchema = z.object({
  date: z.string().max(10),
  headline: z.string().max(240),
  notes: z.array(z.object({
    attribution: z.string().max(120),
    note: z.string().max(240),
    date: z.string().max(10),
  })).max(8),
  sourceRefs: z.array(z.string().max(40)).max(8),
});

export const monitorSchema = z.object({
  metric: z.string().max(120),
  object: z.string().max(120),
  threshold: z.string().max(240),
  interpretation: z.string().max(240),
  attribution: z.string().max(120),
  lastCited: z.string().max(10),
});

/** One page of the library, as the Builder drafted it. */
export const pageDraftSchema = z.object({
  pageType: z.enum(PAGE_TYPES),
  slug: z.string().max(80),
  title: z.string().max(120),
  targetType: z.enum(TARGET_TYPES).nullable(),
  targetName: z.string().max(80).nullable(),
  track: z.string().max(60).nullable(),
  consensus: z.string().max(800),
  divergences: z.array(divergenceSchema).max(8),
  marginalChanges: z.array(marginalSchema).max(16),
  stances: z.array(stanceSchema).max(60),
  expectations: z.array(expectationSchema).max(30),
  risks: z.array(riskSchema).max(16),
  timeline: z.array(timelineSchema).max(60),
  question: z.string().max(300).nullable(),
  answer: z.string().max(2000).nullable(),
  definition: z.string().max(1000).nullable(),
  structure: z.array(z.string().max(240)).max(12),
  inputs: z.array(z.string().max(160)).max(12),
  outputs: z.array(z.string().max(160)).max(12),
  anchors: z.array(z.string().max(240)).max(12),
  metrics: z.array(monitorSchema).max(30),
  related: z.array(z.string().max(80)).max(16),
});

/** One source inside the material, with the attribution the material itself gives. */
export const sourceSchema = z.object({
  ref: z.string().max(40),
  institution: z.string().max(120).nullable(),
  authors: z.array(z.string().max(80)).max(20),
  date: z.string().max(10).nullable(),
  dateBasis: z.string().max(120).nullable(),
  kind: z.string().max(60).nullable(),
});

/**
 * One source as the library keeps it. The material gives the attribution; the library adds where the
 * source may be read, so a page that holds several materials links each of them to its own material.
 */
export type SourceRecord = z.infer<typeof sourceSchema> & {
  /** The material version the source was read from. */
  versionId?: string;
  /** The document the source may be read in. */
  documentId?: string;
};

export const compiledDraftSchema = z.object({
  pages: z.array(pageDraftSchema).max(MAX_PAGES_PER_BUILD),
  sources: z.array(sourceSchema).max(30),
  notes: z.string().max(4000),
});

/** What the Auditor may change: withdraw an entry, or lower its attribution to unknown. It may not add one. */
export const correctionSchema = z.object({
  pageSlug: z.string().max(80),
  section: z.enum(["stances", "timeline", "divergences", "risks", "consensus", "marginalChanges", "expectations"]),
  index: z.number().int().min(0).max(200),
  action: z.enum(["remove", "unknown_attribution"]),
  field: z.enum(["analyst", "institution", "date"]).nullable(),
  reason: z.string().max(300),
});

export const findingSchema = z.object({
  level: z.enum(["P0", "P1", "advisory"]),
  category: z.string().max(40),
  target: z.string().max(120).nullable(),
  message: z.string().max(400),
  evidence: z.string().max(400).nullable(),
});

export const auditResultSchema = z.object({
  verdict: z.enum(["pass", "pass_with_issues", "fail"]),
  corrections: z.array(correctionSchema).max(80),
  findings: z.array(findingSchema).max(60),
  notes: z.string().max(4000),
});

/**
 * One footnote of an answer: the page it rests on and the citation of that page it points at. The
 * model may only name a citation it was given; who said it and when is the library's own record,
 * so the attribution never comes from the model's memory.
 */
export const answerCitationSchema = z.object({
  label: z.string().max(20),
  pageSlug: z.string().max(MAX_PUBLISHED_PAGE_SLUG_LENGTH),
  citationId: z.string().max(64),
});

export const answerSchema = z.object({
  answer: z.string().max(20_000),
  citations: z.array(answerCitationSchema).max(40),
});

export type Stance = z.infer<typeof stanceSchema>;
export type AnswerCitationClaim = z.infer<typeof answerCitationSchema>;
export type PageDraft = z.infer<typeof pageDraftSchema>;
export type CompiledDraft = z.infer<typeof compiledDraftSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type AuditResult = z.infer<typeof auditResultSchema>;
export type AnswerResult = z.infer<typeof answerSchema>;
export type AnswerCitation = z.infer<typeof answerCitationSchema>;
