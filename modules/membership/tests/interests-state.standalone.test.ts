import assert from "node:assert/strict";
import test from "node:test";
import { toggleTagGroup } from "../pages/interests-state.ts";

test("checking a mixed group selects every group tag and retains unrelated tags", () => {
  assert.deepEqual(toggleTagGroup(["光伏", "人工智能"], ["光伏", "风电", "储能"], true), ["光伏", "人工智能", "风电", "储能"]);
});

test("unchecking a selected group clears only that group's tags", () => {
  assert.deepEqual(toggleTagGroup(["光伏", "风电", "人工智能"], ["光伏", "风电"], false), ["人工智能"]);
});

test("checking a mixed group does not duplicate already selected values", () => {
  assert.deepEqual(toggleTagGroup(["光伏", "光伏"], ["光伏", "风电"], true), ["光伏", "风电"]);
});
