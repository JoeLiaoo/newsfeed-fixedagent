import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyEmployeeChangelog, assertNoPendingChangelog, parseChangelog, parsePending } from "../scripts/apply-employee-changelog.ts";

const old = { date: "2026-10-25", time: "16:27", kind: "公告", title: "旧公告", body: ["旧内容"] };
const first = { kind: "更新", title: "新功能", body: ["员工可使用新功能。"] };
const second = { kind: "优化", title: "体验改进", body: ["列表更容易浏览。"], urgent: true };

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "employee-changelog-"));
  const pending = path.join(root, "site/changelog/pending");
  await mkdir(pending, { recursive: true });
  await writeFile(path.join(root, "site/changelog.json"), JSON.stringify({ latestVersion: "2026-10-25T16:27", releases: [old] }));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("pending parser only accepts employee changelog fields", () => {
  assert.deepEqual(parsePending(first, "note.json"), first);
  assert.throws(() => parsePending({ ...first, kind: "修复" }, "bad.json"), /invalid kind/);
  assert.throws(() => parsePending({ ...first, date: "2026-10-26" }, "bad.json"), /unsupported field date/);
  assert.throws(() => parsePending({ ...first, body: [] }, "bad.json"), /body must contain/);
});

test("apply uses one Beijing timestamp, prepends in filename order, and removes pending", async () => fixture(async root => {
  const pending = path.join(root, "site/changelog/pending");
  await writeFile(path.join(pending, "02-optimization.json"), JSON.stringify(second));
  await writeFile(path.join(pending, "01-feature.json"), JSON.stringify(first));
  const result = await applyEmployeeChangelog(root, new Date("2026-10-25T23:31:00Z"));
  assert.deepEqual(result, { applied: 2, pending: 2, version: "2026-10-26T07:31" });
  const raw = JSON.parse(await readFile(path.join(root, "site/changelog.json"), "utf8"));
  const data = parseChangelog(raw);
  assert.equal(data.latestVersion, "2026-10-26T07:31");
  assert.deepEqual(data.releases, [
    { date: "2026-10-26", time: "07:31", ...first },
    { date: "2026-10-26", time: "07:31", ...second },
    old,
  ]);
  assert.deepEqual((await readdir(pending)).filter(name => name.endsWith(".json")), []);
  assert.deepEqual(await applyEmployeeChangelog(root), { applied: 0, pending: 0, version: null });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "site/changelog.json"), "utf8")), raw);
}));

test("invalid batch leaves changelog and pending untouched", async () => fixture(async root => {
  const file = path.join(root, "site/changelog/pending/bad.json");
  await writeFile(file, JSON.stringify({ ...first, kind: "修复" }));
  const before = await readFile(path.join(root, "site/changelog.json"), "utf8");
  await assert.rejects(applyEmployeeChangelog(root), /invalid kind/);
  assert.equal(await readFile(path.join(root, "site/changelog.json"), "utf8"), before);
  assert.ok((await readdir(path.dirname(file))).includes("bad.json"));
}));

test("retry after changelog write skips already present content and clears pending", async () => fixture(async root => {
  const file = path.join(root, "site/changelog/pending/feature.json");
  await writeFile(file, JSON.stringify(first));
  await applyEmployeeChangelog(root, new Date("2026-10-26T00:00:00Z"));
  await writeFile(file, JSON.stringify(first));
  const before = await readFile(path.join(root, "site/changelog.json"), "utf8");
  assert.deepEqual(await applyEmployeeChangelog(root, new Date("2026-10-26T00:01:00Z")), { applied: 0, pending: 1, version: null });
  assert.equal(await readFile(path.join(root, "site/changelog.json"), "utf8"), before);
  assert.deepEqual((await readdir(path.dirname(file))).filter(name => name.endsWith(".json")), []);
}));

test("clock regression cannot make the red-dot version older", async () => fixture(async root => {
  await writeFile(path.join(root, "site/changelog/pending/feature.json"), JSON.stringify(first));
  await assert.rejects(applyEmployeeChangelog(root, new Date("2026-10-25T00:00:00Z")), /must be newer/);
  assert.equal((await readdir(path.join(root, "site/changelog/pending"))).length, 1);
}));

test("release gate fails on pending JSON but ignores directory keepers", async () => fixture(async root => {
  const pending = path.join(root, "site/changelog/pending");
  await writeFile(path.join(pending, "README.md"), "instructions");
  await writeFile(path.join(pending, ".gitkeep"), "");
  await assertNoPendingChangelog(root);
  await writeFile(path.join(pending, "feature.json"), JSON.stringify(first));
  await assert.rejects(assertNoPendingChangelog(root), /feature\.json.*run npm run changelog:apply/);
  await applyEmployeeChangelog(root, new Date("2026-10-26T00:00:00Z"));
  await assertNoPendingChangelog(root);
}));
