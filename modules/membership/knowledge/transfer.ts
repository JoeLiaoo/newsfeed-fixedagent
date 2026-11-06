import { createHash } from "node:crypto";
import { baseSlugOf, scopedSlug, scopedTargetKey, DEFAULT_BASE_ID } from "./slugs.ts";

/** 迁移到另一套环境时使用的知识库名称。没有同名库就新建。 */
export const AI_FOR_SCIENCE_BASE_NAME = "AI for Science";

export const KNOWLEDGE_DUMP_FORMAT = "citic-knowledge-base-v1";

export type KnowledgeDumpVersion = {
  versionNo: number;
  fileName: string;
  mediaType: string;
  format: "pdf" | "docx" | "pptx" | "markdown";
  byteSize: number;
  sha256: string;
  bodyFile: string;
  sourceTitle: string | null;
  sourceAuthor: string | null;
  sourceOrg: string | null;
  sourceDate: string | null;
  sourceKind: string | null;
  sourceUrl: string | null;
  extractedText: string | null;
  extractionStatus: "pending" | "available" | "unavailable";
  extractionNote: string | null;
  figureManifest: unknown;
};

export type KnowledgeDumpDocument = {
  title: string;
  status: "active" | "withdrawn";
  versions: KnowledgeDumpVersion[];
};

export type KnowledgeDumpRevision = {
  revision: number;
  bodyMd: string;
  coverage: unknown;
  versionSha256: string | null;
};

export type KnowledgeDumpCitation = {
  revision: number;
  versionSha256: string;
  label: string;
  anchor: string | null;
  analyst: string | null;
  organization: string | null;
  publishedOn: string | null;
  sourceTitle: string | null;
};

export type KnowledgeDumpPage = {
  slug: string;
  pageType: "view" | "query" | "concept" | "monitor";
  targetType: string | null;
  targetName: string | null;
  targetKey: string;
  track: string | null;
  status: "published" | "withdrawn";
  revisions: KnowledgeDumpRevision[];
  citations: KnowledgeDumpCitation[];
};

export type KnowledgeDumpFigure = {
  versionSha256: string;
  ordinal: number;
  locator: unknown;
  caption: string | null;
  context: string | null;
  originalSha256: string;
  normalizedSha256: string;
  mediaType: string;
  width: number;
  height: number;
  originalFile: string;
  normalizedFile: string;
};

export type KnowledgeDump = {
  format: typeof KNOWLEDGE_DUMP_FORMAT;
  base: { name: string; description: string; status: "active" | "archived" };
  documents: KnowledgeDumpDocument[];
  pages: KnowledgeDumpPage[];
  figures: KnowledgeDumpFigure[];
};

export function assertKnowledgeDump(value: unknown): KnowledgeDump {
  if (!value || typeof value !== "object") throw new Error("知识库导出不是对象");
  const record = value as Record<string, unknown>;
  if (record.format !== KNOWLEDGE_DUMP_FORMAT) throw new Error(`知识库导出格式必须是 ${KNOWLEDGE_DUMP_FORMAT}`);
  const base = record.base as Record<string, unknown> | undefined;
  if (!base || typeof base.name !== "string" || base.name.trim().length < 2) throw new Error("知识库导出缺少名称");
  if (!Array.isArray(record.documents) || !Array.isArray(record.pages)) throw new Error("知识库导出缺少材料或页面");
  return {
    format: KNOWLEDGE_DUMP_FORMAT,
    base: {
      name: base.name.trim(),
      description: typeof base.description === "string" ? base.description : "",
      status: base.status === "archived" ? "archived" : "active",
    },
    documents: record.documents as KnowledgeDumpDocument[],
    pages: record.pages as KnowledgeDumpPage[],
    figures: Array.isArray(record.figures) ? record.figures as KnowledgeDumpFigure[] : [],
  };
}

export function summarizeKnowledgeDump(dump: KnowledgeDump): { documents: number; versions: number; pages: number; figures: number } {
  return {
    documents: dump.documents.length,
    versions: dump.documents.reduce((sum, document) => sum + document.versions.length, 0),
    pages: dump.pages.length,
    figures: dump.figures.length,
  };
}

/** 导出时去掉库前缀，导入到新库号时再加回去。 */
export function exportSlug(baseId: string, slug: string): string {
  return baseSlugOf(slug, baseId);
}

export function exportTargetKey(baseId: string, targetKey: string): string {
  if (!targetKey || baseId === DEFAULT_BASE_ID) return targetKey;
  const prefix = `${baseId}|`;
  return targetKey.startsWith(prefix) ? targetKey.slice(prefix.length) : targetKey;
}

export function importSlug(baseId: string, slug: string): string {
  return scopedSlug(baseId, slug);
}

export function importTargetKey(baseId: string, targetKey: string): string {
  return targetKey ? scopedTargetKey(baseId, targetKey) : "";
}

/** 材料 zip 里的 markdown。目录和空文件不算一份材料。 */
export function markdownMaterials(files: Iterable<[string, Buffer | string]>): Array<{ title: string; fileName: string; bytes: Buffer; sha256: string }> {
  const materials = [];
  for (const [path, body] of files) {
    if (path.endsWith("/") || path.split("/").some((part) => part === "..")) continue;
    const fileName = path.split("/").pop() ?? path;
    if (!fileName.toLowerCase().endsWith(".md")) continue;
    const bytes = typeof body === "string" ? Buffer.from(body) : body;
    if (!bytes.length) continue;
    materials.push({
      title: fileName.replace(/\.md$/i, ""),
      fileName,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  materials.sort((a, b) => a.fileName.localeCompare(b.fileName, "zh-CN"));
  return materials;
}

/** 阻止导出文件名带着目录跳出去。 */
export function safeDumpPath(relative: string): string {
  const normalized = relative.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new Error(`导出路径不安全：${relative}`);
  }
  return normalized;
}
