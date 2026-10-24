import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskPage, taskPagination, TASK_MAX_LIMIT, TASK_MAX_OFFSET, TASK_PAGE_SIZE } from "../experts/task-query.ts";

test("a task page reads twenty records by default and clamps what the reader asked for", () => {
  const none = parseTaskPage({});
  assert.equal(none.ok, true);
  assert.deepEqual(none.ok ? none.page : null, { limit: TASK_PAGE_SIZE, offset: 0, expertSlug: null, states: [] });

  const asked = parseTaskPage({ limit: "5", offset: "40" });
  assert.deepEqual(asked.ok ? asked.page : null, { limit: 5, offset: 40, expertSlug: null, states: [] });

  const tooBig = parseTaskPage({ limit: "5000", offset: "999999" });
  assert.deepEqual(tooBig.ok ? tooBig.page : null, { limit: TASK_MAX_LIMIT, offset: TASK_MAX_OFFSET, expertSlug: null, states: [] });

  const tooSmall = parseTaskPage({ limit: "0", offset: "0" });
  assert.deepEqual(tooSmall.ok ? tooSmall.page : null, { limit: 1, offset: 0, expertSlug: null, states: [] });
});

test("a task page refuses what is not a page at all", () => {
  for (const query of [{ limit: "abc" }, { limit: "1.5" }, { limit: "-1" }, { limit: "" }, { offset: "x" }, { offset: "-5" }, { limit: 1 }, { offset: {} }, { expertSlug: 7 }, { expertSlug: "bad slug" }, { expertSlug: "a/b" }]) {
    const parsed = parseTaskPage(query as { limit?: unknown; offset?: unknown; expertSlug?: unknown });
    assert.equal(parsed.ok, false, JSON.stringify(query));
    assert.equal(parsed.ok ? null : parsed.error, "invalid_query", JSON.stringify(query));
  }
  const badState = parseTaskPage({ state: "unknown" });
  assert.equal(badState.ok, false);
  assert.equal(badState.ok ? null : badState.error, "invalid_state");
});

test("a task page reads one expert and the states the reader grouped", () => {
  const one = parseTaskPage({ expertSlug: "outbound-investment-panorama" });
  assert.equal(one.ok ? one.page.expertSlug : null, "outbound-investment-panorama");
  const blank = parseTaskPage({ expertSlug: "  " });
  assert.equal(blank.ok ? blank.page.expertSlug : null, null, "an empty expert name is no filter");
  const states = parseTaskPage({ state: "queued,running" });
  assert.deepEqual(states.ok ? states.page.states : null, ["queued", "running"]);
  const oneState = parseTaskPage({ state: "succeeded" });
  assert.deepEqual(oneState.ok ? oneState.page.states : null, ["succeeded"]);
});

test("a task page says whether more records follow", () => {
  assert.deepEqual(taskPagination(20, 0, 21), { limit: 20, offset: 0, hasMore: true, nextOffset: 20 });
  assert.deepEqual(taskPagination(20, 20, 20), { limit: 20, offset: 20, hasMore: false, nextOffset: null });
  assert.deepEqual(taskPagination(20, 0, 0), { limit: 20, offset: 0, hasMore: false, nextOffset: null });
});
