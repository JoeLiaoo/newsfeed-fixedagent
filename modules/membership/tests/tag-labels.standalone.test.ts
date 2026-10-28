import assert from "node:assert/strict";
import { test } from "node:test";
import { memberDisplayTags } from "../tag-labels.ts";

test("member tag labels replace entity keys and discard unknown ids", () => {
  assert.deepEqual(memberDisplayTags(["人工智能", "entity:deepseek", "DeepSeek", "entity:openai", "entity:unknown-subject"]),
    ["人工智能", "DeepSeek", "OpenAI"]);
});
