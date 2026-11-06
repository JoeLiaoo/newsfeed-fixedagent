// 把知识库导出目录，或一份 markdown 材料 zip，导入到指定名称的库。没有同名库就新建。
// 材料 zip 只入库，不排队编译，也不会调用模型。完整页面只来自导出目录里的 manifest。
//
// 用法：
//   node --env-file-if-exists=.env scripts/import-knowledge-base.ts --dump dumps/ai-for-science --name "AI for Science" --dry-run
//   node --env-file-if-exists=.env scripts/import-knowledge-base.ts --materials uploads/ai4s-materials.zip --name "AI for Science"
// 需要一名已启用管理员：npm run member:bootstrap-admin
// 重复运行按材料内容校验值跳过已有版本，按页面地址跳过已有页面。
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readZipBytes } from "../modules/membership/gp/zip-text.ts";
import {
  AI_FOR_SCIENCE_BASE_NAME, assertKnowledgeDump, importSlug, importTargetKey, markdownMaterials, safeDumpPath, summarizeKnowledgeDump,
  type KnowledgeDump,
} from "../modules/membership/knowledge/transfer.ts";
import { parseArgs } from "./lib/cli.ts";

const args = parseArgs(process.argv.slice(2));
const name = typeof args.get("name") === "string" ? args.get("name") as string : AI_FOR_SCIENCE_BASE_NAME;
const dumpDir = typeof args.get("dump") === "string" ? args.get("dump") as string : "";
const materialsPath = typeof args.get("materials") === "string" ? args.get("materials") as string : "";
if (args.has("help") || (!dumpDir && !materialsPath)) {
  console.log("用法：node --env-file-if-exists=.env scripts/import-knowledge-base.ts [--dump <目录>] [--materials <zip>] [--name \"AI for Science\"] [--dry-run]");
  process.exit(args.has("help") ? 0 : 1);
}

function readInside(relative: string): Buffer {
  const safe = safeDumpPath(relative);
  const full = resolve(dumpDir, safe);
  const root = resolve(dumpDir);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`导出路径不安全：${relative}`);
  return readFileSync(full);
}

const dump: KnowledgeDump | null = dumpDir ? assertKnowledgeDump(JSON.parse(readFileSync(join(dumpDir, "manifest.json"), "utf8"))) : null;
const asJson = (value: unknown) => value as never;
const materials = materialsPath ? markdownMaterials(readZipBytes(readFileSync(materialsPath))) : [];
const summary = {
  name,
  dump: dump ? summarizeKnowledgeDump(dump) : null,
  materials: materials.length,
  dryRun: args.has("dry-run"),
};
console.log(JSON.stringify(summary, null, 2));
if (args.has("dry-run")) process.exit(0);

const { sql, closeDb } = await import("@aihot/backend/db");
const { MAX_BASES, ensureDefaultBase, newBaseId } = await import("../modules/membership/knowledge/bases.ts");
try {
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE role = 'admin' AND status = 'active' ORDER BY created_at, id LIMIT 1`;
  if (!admin) throw new Error("需要先有一名已启用的管理员。请先运行 npm run member:bootstrap-admin。");
  await ensureDefaultBase();
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM member_wiki_bases WHERE name = ${name} ORDER BY created_at, id LIMIT 1`;
  let baseId = existing?.id ?? "";
  if (!baseId) {
    const [count] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM member_wiki_bases`;
    if ((count?.count ?? 0) >= MAX_BASES) throw new Error(`知识库数量已达上限（${MAX_BASES} 个）。`);
    baseId = newBaseId();
    await sql`INSERT INTO member_wiki_bases (id, name, description, status, created_by)
      VALUES (${baseId}, ${name}, ${dump?.base.description ?? ""}, ${dump?.base.status ?? "active"}, ${admin.id})`;
  }
  const versionIds = new Map<string, string>();
  await sql.begin(async (tx) => {
    for (const document of dump?.documents ?? []) {
      let documentId = "";
      for (const version of document.versions) {
        const bytes = readInside(version.bodyFile);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (sha256 !== version.sha256) throw new Error(`材料 ${version.fileName} 的内容校验不一致`);
        const [found] = await tx<{ document_id: string; id: string }[]>`SELECT d.id AS document_id, v.id
          FROM member_wiki_document_versions v JOIN member_wiki_documents d ON d.id = v.document_id
          WHERE d.base_id = ${baseId} AND v.sha256 = ${sha256} LIMIT 1`;
        if (found) {
          documentId = found.document_id;
          versionIds.set(sha256, found.id);
          continue;
        }
        if (!documentId) {
          documentId = randomUUID();
          await tx`INSERT INTO member_wiki_documents (id, uploader_id, title, status, base_id)
            VALUES (${documentId}, ${admin.id}, ${document.title}, ${document.status}, ${baseId})`;
        }
        const versionId = randomUUID();
        await tx`INSERT INTO member_wiki_document_versions (
            id, document_id, version_no, uploader_id, file_name, media_type, format, byte_size, sha256, body,
            source_title, source_author, source_org, source_date, source_kind, source_url, extracted_text, extraction_status, extraction_note, figure_manifest
          ) VALUES (
            ${versionId}, ${documentId}, ${version.versionNo}, ${admin.id}, ${version.fileName}, ${version.mediaType}, ${version.format},
            ${bytes.length}, ${sha256}, ${bytes}, ${version.sourceTitle}, ${version.sourceAuthor}, ${version.sourceOrg}, ${version.sourceDate}::date,
            ${version.sourceKind}, ${version.sourceUrl}, ${version.extractedText}, ${version.extractionStatus}, ${version.extractionNote}, ${tx.json(asJson(version.figureManifest ?? null))}
          )`;
        versionIds.set(sha256, versionId);
      }
    }
    for (const material of materials) {
      const [found] = await tx<{ id: string }[]>`SELECT v.id FROM member_wiki_document_versions v
        JOIN member_wiki_documents d ON d.id = v.document_id WHERE d.base_id = ${baseId} AND v.sha256 = ${material.sha256} LIMIT 1`;
      if (found) continue;
      const documentId = randomUUID();
      const versionId = randomUUID();
      const text = material.bytes.toString("utf8");
      await tx`INSERT INTO member_wiki_documents (id, uploader_id, title, base_id) VALUES (${documentId}, ${admin.id}, ${material.title}, ${baseId})`;
      await tx`INSERT INTO member_wiki_document_versions (
          id, document_id, version_no, uploader_id, file_name, media_type, format, byte_size, sha256, body, extracted_text, extraction_status, extraction_note
        ) VALUES (
          ${versionId}, ${documentId}, 1, ${admin.id}, ${material.fileName}, 'text/markdown', 'markdown', ${material.bytes.length}, ${material.sha256},
          ${material.bytes}, ${text}, 'available', '由材料包导入，未排队编译知识页。'
        )`;
    }
    for (const page of dump?.pages ?? []) {
      const slug = importSlug(baseId, page.slug);
      const targetKey = importTargetKey(baseId, page.targetKey);
      const [found] = await tx<{ id: string }[]>`SELECT id FROM member_wiki_pages WHERE base_id = ${baseId} AND slug = ${slug} LIMIT 1`;
      const pageId = found?.id ?? randomUUID();
      if (!found) {
        await tx`INSERT INTO member_wiki_pages (id, slug, page_type, target_type, target_name, target_key, track, status, base_id)
          VALUES (${pageId}, ${slug}, ${page.pageType}, ${page.targetType}, ${page.targetName}, ${targetKey}, ${page.track}, ${page.status}, ${baseId})`;
      }
      for (const revision of page.revisions) {
        const [have] = await tx<{ id: string }[]>`SELECT id FROM member_wiki_page_revisions WHERE page_id = ${pageId} AND revision = ${revision.revision} LIMIT 1`;
        if (have) continue;
        await tx`INSERT INTO member_wiki_page_revisions (id, page_id, revision, body_md, coverage, version_id)
          VALUES (${randomUUID()}, ${pageId}, ${revision.revision}, ${revision.bodyMd}, ${tx.json(asJson(revision.coverage ?? {}))}, ${revision.versionSha256 ? versionIds.get(revision.versionSha256) ?? null : null})`;
      }
      for (const citation of page.citations) {
        const versionId = versionIds.get(citation.versionSha256);
        if (!versionId) continue;
        const [have] = await tx<{ id: string }[]>`SELECT id FROM member_wiki_citations
          WHERE page_id = ${pageId} AND revision = ${citation.revision} AND label = ${citation.label} AND version_id = ${versionId} LIMIT 1`;
        if (have) continue;
        await tx`INSERT INTO member_wiki_citations (id, page_id, revision, version_id, label, anchor, analyst, organization, published_on, source_title)
          VALUES (${randomUUID()}, ${pageId}, ${citation.revision}, ${versionId}, ${citation.label}, ${citation.anchor}, ${citation.analyst},
            ${citation.organization}, ${citation.publishedOn}::date, ${citation.sourceTitle})`;
      }
    }
    for (const figure of dump?.figures ?? []) {
      const versionId = versionIds.get(figure.versionSha256);
      if (!versionId) continue;
      const [have] = await tx<{ id: string }[]>`SELECT id FROM member_wiki_figure_assets WHERE version_id = ${versionId} AND ordinal = ${figure.ordinal} LIMIT 1`;
      if (have) continue;
      const original = readInside(figure.originalFile);
      const normalized = readInside(figure.normalizedFile);
      if (createHash("sha256").update(original).digest("hex") !== figure.originalSha256) throw new Error(`配图 ${figure.ordinal} 的原件校验不一致`);
      if (createHash("sha256").update(normalized).digest("hex") !== figure.normalizedSha256) throw new Error(`配图 ${figure.ordinal} 的归一化文件校验不一致`);
      await tx`INSERT INTO member_wiki_figure_assets (
          id, version_id, ordinal, locator, caption, context, original_sha256, normalized_sha256, original_body, normalized_body, media_type, width, height
        ) VALUES (
          ${randomUUID()}, ${versionId}, ${figure.ordinal}, ${tx.json(asJson(figure.locator ?? {}))}, ${figure.caption}, ${figure.context},
          ${figure.originalSha256}, ${figure.normalizedSha256}, ${original}, ${normalized}, ${figure.mediaType}, ${figure.width}, ${figure.height}
        )`;
    }
  });
  console.log(JSON.stringify({ baseId, name, wrote: true }));
} finally {
  await closeDb();
}
