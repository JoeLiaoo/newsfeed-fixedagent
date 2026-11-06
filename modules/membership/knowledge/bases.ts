// The knowledge bases of the library. A base is a named collection of materials with its own pages
// and its own answers: the library had one shared base before it had more than one, and that base
// keeps the keys and slugs its pages already carry, so the pages that are published stay the pages
// of that base.
import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
export { DEFAULT_BASE_ID, baseSlugOf, scopedSlug, scopedTargetKey } from "./slugs.ts";
import { DEFAULT_BASE_ID } from "./slugs.ts";

/** The name the default base carries. */
export const DEFAULT_BASE_NAME = "知识库示例";

/** The description the default base carries. */
export const DEFAULT_BASE_DESCRIPTION = "示例投研知识库：上传的材料自动构建成知识页，问答只依据已发布的页面。";

/** How many knowledge bases the library holds at once, the default one included. */
export const MAX_BASES = 20;

/** One knowledge base as the pages show it. */
export type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  documents: number;
  pages: number;
  building: number;
  failed: number;
};

/**
 * The default base, written the first time the library is read. The base belongs to the platform, not
 * to an employee, so it always carries the platform's own name and description: a base left over from
 * an earlier release is renamed when it is ensured, and a base an employee made is never touched.
 */
export async function ensureDefaultBase(): Promise<void> {
  const rows = await sql<{ name: string; description: string }[]>`SELECT name, description FROM member_wiki_bases WHERE id = ${DEFAULT_BASE_ID}`;
  const row = rows[0];
  if (!row) {
    await sql`INSERT INTO member_wiki_bases (id, name, description, status)
      VALUES (${DEFAULT_BASE_ID}, ${DEFAULT_BASE_NAME}, ${DEFAULT_BASE_DESCRIPTION}, 'active')
      ON CONFLICT (id) DO NOTHING`;
    return;
  }
  if (row.name === DEFAULT_BASE_NAME && row.description === DEFAULT_BASE_DESCRIPTION) return;
  await sql`UPDATE member_wiki_bases SET name = ${DEFAULT_BASE_NAME}, description = ${DEFAULT_BASE_DESCRIPTION}, updated_at = now()
    WHERE id = ${DEFAULT_BASE_ID}`;
}

/**
 * The base a request names. The default base is always there, even before its row was written; any
 * other base must exist and be open, or the request is about a base that is not there.
 */
export async function resolveBase(baseId: string | null | undefined): Promise<{ id: string; name: string } | null> {
  const wanted = (baseId ?? "").trim() || DEFAULT_BASE_ID;
  if (wanted === DEFAULT_BASE_ID) return { id: DEFAULT_BASE_ID, name: DEFAULT_BASE_NAME };
  const rows = await sql<{ id: string; name: string }[]>`SELECT id, name FROM member_wiki_bases WHERE id = ${wanted} AND status = 'active'`;
  return rows[0] ?? null;
}

/** A new base's id: short, url-safe and of its own. It is part of the address of the base's pages. */
export function newBaseId(): string {
  return `kb-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
