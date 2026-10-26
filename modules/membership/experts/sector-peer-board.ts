// The board the employee reads. The model's answer is read leniently: a claim that carries one source
// more than asked for, a missing panel or an over-long sentence must not throw the whole board away.
// What the model may not do is widen the evidence: a claim stays only when its sources are the ones
// this task retrieved, and a panel that cannot be read stays empty and says so in the gaps.
import type { PublicSearchSource } from "@aihot/backend/providers/deepseek-search";

export type SectorPeerClaim = { text: string; sourceIds: string[] };
export type SectorPeerBoard = {
  peers: SectorPeerClaim[];
  stageSignals: SectorPeerClaim[];
  capitalEvents: SectorPeerClaim[];
  usReferences: SectorPeerClaim[];
  gaps: string[];
};

/** The four fact panels and the label each one carries in the board. */
export const SECTOR_PEER_PANELS = [
  { key: "peers", label: "同业是谁" },
  { key: "stageSignals", label: "发展到哪" },
  { key: "capitalEvents", label: "资本市场认可" },
  { key: "usReferences", label: "美国参考" },
] as const;

export type SectorPeerPanel = (typeof SECTOR_PEER_PANELS)[number]["key"];

/** How many claims one panel shows. */
const PANEL_LIMIT: Record<SectorPeerPanel, number> = { peers: 12, stageSignals: 16, capitalEvents: 20, usReferences: 12 };
/**
 * How many sources one claim may cite. The schema once allowed four, and a claim that cited five threw
 * the whole board away; the board shows the sources it has and says nothing that no source supports.
 */
export const SECTOR_PEER_MAX_SOURCE_IDS = 8;
/** The longest sentence one claim carries. */
const MAX_TEXT = 1200;
/** How many gaps the board carries, and how long one may be. */
const MAX_GAPS = 12;
const MAX_GAP_TEXT = 500;

/** A source id the model wrote as "S3", " s3 ", "S03", "S3、S4" or 3. */
function normalizeId(value: string): string | null {
  const match = /^s0*(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.replace(/^0+(?=\d)/, "");
  return digits ? `S${digits}` : null;
}

/** The source ids one value of the model's `sourceIds` field carries. */
function readSourceIds(value: unknown): string[] {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? [`S${value}`] : [];
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[、,，;；\s]+/).filter(Boolean);
  const listed = parts.map(normalizeId).filter((id): id is string => !!id);
  if (listed.length) return listed;
  // A free-text id ("来源 S3") still names a source; anything else is not a source id.
  return [...trimmed.matchAll(/s\d+/gi)].map(match => normalizeId(match[0])!).filter(Boolean);
}

type ClaimRead = { claim: SectorPeerClaim | null; idsCapped: boolean; textTrimmed: boolean };

function readClaim(value: unknown): ClaimRead {
  const none: ClaimRead = { claim: null, idsCapped: false, textTrimmed: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) return none;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return none;
  const rawIds = Array.isArray(record.sourceIds)
    ? record.sourceIds
    : record.sourceIds === undefined || record.sourceIds === null ? [] : [record.sourceIds];
  const sourceIds: string[] = [];
  let idsCapped = false;
  for (const raw of rawIds) {
    for (const id of readSourceIds(raw)) {
      if (sourceIds.includes(id)) continue;
      if (sourceIds.length >= SECTOR_PEER_MAX_SOURCE_IDS) { idsCapped = true; continue; }
      sourceIds.push(id);
    }
  }
  if (!sourceIds.length) return { claim: null, idsCapped, textTrimmed: false };
  const trimmed = text.length > MAX_TEXT;
  return { claim: { text: trimmed ? text.slice(0, MAX_TEXT) : text, sourceIds }, idsCapped, textTrimmed: trimmed };
}

function readGapText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "gap", "note", "message"]) {
      const found = record[key];
      if (typeof found === "string" && found.trim()) return found.trim();
    }
  }
  return "";
}

/**
 * The model's answer, read leniently. Every panel is read on its own: a panel that is missing or
 * unreadable stays empty and says so, and a claim that does not fit is dropped or trimmed instead of
 * throwing the whole answer away.
 */
export function normalizeSectorPeerAnswer(raw: unknown): { board: SectorPeerBoard; notes: string[] } {
  const notes: string[] = [];
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const board: SectorPeerBoard = { peers: [], stageSignals: [], capitalEvents: [], usReferences: [], gaps: [] };
  let unreadable = 0, dropped = 0, idsCapped = 0, textTrimmed = 0;
  for (const panel of SECTOR_PEER_PANELS) {
    const value = record ? record[panel.key] : undefined;
    if (value === undefined) {
      notes.push(`文字整理模型未返回「${panel.label}」栏目，该栏目按无结论处理。`);
      continue;
    }
    if (!Array.isArray(value)) {
      notes.push(`文字整理模型的「${panel.label}」栏目格式无法识别，该栏目按无结论处理。`);
      unreadable++;
      continue;
    }
    const claims: SectorPeerClaim[] = [];
    for (const item of value) {
      const read = readClaim(item);
      if (read.idsCapped) idsCapped++;
      if (read.textTrimmed) textTrimmed++;
      if (!read.claim) { dropped++; continue; }
      claims.push(read.claim);
    }
    const limit = PANEL_LIMIT[panel.key];
    if (claims.length > limit) {
      notes.push(`文字整理模型的「${panel.label}」栏目有 ${claims.length} 条结论，超过 ${limit} 条上限，已保留前 ${limit} 条。`);
      claims.length = limit;
    }
    board[panel.key] = claims;
  }
  const gapValue = record?.gaps;
  let gaps: string[] = [];
  if (gapValue !== undefined) {
    if (!Array.isArray(gapValue)) {
      notes.push("文字整理模型返回的缺口说明格式无法识别，已按无补充说明处理。");
      unreadable++;
    } else {
      for (const item of gapValue) {
        const text = readGapText(item);
        if (text) gaps.push(text.slice(0, MAX_GAP_TEXT));
      }
      if (gaps.length > MAX_GAPS) {
        notes.push(`文字整理模型返回了 ${gaps.length} 条缺口说明，超过 ${MAX_GAPS} 条上限，已保留前 ${MAX_GAPS} 条。`);
        gaps = gaps.slice(0, MAX_GAPS);
      }
    }
  }
  board.gaps = gaps;
  if (dropped) notes.push(`文字整理模型有 ${dropped} 条结论不符合格式要求，已略过。`);
  if (idsCapped) notes.push(`文字整理模型有 ${idsCapped} 条结论引用的来源超过 ${SECTOR_PEER_MAX_SOURCE_IDS} 个，已按前 ${SECTOR_PEER_MAX_SOURCE_IDS} 个展示。`);
  if (textTrimmed) notes.push(`文字整理模型有 ${textTrimmed} 条结论超过 ${MAX_TEXT} 字，已截断。`);
  if (unreadable) notes.push(`文字整理模型有 ${unreadable} 个栏目或说明无法按格式读取，相关部分按无结论处理。`);
  return { board, notes };
}

/**
 * The board from the model's answer: the claims that stand on this task's own sources, and the gaps
 * that say what is missing. A claim whose sources were not retrieved is dropped, and a claim that puts
 * a Chinese source in the US panel (or the other way round) is dropped too: the panel reads empty
 * rather than carrying a conclusion these sources do not support.
 */
export function buildSectorPeerBoard(input: { answer: unknown; sources: PublicSearchSource[]; searchGaps: string[] }): SectorPeerBoard {
  const { board, notes } = normalizeSectorPeerAnswer(input.answer);
  const groups = new Map(input.sources.map(source => [source.id, source.queryGroup]));
  let unsupported = 0, misplacedInUs = 0, misplacedElsewhere = 0;
  const keep = (claims: SectorPeerClaim[], panel: SectorPeerPanel) => claims.flatMap(claim => {
    const ids = claim.sourceIds.filter(id => groups.has(id));
    if (!ids.length) { unsupported++; return []; }
    const fits = panel === "usReferences"
      ? ids.every(id => groups.get(id) === "us")
      : ids.every(id => groups.get(id) !== "us");
    if (!fits) {
      if (panel === "usReferences") misplacedInUs++;
      else misplacedElsewhere++;
      return [];
    }
    return [{ text: claim.text, sourceIds: ids }];
  });
  const peers = keep(board.peers, "peers");
  const stageSignals = keep(board.stageSignals, "stageSignals");
  const capitalEvents = keep(board.capitalEvents, "capitalEvents");
  const usReferences = keep(board.usReferences, "usReferences");
  const boardNotes = [...notes];
  if (unsupported) boardNotes.push(`文字整理模型有 ${unsupported} 条结论引用的来源不在本次检索结果中，已略过。`);
  if (misplacedInUs) boardNotes.push(`文字整理模型有 ${misplacedInUs} 条「美国参考」结论引用了中国来源，已略过。`);
  if (misplacedElsewhere) boardNotes.push(`文字整理模型有 ${misplacedElsewhere} 条结论引用了美国来源，已略过；美国主体只放在「美国参考」。`);
  return {
    peers, stageSignals, capitalEvents, usReferences,
    gaps: [...input.searchGaps, ...boardNotes, ...board.gaps].slice(0, MAX_GAPS),
  };
}

/**
 * The board when the model returned nothing that could be read at all. The retrieved sources and the
 * gaps stay; the panels say that nothing could be organised from them.
 */
export function sectorPeerUnusableBoard(searchGaps: string[]): SectorPeerBoard {
  return {
    peers: [], stageSignals: [], capitalEvents: [], usReferences: [],
    gaps: [...searchGaps, "文字整理模型返回的内容无法使用，本次未整理出可引用结论；下方只列本次检索到的来源与缺口。"].slice(0, MAX_GAPS),
  };
}
