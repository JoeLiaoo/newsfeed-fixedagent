/** Parse bounded pagination for an employee's own task history. */
export const EXPERT_TASK_PAGE_SIZE = 20;
const MAX_OFFSET = 100_000;
const EXPERT_SLUG = /^[A-Za-z0-9._:-]{1,200}$/;

export type ExpertTaskPageQuery = { limit?: unknown; offset?: unknown; expertSlug?: unknown };
export type ExpertTaskPage = { limit: number; offset: number; expertSlug: string | null };

function pageNumber(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

export function parseExpertTaskPage(query: ExpertTaskPageQuery): ExpertTaskPage | null {
  const limit = pageNumber(query.limit, EXPERT_TASK_PAGE_SIZE, 1, 100);
  const offset = pageNumber(query.offset, 0, 0, MAX_OFFSET);
  if (limit === null || offset === null) return null;
  if (query.expertSlug === undefined || query.expertSlug === null) return { limit, offset, expertSlug: null };
  if (typeof query.expertSlug !== "string") return null;
  const expertSlug = query.expertSlug.trim();
  if (!expertSlug) return { limit, offset, expertSlug: null };
  return EXPERT_SLUG.test(expertSlug) ? { limit, offset, expertSlug } : null;
}

export function expertTaskPagination(limit: number, offset: number, rowCount: number) {
  const hasMore = rowCount > limit;
  return { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null };
}
