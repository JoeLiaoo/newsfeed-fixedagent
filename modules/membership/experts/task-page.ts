/**
 * The employee task list reads one expert's history a page at a time. The list endpoint takes the
 * expert the history belongs to, the page size and the offset, and answers with the page and with
 * whether more history follows. The employee never reads another employee's tasks: the caller is
 * always the owner of the rows.
 */

/** How many tasks one page of the employee task list carries. */
export const EXPERT_TASK_PAGE_SIZE = 20;

/** The most one request may read, so a single page cannot pull the whole history into memory. */
export const EXPERT_TASK_MAX_LIMIT = 100;

/** How deep the list may page; deeper history is no longer reachable in one session. */
export const EXPERT_TASK_MAX_OFFSET = 100_000;

/** The slugs the platform writes: kebab-case builtins and `user-<hash>` imports. */
const EXPERT_SLUG = /^[A-Za-z0-9._:-]{1,200}$/;

export type ExpertTaskPageQuery = { limit?: unknown; offset?: unknown; expertSlug?: unknown };
export type ExpertTaskPage = { limit: number; offset: number; expertSlug: string | null };

/** A page number: digits only, then clamped into the range the list allows. */
function pageNumber(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The page the list endpoint reads, or `null` when the query is not a page at all. A repeated or
 * non-numeric parameter is refused instead of silently read as the first page.
 */
export function parseExpertTaskPage(query: ExpertTaskPageQuery): ExpertTaskPage | null {
  const limit = pageNumber(query.limit, EXPERT_TASK_PAGE_SIZE, 1, EXPERT_TASK_MAX_LIMIT);
  const offset = pageNumber(query.offset, 0, 0, EXPERT_TASK_MAX_OFFSET);
  if (limit === null || offset === null) return null;
  if (query.expertSlug === undefined || query.expertSlug === null) return { limit, offset, expertSlug: null };
  if (typeof query.expertSlug !== "string") return null;
  const expertSlug = query.expertSlug.trim();
  if (!expertSlug) return { limit, offset, expertSlug: null };
  if (!EXPERT_SLUG.test(expertSlug)) return null;
  return { limit, offset, expertSlug };
}

/** The page the list answers with: the rows it read, and whether more history follows. */
export function expertTaskPagination(limit: number, offset: number, rowCount: number) {
  const hasMore = rowCount > limit;
  return { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null };
}
