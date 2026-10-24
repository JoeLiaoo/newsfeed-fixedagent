import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { XINHUA_USED_TOOLS } from "./catalog.ts";

const MAX_ARCHIVE_BYTES = 1_000_000;
const MAX_UNPACKED_BYTES = 2_000_000;
const MAX_SKILL_BYTES = 500_000;
const MAX_ENTRIES = 24;

export type ImportedSkill = { name: string; description: string; version: string; skillMd: string; manifest: { tools: string[]; skills: string[] }; missingDependencies: string[] };

function safeString(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function parseDeclaredDependencies(header: string) {
  const result: { tools: string[]; skills: string[] } = { tools: [], skills: [] };
  let inDependencies = false;
  let kind: "tools" | "skills" | null = null;
  for (const line of header.split(/\r?\n/)) {
    const root = /^([a-z][a-z0-9_-]{0,40})\s*:\s*(.*?)\s*$/i.exec(line);
    if (root) {
      const key = root[1]!.toLowerCase();
      if (key === "dependencies") { if (root[2]) throw new Error("skill_dependencies_invalid"); inDependencies = true; kind = null; }
      else {
        inDependencies = false;
        kind = null;
        if (["requires", "mcp", "mcp_servers", "mcp_tools"].includes(key)) throw new Error("skill_dependencies_invalid");
        if (["tools", "skills", "required_tools", "required_skills"].includes(key)) {
          if (root[2]) throw new Error("skill_dependencies_invalid");
          kind = key.endsWith("tools") ? "tools" : "skills";
        }
      }
      continue;
    }
    const nested = /^\s+([a-z][a-z0-9_-]{0,40})\s*:\s*(.*?)\s*$/i.exec(line);
    if (inDependencies && nested && ["tools", "skills"].includes(nested[1]!.toLowerCase())) {
      if (nested[2]) throw new Error("skill_dependencies_invalid");
      kind = nested[1]!.toLowerCase() as "tools" | "skills";
      continue;
    }
    const item = /^\s+-\s+(.*?)\s*$/.exec(line);
    if (item && kind) {
      const dependency = safeString(item[1]!.replace(/^("|')(.*)\1$/, "$2"), 120);
      if (!dependency) throw new Error("skill_dependencies_invalid");
      result[kind].push(dependency);
    } else if (line.trim() && (inDependencies || kind)) throw new Error("skill_dependencies_invalid");
  }
  return result;
}

function parseFrontmatter(text: string) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) throw new Error("skill_frontmatter_required");
  const lines = text.split(/\r?\n/);
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close < 2) throw new Error("skill_frontmatter_invalid");
  const header = lines.slice(1, close).join("\n");
  const values = new Map<string, string>();
  for (const line of header.split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9_-]{0,40})\s*:\s*(.*?)\s*$/i.exec(line);
    if (match) values.set(match[1]!.toLowerCase(), match[2]!.replace(/^(["'])(.*)\1$/, "$2"));
  }
  const name = safeString(values.get("name"), 120);
  const description = safeString(values.get("description"), 500) ?? lines.slice(close + 1).find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 300);
  if (!name || !description) throw new Error("skill_name_or_description_missing");
  return { name, description, version: safeString(values.get("version"), 40) ?? "1.0.0", manifest: parseDeclaredDependencies(header) };
}

function zipDirectory(bytes: Uint8Array): string[] {
  // Check the central directory first so a tiny compressed archive cannot declare a huge expansion.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip_directory_invalid");
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count < 1 || count > MAX_ENTRIES || directoryOffset + directorySize > eocd) throw new Error("zip_limits_exceeded");
  const names: string[] = [];
  let offset = directoryOffset;
  let unpacked = 0;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip_directory_invalid");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength + extraLength + commentLength > bytes.length || flags & 1 || ![0, 8].includes(method)) throw new Error("zip_entry_unsupported");
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const unixMode = externalAttributes >>> 16;
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some(part => part === ".." || part === ".") || ((unixMode & 0o170000) === 0o120000)) throw new Error("zip_path_unsafe");
    unpacked += expanded;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error("zip_limits_exceeded");
    names.push(name);
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

function dependencies(text: string, manifest: Record<string, unknown>) {
  const list = (value: unknown) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || item.trim().length < 1 || item.length > 120)) throw new Error("manifest_dependencies_invalid");
    return value as string[];
  };
  if (manifest.dependencies !== undefined && (!manifest.dependencies || typeof manifest.dependencies !== "object" || Array.isArray(manifest.dependencies))) throw new Error("manifest_dependencies_invalid");
  const nested = manifest.dependencies ? manifest.dependencies as Record<string, unknown> : {};
  for (const key of Object.keys(manifest)) if (/tool|skill|mcp|depend|requir/i.test(key) && !["tools", "skills", "dependencies"].includes(key)) throw new Error("manifest_dependencies_invalid");
  for (const key of Object.keys(nested)) if (!["tools", "skills"].includes(key)) throw new Error("manifest_dependencies_invalid");
  const explicitTools = list(manifest.tools ?? nested.tools);
  const explicitSkills = list(manifest.skills ?? nested.skills);
  const dependencyPattern = /^[a-z0-9][a-z0-9._:/-]{0,119}(?:@(?:\^|~|>=|<=|=)?\d+\.\d+\.\d+)?$/i;
  if ([...explicitTools, ...explicitSkills].some(dependency => !dependencyPattern.test(dependency))) throw new Error("manifest_dependencies_invalid");
  const metadata = parseFrontmatter(text);
  const platformTools = new Set<string>(XINHUA_USED_TOOLS);
  const hasCompleteAdapter = XINHUA_USED_TOOLS.every(name => explicitTools.includes(name));
  const required = new Set([
    ...explicitTools.filter(name => !platformTools.has(name)).map(name => `尚未适配的工具依赖：${name}`),
    ...(explicitTools.length && !hasCompleteAdapter ? ["新华财经适配需要同时声明主体检索、企业画像和直接投资三个工具"] : []),
    ...explicitSkills.map(name => name.split("@")[0]!.toLowerCase() === metadata.name.toLowerCase() ? `循环技能依赖：${name}` : `未发布的技能依赖：${name}`),
  ]);
  if (/悟道|wudao_mcp_gateway/i.test(text)) required.add("悟道 MCP (wudao_mcp_gateway)");
  if (/skills?\/(?:10|11|12)\b|10\/11\/12 专项 skill/i.test(text)) required.add("reference/SKILL.md 所引用的 10/11/12 专项 skill");
  if (/企查查|qichacha/i.test(text)) required.add("企查查 MCP（尚未接入）");
  if (/天眼查|tianyancha/i.test(text)) required.add("天眼查 MCP（已停用）");
  return [...required];
}

export function executionMode(manifest: { tools?: string[] }): "xinhua_trial" | "text_only" {
  return XINHUA_USED_TOOLS.every(name => manifest.tools?.includes(name)) ? "xinhua_trial" : "text_only";
}

export function parseSkillMarkdown(text: string): ImportedSkill {
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BYTES || text.includes("\0")) throw new Error("skill_size_or_encoding_invalid");
  const metadata = parseFrontmatter(text);
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(text) || /(?:^|\n)\s*(?:#!|<\?php)/.test(text)) throw new Error("skill_active_content_rejected");
  return { ...metadata, skillMd: text, manifest: metadata.manifest, missingDependencies: dependencies(text, metadata.manifest) };
}

export function parseSkillUpload(fileName: string, base64: string): ImportedSkill {
  if (typeof base64 !== "string" || base64.length > Math.ceil(MAX_ARCHIVE_BYTES * 4 / 3) + 8) throw new Error("skill_upload_too_large");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES || bytes.length === 0) throw new Error("skill_upload_too_large");
  if (fileName.toLowerCase().endsWith(".md")) return parseSkillMarkdown(bytes.toString("utf8"));
  if (!fileName.toLowerCase().endsWith(".zip")) throw new Error("skill_file_type_unsupported");
  const names = zipDirectory(bytes);
  const allowed = new Set(["manifest.json", "SKILL.md"]);
  if (names.some(name => !allowed.has(name)) || new Set(names).size !== names.length || !names.includes("manifest.json") || !names.includes("SKILL.md")) throw new Error("zip_package_layout_invalid");
  const files = unzipSync(bytes, { filter: file => allowed.has(file.name) });
  const manifestBytes = files["manifest.json"];
  const skillBytes = files["SKILL.md"];
  if (!manifestBytes || !skillBytes || skillBytes.byteLength > MAX_SKILL_BYTES) throw new Error("zip_package_layout_invalid");
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    manifest = parsed as Record<string, unknown>;
  } catch { throw new Error("manifest_json_invalid"); }
  const allowedManifestFields = new Set(["name", "description", "version", "tools", "skills", "dependencies"]);
  if (Object.keys(manifest).some(key => !allowedManifestFields.has(key))) throw new Error("manifest_dependencies_invalid");
  const skillMd = new TextDecoder("utf-8", { fatal: true }).decode(skillBytes);
  const metadata = parseFrontmatter(skillMd);
  const name = safeString(manifest.name, 120) ?? metadata.name;
  const description = safeString(manifest.description, 500) ?? metadata.description;
  const version = safeString(manifest.version, 40) ?? metadata.version;
  if (manifest.dependencies !== undefined && (!manifest.dependencies || typeof manifest.dependencies !== "object" || Array.isArray(manifest.dependencies))) throw new Error("manifest_dependencies_invalid");
  const nested = manifest.dependencies ? manifest.dependencies as Record<string, unknown> : {};
  if (Object.keys(nested).some(key => !["tools", "skills"].includes(key))) throw new Error("manifest_dependencies_invalid");
  const normalizedManifest = {
    tools: [...new Set([...metadata.manifest.tools, ...dependenciesList(manifest.tools), ...dependenciesList(nested.tools)])],
    skills: [...new Set([...metadata.manifest.skills, ...dependenciesList(manifest.skills), ...dependenciesList(nested.skills)])],
  };
  return { name, description, version, skillMd, manifest: normalizedManifest, missingDependencies: dependencies(skillMd, normalizedManifest) };
}

function dependenciesList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || !item.trim() || item.trim().length > 120)) throw new Error("manifest_dependencies_invalid");
  return [...new Set(value.map(item => (item as string).trim()))];
}

export function expertSlug(userId: string, fileName: string, now = Date.now()) {
  return `user-${createHash("sha256").update(`${userId}:${fileName}:${now}`).digest("hex").slice(0, 24)}`;
}
