// The 2026-10-26 production failure: one claim cited five sources where the request allowed four,
// and the whole board was thrown away. These tests keep the answer that failed readable as a board.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { buildSectorPeerBoard, normalizeSectorPeerAnswer, sectorPeerUnusableBoard, SECTOR_PEER_MAX_SOURCE_IDS } from "../experts/sector-peer-board.ts";
import { renderSectorPeerDashboard } from "../experts/sector-peer-html.ts";
import { SECTOR_PEER_ANSWER_SCHEMA, SECTOR_PEER_SYNTHESIS_PROMPT } from "../experts/worker.ts";
import type { PublicSearchSource } from "@aihot/backend/providers/deepseek-search";

/** The sources that task retrieved: five for 同业, three for 阶段, four for 资本, five for 美国. */
function retrievedSources(): PublicSearchSource[] {
  const groups: PublicSearchSource["queryGroup"][] = [
    "peers", "peers", "peers", "peers", "peers", "stage", "stage", "stage",
    "capital", "capital", "capital", "capital", "us", "us", "us", "us", "us",
  ];
  return groups.map((queryGroup, index) => ({
    id: `S${index + 1}`, queryGroup, title: `来源 ${index + 1}`, url: `https://example.org/${index + 1}`,
    snippet: "", summary: "", content: "", date: null, siteName: "Example",
  }));
}

/** The shape of the answer that failed in production; the wording is replaced, the ids are the same. */
const productionAnswer = {
  peers: [
    { text: "同业结论一", sourceIds: ["S1", "S2"] },
    { text: "同业结论二", sourceIds: ["S1", "S2"] },
    { text: "同业结论三", sourceIds: ["S1", "S2", "S4"] },
    { text: "同业结论四", sourceIds: ["S1", "S2", "S4"] },
    { text: "同业结论五", sourceIds: ["S1", "S2"] },
    { text: "同业结论六", sourceIds: ["S3", "S5"] },
    { text: "同业结论七", sourceIds: ["S3", "S5"] },
    { text: "引用五个来源的同业结论", sourceIds: ["S3", "S4", "S5", "S6", "S7"] },
    { text: "同业结论九", sourceIds: ["S8"] },
    { text: "同业结论十", sourceIds: ["S11"] },
  ],
  stageSignals: [
    { text: "阶段信号一", sourceIds: ["S4", "S6", "S7"] },
    { text: "阶段信号二", sourceIds: ["S4", "S6", "S7"] },
    { text: "阶段信号三", sourceIds: ["S4", "S6", "S7"] },
    { text: "阶段信号四", sourceIds: ["S4", "S6", "S7"] },
    { text: "阶段信号五", sourceIds: ["S8"] },
    { text: "阶段信号六", sourceIds: ["S11"] },
    { text: "阶段信号七", sourceIds: ["S3", "S5"] },
  ],
  capitalEvents: [
    { text: "资本事件一", sourceIds: ["S8", "S10"] },
    { text: "资本事件二", sourceIds: ["S11"] },
    { text: "资本事件三", sourceIds: ["S9"] },
    { text: "资本事件四", sourceIds: ["S12"] },
  ],
  usReferences: [
    { text: "美国参考一", sourceIds: ["S13", "S14", "S17"] },
    { text: "美国参考二", sourceIds: ["S13", "S14", "S17"] },
    { text: "美国参考三", sourceIds: ["S13", "S14", "S17"] },
    { text: "美国参考四", sourceIds: ["S1", "S2"] },
    { text: "美国参考五", sourceIds: ["S1", "S2"] },
    { text: "美国参考六", sourceIds: ["S3", "S5"] },
    { text: "美国参考七", sourceIds: ["S3", "S5"] },
    { text: "美国参考八", sourceIds: ["S3", "S5"] },
    { text: "美国参考九", sourceIds: ["S1", "S2"] },
  ],
  gaps: ["公开披露不完整", "融资轮次未披露", "时间口径未披露", "客户名单未披露", "产能未披露"],
};

/** The request that failed: it asked for JSON and refused one claim with five sources. */
const strictSchema = z.object({
  peers: z.array(z.object({ text: z.string().min(1).max(1200), sourceIds: z.array(z.string().max(12)).min(1).max(4) })).max(12),
  stageSignals: z.array(z.object({ text: z.string().min(1).max(1200), sourceIds: z.array(z.string().max(12)).min(1).max(4) })).max(16),
  capitalEvents: z.array(z.object({ text: z.string().min(1).max(1200), sourceIds: z.array(z.string().max(12)).min(1).max(4) })).max(20),
  usReferences: z.array(z.object({ text: z.string().min(1).max(1200), sourceIds: z.array(z.string().max(12)).min(1).max(4) })).max(12),
  gaps: z.array(z.string().min(1).max(500)).max(12),
});

test("the answer that failed in production is refused by the old request and read by the new one", () => {
  const refused = strictSchema.safeParse(productionAnswer);
  assert.equal(refused.success, false, "the request that failed must stay documented as the failing shape");
  assert.deepEqual(refused.error?.issues[0]?.path, ["peers", 7, "sourceIds"]);
  assert.equal(SECTOR_PEER_ANSWER_SCHEMA.safeParse(productionAnswer).success, true, "the request must not refuse a readable answer");
  assert.equal(SECTOR_PEER_ANSWER_SCHEMA.safeParse("not an object").success, true, "the reader, not the request, decides what can be read");
});

test("the answer that failed in production reads as a board with its citations", () => {
  const sources = retrievedSources();
  const board = buildSectorPeerBoard({ answer: productionAnswer, sources, searchGaps: [] });
  assert.equal(board.peers.length, 10);
  assert.equal(board.stageSignals.length, 7);
  assert.equal(board.capitalEvents.length, 4);
  assert.equal(board.usReferences.length, 3, "美国参考 keeps only the claims that cite 美国来源");
  assert.deepEqual(board.peers[7]?.sourceIds, ["S3", "S4", "S5", "S6", "S7"], "the claim that cited five sources stays, with its sources");
  assert.ok(board.gaps.some(gap => gap.includes("「美国参考」")), "the dropped 美国参考 claims are disclosed");
  const html = renderSectorPeerDashboard({ query: "recursive self improvement", generatedAt: new Date("2026-10-26T00:27:00Z"), board, sources });
  assert.ok(html.includes("引用五个来源的同业结论"));
  assert.ok(html.includes("https://example.org/7"));
  assert.ok(!html.includes("DeepSeek"));
});

test("a panel that cannot be read stays empty and says so, and the other panels are untouched", () => {
  const sources = retrievedSources();
  const board = buildSectorPeerBoard({
    answer: { peers: [{ text: "同业结论", sourceIds: ["S1"] }], stageSignals: "不是数组", capitalEvents: [{ text: "资本事件", sourceIds: ["S9"] }] },
    sources, searchGaps: ["检索缺口"],
  });
  assert.equal(board.peers.length, 1);
  assert.equal(board.stageSignals.length, 0);
  assert.equal(board.capitalEvents.length, 1);
  assert.ok(board.gaps.some(gap => gap.includes("「发展到哪」")));
  assert.ok(board.gaps.some(gap => gap.includes("检索缺口")));
});

test("claims that cite sources this task did not retrieve are dropped and counted", () => {
  const sources = retrievedSources();
  const board = buildSectorPeerBoard({
    answer: { peers: [{ text: "无来源断言", sourceIds: ["S999"] }, { text: "有来源断言", sourceIds: ["S1"] }] },
    sources, searchGaps: [],
  });
  assert.deepEqual(board.peers.map(claim => claim.text), ["有来源断言"]);
  assert.ok(board.gaps.some(gap => gap.includes("不在本次检索结果中")));
});

test("a claim may cite more sources than the old request allowed, and the board keeps what it read", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `S${index + 1}`);
  const { board, notes } = normalizeSectorPeerAnswer({ peers: [{ text: "多来源结论", sourceIds: ids }] });
  assert.equal(board.peers.length, 1);
  assert.equal(board.peers[0]?.sourceIds.length, SECTOR_PEER_MAX_SOURCE_IDS);
  assert.ok(notes.some(note => note.includes("超过")));
});

test("a claim that reads as nothing usable is dropped, and a long sentence is trimmed", () => {
  const { board, notes } = normalizeSectorPeerAnswer({
    peers: ["不是对象", { sourceIds: ["S1"] }, { text: "", sourceIds: ["S1"] }, { text: "x".repeat(1500), sourceIds: [1, "S1", "S1"] }],
    gaps: [{ text: "缺口说明" }, "  ", 42],
  });
  assert.equal(board.peers.length, 1);
  assert.equal(board.peers[0]?.text.length, 1200);
  assert.deepEqual(board.peers[0]?.sourceIds, ["S1"]);
  assert.deepEqual(board.gaps, ["缺口说明"]);
  assert.ok(notes.some(note => note.includes("不符合格式要求")));
});

test("a source id the model wrote as one value instead of a list still names a source", () => {
  const { board } = normalizeSectorPeerAnswer({ peers: [{ text: "单一来源结论", sourceIds: "S3" }, { text: "编号来源结论", sourceIds: 7 }] });
  assert.deepEqual(board.peers.map(claim => claim.sourceIds), [["S3"], ["S7"]]);
});

test("an answer that is not an object gives an empty board with gaps", () => {
  const board = buildSectorPeerBoard({ answer: "模型只返回了一段文字", sources: retrievedSources(), searchGaps: [] });
  assert.equal(board.peers.length, 0);
  assert.equal(board.stageSignals.length, 0);
  assert.equal(board.capitalEvents.length, 0);
  assert.equal(board.usReferences.length, 0);
  assert.ok(board.gaps.length > 0);
});

test("a model answer that cannot be used at all still leaves the employee a board", () => {
  const board = sectorPeerUnusableBoard(["检索缺口"]);
  assert.equal(board.peers.length, 0);
  assert.ok(board.gaps.some(gap => gap.includes("文字整理模型返回的内容无法使用")));
  const html = renderSectorPeerDashboard({ query: "recursive self improvement", generatedAt: new Date(), board, sources: retrievedSources() });
  assert.ok(html.includes("未披露／未检索到可引用的可靠公开证据"));
  assert.ok(html.includes("检索来源"));
});

test("the synthesis prompt asks for the five arrays and a bounded number of sources", () => {
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /五个键都要出现/);
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /最多 8 个/);
  assert.match(SECTOR_PEER_SYNTHESIS_PROMPT, /不要补造公司或事件/);
});
