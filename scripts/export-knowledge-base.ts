// 把一个知识库导出成目录：manifest.json 加上材料正文和配图文件。
// 不包含问答、任务、审计和贡献。导入到另一套环境时用 scripts/import-knowledge-base.ts。
//
// 用法：
//   node --env-file-if-exists=.env scripts/export-knowledge-base.ts --name "AI for Science" --out dumps/ai-for-science
// 同名库有多个时导出最早的一个。没有这个名字就退出，不会新建空目录里的假库。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  KNOWLEDGE_DUMP_FORMAT, exportSlug, exportTargetKey, safeDumpPath, summarizeKnowledgeDump,
  type KnowledgeDump,
} from "../modules/membership/knowledge/transfer.ts";
import { parseArgs } from "./lib/cli.ts";

const args = parseArgs(process.argv.slice(2));
const name = typeof args.get("name") === "string" ? args.get("name") as string : "";
const out = typeof args.get("out") === "string" ? args.get("out") as string : "";
if (args.has("help") || !name || !out) {
  console.log("用法：node --env-file-if-exists=.env scripts/export-knowledge-base.ts --name \"AI for Science\" --out <目录>");
  process.exit(args.has("help") ? 0 : 1);
}

function day(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

function writeInside(relative: string, bytes: Buffer) {
  const safe = safeDumpPath(relative);
  const full = resolve(out, safe);
  const root = resolve(out);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`导出路径不安全：${relative}`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

const { sql, closeDb } = await import("@aihot/backend/db");
try {
  const [base] = await sql<{ id: string; name: string; description: string; status: string }[]>`
    SELECT id, name, description, status FROM member_wiki_bases WHERE name = ${name} ORDER BY created_at, id LIMIT 1`;
  if (!base) {
    console.error(`没有名为“${name}”的知识库。`);
    process.exitCode = 1;
  } else {
    const versions = await sql<{
      document_id: string; title: string; status: "active" | "withdrawn"; version_no: number; file_name: string; media_type: string;
      format: "pdf" | "docx" | "pptx" | "markdown"; byte_size: number; sha256: string; body: Buffer; source_title: string | null;
      source_author: string | null; source_org: string | null; source_date: Date | string | null; source_kind: string | null;
      source_url: string | null; extracted_text: string | null; extraction_status: "pending" | "available" | "unavailable";
      extraction_note: string | null; figure_manifest: unknown;
    }[]>`SELECT d.id AS document_id, d.title, d.status, v.version_no, v.file_name, v.media_type, v.format, v.byte_size, v.sha256, v.body,
        v.source_title, v.source_author, v.source_org, v.source_date, v.source_kind, v.source_url, v.extracted_text,
        v.extraction_status, v.extraction_note, v.figure_manifest
      FROM member_wiki_documents d JOIN member_wiki_document_versions v ON v.document_id = d.id
      WHERE d.base_id = ${base.id} ORDER BY d.created_at, d.id, v.version_no`;
    const documents = new Map<string, KnowledgeDump["documents"][number]>();
    for (const version of versions) {
      const bodyFile = safeDumpPath(`bodies/${version.sha256}`);
      writeInside(bodyFile, version.body);
      const current = documents.get(version.document_id) ?? { title: version.title, status: version.status, versions: [] };
      current.versions.push({
        versionNo: version.version_no, fileName: version.file_name, mediaType: version.media_type, format: version.format,
        byteSize: version.byte_size, sha256: version.sha256, bodyFile, sourceTitle: version.source_title, sourceAuthor: version.source_author,
        sourceOrg: version.source_org, sourceDate: day(version.source_date), sourceKind: version.source_kind, sourceUrl: version.source_url,
        extractedText: version.extracted_text, extractionStatus: version.extraction_status, extractionNote: version.extraction_note,
        figureManifest: version.figure_manifest ?? null,
      });
      documents.set(version.document_id, current);
    }
    const pages = await sql<{
      id: string; slug: string; page_type: KnowledgeDump["pages"][number]["pageType"]; target_type: string | null; target_name: string | null;
      target_key: string; track: string | null; status: "published" | "withdrawn";
    }[]>`SELECT id, slug, page_type, target_type, target_name, target_key, track, status
      FROM member_wiki_pages WHERE base_id = ${base.id} ORDER BY created_at, id`;
    const pageIds = pages.map((page) => page.id);
    const revisions = pageIds.length ? await sql<{ page_id: string; revision: number; body_md: string; coverage: unknown; version_sha256: string | null }[]>`
      SELECT r.page_id, r.revision, r.body_md, r.coverage, v.sha256 AS version_sha256
      FROM member_wiki_page_revisions r LEFT JOIN member_wiki_document_versions v ON v.id = r.version_id
      WHERE r.page_id = ANY(${pageIds}) ORDER BY r.page_id, r.revision` : [];
    const citations = pageIds.length ? await sql<{
      page_id: string; revision: number; version_sha256: string; label: string; anchor: string | null; analyst: string | null;
      organization: string | null; published_on: Date | string | null; source_title: string | null;
    }[]>`SELECT c.page_id, c.revision, v.sha256 AS version_sha256, c.label, c.anchor, c.analyst, c.organization, c.published_on, c.source_title
      FROM member_wiki_citations c JOIN member_wiki_document_versions v ON v.id = c.version_id
      WHERE c.page_id = ANY(${pageIds}) ORDER BY c.page_id, c.revision, c.label` : [];
    const figures = await sql<{
      sha256: string; ordinal: number; locator: unknown; caption: string | null; context: string | null; original_sha256: string;
      normalized_sha256: string; media_type: string; width: number; height: number; original_body: Buffer; normalized_body: Buffer;
    }[]>`SELECT v.sha256, f.ordinal, f.locator, f.caption, f.context, f.original_sha256, f.normalized_sha256, f.media_type, f.width, f.height,
        f.original_body, f.normalized_body
      FROM member_wiki_figure_assets f JOIN member_wiki_document_versions v ON v.id = f.version_id
      JOIN member_wiki_documents d ON d.id = v.document_id
      WHERE d.base_id = ${base.id} ORDER BY v.sha256, f.ordinal`;
    const dump: KnowledgeDump = {
      format: KNOWLEDGE_DUMP_FORMAT,
      base: { name: base.name, description: base.description, status: base.status === "archived" ? "archived" : "active" },
      documents: [...documents.values()],
      pages: pages.map((page) => ({
        slug: exportSlug(base.id, page.slug), pageType: page.page_type, targetType: page.target_type, targetName: page.target_name,
        targetKey: exportTargetKey(base.id, page.target_key), track: page.track, status: page.status,
        revisions: revisions.filter((row) => row.page_id === page.id).map((row) => ({
          revision: row.revision, bodyMd: row.body_md, coverage: row.coverage ?? {}, versionSha256: row.version_sha256,
        })),
        citations: citations.filter((row) => row.page_id === page.id).map((row) => ({
          revision: row.revision, versionSha256: row.version_sha256, label: row.label, anchor: row.anchor, analyst: row.analyst,
          organization: row.organization, publishedOn: day(row.published_on), sourceTitle: row.source_title,
        })),
      })),
      figures: figures.map((figure) => {
        const originalFile = safeDumpPath(`figures/${figure.sha256}-${figure.ordinal}-original`);
        const normalizedFile = safeDumpPath(`figures/${figure.sha256}-${figure.ordinal}-normalized`);
        writeInside(originalFile, figure.original_body);
        writeInside(normalizedFile, figure.normalized_body);
        return {
          versionSha256: figure.sha256, ordinal: figure.ordinal, locator: figure.locator, caption: figure.caption, context: figure.context,
          originalSha256: figure.original_sha256, normalizedSha256: figure.normalized_sha256, mediaType: figure.media_type,
          width: figure.width, height: figure.height, originalFile, normalizedFile,
        };
      }),
    };
    writeInside("manifest.json", Buffer.from(`${JSON.stringify(dump, null, 2)}\n`));
    console.log(JSON.stringify({ out, name: base.name, ...summarizeKnowledgeDump(dump) }, null, 2));
  }
} finally {
  await closeDb();
}
