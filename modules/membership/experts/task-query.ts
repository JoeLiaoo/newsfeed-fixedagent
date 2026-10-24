/**
 * The employee's own task list, read one page at a time. The list endpoint takes the page size, the
 * offset and, optionally, the expert or the state the page is about; it answers with the page and
 * with whether more follows. The rows are always the caller's own: the list never reaches another
 * employee's tasks, whatever the parameters say.
 */

/** How many tasks one page carries when the reader asks for none. */
export const TASK_PAGE_SIZE = 20;

/** The most one request may read, so one page cannot pull the whole history into memory. */
export const TASK_MAX_LIMIT = 100;

/** How deep the list may page; older history is out of reach in one session. */
export const TASK_MAX_OFFSET = 100_000;

/** The states a task can be in; a filter may only name one of them. */
export const TASK_STATES = ["queued", "waiting_input", "running", "succeeded", "failed", "cancelled"] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** The slugs the platform writes: kebab-case builtins and `user-<hash>` imports. */
const SLUG = /^[A-Za-z0-9._:-]{1,200}$/;

export type TaskPageQuery = { limit?: unknown; offset?: unknown; expertSlug?: unknown; state?: unknown };
export type TaskPage = { limit: number; offset: number; expertSlug: string | null; states: TaskState[] };
export type TaskPageResult = { ok: true; page: TaskPage } | { ok: false; error: "invalid_query" | "invalid_state" };

/**
 * A number the reader asked for: digits only, then clamped into the range the list allows. A value
 * that is not a number at all (a fraction, a word, a repeated parameter) is refused rather than read
 * as the first page. Query parameters arrive as text, so only text is a number here.
 */
function pageNumber(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The page the list endpoint reads. `ok: false` names the parameter that is not a page at all, so the
 * endpoint can refuse it instead of quietly answering with something else.
 */
export function parseTaskPage(query: TaskPageQuery): TaskPageResult {
  const limit = pageNumber(query.limit, TASK_PAGE_SIZE, 1, TASK_MAX_LIMIT);
  const offset = pageNumber(query.offset, 0, 0, TASK_MAX_OFFSET);
  if (limit === null || offset === null) return { ok: false, error: "invalid_query" };
  let expertSlug: string | null = null;
  if (query.expertSlug !== undefined && query.expertSlug !== null) {
    if (typeof query.expertSlug !== "string") return { ok: false, error: "invalid_query" };
    const trimmed = query.expertSlug.trim();
    if (trimmed) {
      if (!SLUG.test(trimmed)) return { ok: false, error: "invalid_query" };
      expertSlug = trimmed;
    }
  }
  let states: TaskState[] = [];
  if (query.state !== undefined && query.state !== null) {
    if (typeof query.state !== "string") return { ok: false, error: "invalid_state" };
    // The filter may name one state or several (`state=running,queued`): a page reads the states
    // the reader grouped together.
    const asked = query.state.split(",").map(token => token.trim()).filter(Boolean);
    for (const token of asked) {
      if (!TASK_STATES.includes(token as TaskState)) return { ok: false, error: "invalid_state" };
    }
    states = asked as TaskState[];
  }
  return { ok: true, page: { limit, offset, expertSlug, states } };
}

/** The page the list answers with: the rows it read, and whether more history follows. */
export function taskPagination(limit: number, offset: number, rowCount: number) {
  const hasMore = rowCount > limit;
  return { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null };
}
