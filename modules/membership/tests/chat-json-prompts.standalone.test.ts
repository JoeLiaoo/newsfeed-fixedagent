import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SECTOR_PEER_SYNTHESIS_PROMPT } from "../experts/worker.ts";
import { ANSWER_SYSTEM, AUDITOR_SYSTEM, BUILDER_SYSTEM } from "../knowledge/prompts.ts";
import { FIGURE_READ_SYSTEM, FIGURE_VERIFY_SYSTEM } from "../knowledge/figure-model.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const importedPrompts: Record<string, string> = { ANSWER_SYSTEM, AUDITOR_SYSTEM, BUILDER_SYSTEM, SECTOR_PEER_SYNTHESIS_PROMPT, FIGURE_READ_SYSTEM, FIGURE_VERIFY_SYSTEM };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("every membership chatJson system prompt names JSON mode", () => {
  let checked = 0;
  for (const path of sourceFiles(root)) {
    const source = readFileSync(path, "utf8");
    const callCount = [...source.matchAll(/\bchatJson\s*\(\s*\{/g)].length;
    if (!callCount) continue;
    const systems = [...source.matchAll(/\bsystem:\s*(?:"([^"]*)"|`([^`]*)`|([A-Z_]+))/g)];
    assert.equal(systems.length, callCount, `${path}: resolve every chatJson system prompt for this audit`);
    for (const [, literal, template, identifier] of systems) {
      const prompt = literal ?? template ?? importedPrompts[identifier!];
      assert.ok(typeof prompt === "string", `${path}: resolve chatJson system prompt for this audit`);
      assert.match(prompt, /JSON/i, `${path}: chatJson system prompt must mention JSON`);
      checked++;
    }
  }
  assert.equal(checked, 11);
});
