import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangelogRelease, ChangelogResponse } from "../packages/contracts/src/site.ts";
import { beijingDate, beijingTime } from "../packages/contracts/src/time.ts";

const kinds = new Set<ChangelogRelease["kind"]>(["更新", "优化", "公告", "下线"]);
const pendingKeys = new Set(["kind", "title", "body", "urgent"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  return value as Record<string, unknown>;
}

function releaseFields(value: unknown, label: string): Pick<ChangelogRelease, "kind" | "title" | "body" | "urgent"> {
  const entry = object(value, label);
  if (!kinds.has(entry.kind as ChangelogRelease["kind"])) throw new Error(`${label}: invalid kind`);
  if (typeof entry.title !== "string" || !entry.title.trim()) throw new Error(`${label}: title is required`);
  if (!Array.isArray(entry.body) || !entry.body.length || entry.body.some(line => typeof line !== "string" || !line.trim())) throw new Error(`${label}: body must contain nonempty strings`);
  if (entry.urgent !== undefined && entry.urgent !== true) throw new Error(`${label}: urgent must be true when present`);
  return { kind: entry.kind as ChangelogRelease["kind"], title: entry.title, body: entry.body as string[], ...(entry.urgent === true ? { urgent: true as const } : {}) };
}

export function parsePending(value: unknown, filename: string): Pick<ChangelogRelease, "kind" | "title" | "body" | "urgent"> {
  const entry = object(value, filename);
  for (const key of Object.keys(entry)) if (!pendingKeys.has(key)) throw new Error(`${filename}: unsupported field ${key}`);
  return releaseFields(entry, filename);
}

export function parseChangelog(value: unknown): ChangelogResponse {
  const data = object(value, "changelog");
  if (typeof data.latestVersion !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.latestVersion)) throw new Error("changelog: invalid latestVersion");
  if (!Array.isArray(data.releases) || !data.releases.length) throw new Error("changelog: releases must be nonempty");
  for (const [index, raw] of data.releases.entries()) {
    const entry = object(raw, `release ${index}`);
    releaseFields(entry, `release ${index}`);
    if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || typeof entry.time !== "string" || !/^\d{2}:\d{2}$/.test(entry.time)) throw new Error(`release ${index}: invalid date/time`);
  }
  const first = data.releases[0] as ChangelogRelease;
  if (data.latestVersion !== `${first.date}T${first.time}`) throw new Error("changelog: latestVersion differs from newest release");
  return data as unknown as ChangelogResponse;
}

export function beijingMinute(now: Date): { date: string; time: string } {
  if (Number.isNaN(now.getTime())) throw new Error("invalid apply time");
  return { date: beijingDate(now), time: beijingTime(now) };
}

/** Release-only gate; feature PRs are expected to contain pending files. */
export async function assertNoPendingChangelog(root: string): Promise<void> {
  const files = (await readdir(path.join(root, "site/changelog/pending"))).filter(name => name.endsWith(".json")).sort();
  if (files.length) throw new Error(`unapplied employee changelog: ${files.join(", ")}; run npm run changelog:apply and commit before archive/build`);
}

function contentKey(entry: Pick<ChangelogRelease, "kind" | "title" | "body" | "urgent">): string {
  return JSON.stringify([entry.kind, entry.title, entry.body, entry.urgent === true]);
}

/** Applies a validated batch. A crash after writing can be retried without duplicating releases. */
export async function applyEmployeeChangelog(root: string, now = new Date()): Promise<{ applied: number; pending: number; version: string | null }> {
  const pendingDir = path.join(root, "site/changelog/pending");
  const files = (await readdir(pendingDir)).filter(name => name.endsWith(".json")).sort();
  if (!files.length) return { applied: 0, pending: 0, version: null };
  const changelogFile = path.join(root, "site/changelog.json");
  const changelog = parseChangelog(JSON.parse(await readFile(changelogFile, "utf8")));
  const pending = await Promise.all(files.map(async file => {
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(file)) throw new Error(`${file}: use a lowercase slug filename`);
    return parsePending(JSON.parse(await readFile(path.join(pendingDir, file), "utf8")), file);
  }));
  const known = new Set(changelog.releases.map(contentKey));
  const fresh = pending.filter(entry => {
    const key = contentKey(entry);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  let version: string | null = null;
  if (fresh.length) {
    const stamp = beijingMinute(now);
    version = `${stamp.date}T${stamp.time}`;
    if (version <= changelog.latestVersion) throw new Error(`apply time ${version} must be newer than ${changelog.latestVersion}`);
    const updated = parseChangelog({ latestVersion: version, releases: [...fresh.map(entry => ({ ...stamp, ...entry })), ...changelog.releases] });
    const temporary = `${changelogFile}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`);
    await rename(temporary, changelogFile);
  }
  for (const file of files) await unlink(path.join(pendingDir, file));
  return { applied: fresh.length, pending: files.length, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  if (process.argv[2] === "--check") {
    assertNoPendingChangelog(root).then(() => console.log("no pending changelog")).catch(error => { console.error(error); process.exitCode = 1; });
  } else if (process.argv.length > 2) {
    console.error("usage: node scripts/apply-employee-changelog.ts [--check]");
    process.exitCode = 1;
  } else applyEmployeeChangelog(root).then(result => {
    console.log(result.pending ? `applied ${result.applied} of ${result.pending} pending changelog entries${result.version ? `; latestVersion ${result.version}` : " (already present)"}` : "no pending changelog");
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
