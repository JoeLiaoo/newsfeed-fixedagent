import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AI_FOR_SCIENCE_BASE_NAME, assertKnowledgeDump, exportSlug, exportTargetKey, importSlug, importTargetKey,
  markdownMaterials, safeDumpPath, summarizeKnowledgeDump,
} from "../knowledge/transfer.ts";

test("a knowledge dump keeps its name and counts, and rejects another format", () => {
  const dump = assertKnowledgeDump({
    format: "citic-knowledge-base-v1",
    base: { name: AI_FOR_SCIENCE_BASE_NAME, description: "说明", status: "active" },
    documents: [{ title: "笔记", status: "active", versions: [{ sha256: "abc" }] }],
    pages: [],
  });
  assert.deepEqual(summarizeKnowledgeDump(dump), { documents: 1, versions: 1, pages: 0, figures: 0 });
  assert.throws(() => assertKnowledgeDump({ format: "other", base: { name: "库" }, documents: [], pages: [] }), /citic-knowledge-base-v1/);
});

test("page addresses round-trip onto another base and dump paths stay inside the folder", () => {
  assert.equal(exportSlug("kb-abc", "kb-abc-note"), "note");
  assert.equal(importSlug("kb-def", "note"), "kb-def-note");
  assert.equal(exportTargetKey("kb-abc", "kb-abc|公司"), "公司");
  assert.equal(importTargetKey("kb-def", "公司"), "kb-def|公司");
  assert.equal(importTargetKey("kb-def", ""), "");
  assert.equal(safeDumpPath("bodies/abc"), "bodies/abc");
  assert.throws(() => safeDumpPath("../secret"), /不安全/);
});

test("markdown materials skip directories and non-markdown files", () => {
  const materials = markdownMaterials([
    ["notes/", Buffer.from("目录")],
    ["notes/../escape.md", Buffer.from("跳出去")],
    ["notes/INDEX.md", "# 目录"],
    ["notes/001-note.md", "# 笔记"],
    ["notes/picture.png", Buffer.from([1, 2, 3])],
    ["notes/empty.md", ""],
  ]);
  assert.deepEqual(materials.map((item) => item.fileName), ["001-note.md", "INDEX.md"]);
  assert.equal(materials[0]?.title, "001-note");
});
