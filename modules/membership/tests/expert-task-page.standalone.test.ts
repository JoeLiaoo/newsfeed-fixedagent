// The employee task list reads one expert's history a page at a time: the page parameters are
// clamped, a query that is not a page is refused, and the answer says whether more history follows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPERT_TASK_MAX_LIMIT, EXPERT_TASK_MAX_OFFSET, EXPERT_TASK_PAGE_SIZE, expertTaskPagination, parseExpertTaskPage } from "../experts/task-page.ts";

test("a task page reads one expert's history with clamped parameters", () => {
  assert.deepEqual(parseExpertTaskPage({}), { limit: EXPERT_TASK_PAGE_SIZE, offset: 0, expertSlug: null });
  assert.deepEqual(parseExpertTaskPage({ expertSlug: "outbound-investment-panorama" }), { limit: EXPERT_TASK_PAGE_SIZE, offset: 0, expertSlug: "outbound-investment-panorama" });
  assert.deepEqual(parseExpertTaskPage({ limit: "5", offset: "10" }), { limit: 5, offset: 10, expertSlug: null });
  assert.deepEqual(parseExpertTaskPage({ limit: "0" }), { limit: 1, offset: 0, expertSlug: null }, "一页至少读一条");
  assert.deepEqual(parseExpertTaskPage({ limit: "500" }), { limit: EXPERT_TASK_MAX_LIMIT, offset: 0, expertSlug: null });
  assert.deepEqual(parseExpertTaskPage({ offset: "999999" }), { limit: EXPERT_TASK_PAGE_SIZE, offset: EXPERT_TASK_MAX_OFFSET, expertSlug: null });
  assert.deepEqual(parseExpertTaskPage({ expertSlug: "  " }), { limit: EXPERT_TASK_PAGE_SIZE, offset: 0, expertSlug: null }, "空 slug 表示不按专家过滤");
});

test("a query that is not a page is refused instead of read as the first page", () => {
  assert.equal(parseExpertTaskPage({ limit: "abc" }), null);
  assert.equal(parseExpertTaskPage({ limit: "-1" }), null);
  assert.equal(parseExpertTaskPage({ offset: "1.5" }), null);
  assert.equal(parseExpertTaskPage({ limit: ["1", "2"] }), null);
  assert.equal(parseExpertTaskPage({ expertSlug: "not a slug" }), null);
  assert.equal(parseExpertTaskPage({ expertSlug: "x".repeat(201) }), null);
});

test("the task page says whether more history follows", () => {
  assert.deepEqual(expertTaskPagination(20, 0, 21), { limit: 20, offset: 0, hasMore: true, nextOffset: 20 });
  assert.deepEqual(expertTaskPagination(20, 20, 3), { limit: 20, offset: 20, hasMore: false, nextOffset: null });
  assert.deepEqual(expertTaskPagination(20, 40, 0), { limit: 20, offset: 40, hasMore: false, nextOffset: null });
});
