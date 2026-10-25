import assert from "node:assert/strict";
import { test } from "node:test";
import { expertTaskPagination, parseExpertTaskPage } from "../experts/task-page.ts";

test("employee task history accepts bounded pages and optional expert scope", () => {
  assert.deepEqual(parseExpertTaskPage({}), { limit: 20, offset: 0, expertSlug: null });
  assert.deepEqual(parseExpertTaskPage({ limit: "40", offset: "80", expertSlug: "outbound-investment-panorama" }), { limit: 40, offset: 80, expertSlug: "outbound-investment-panorama" });
  assert.equal(parseExpertTaskPage({ limit: "0" })?.limit, 1);
  assert.equal(parseExpertTaskPage({ limit: "999" })?.limit, 100);
  assert.equal(parseExpertTaskPage({ offset: "100001" })?.offset, 100000);
  assert.equal(parseExpertTaskPage({ offset: "1x" }), null);
  assert.equal(parseExpertTaskPage({ limit: ["20"] }), null);
  assert.equal(parseExpertTaskPage({ expertSlug: "bad slug" }), null);
});

test("employee task history reports a next page only when an extra row exists", () => {
  assert.deepEqual(expertTaskPagination(20, 40, 21), { limit: 20, offset: 40, hasMore: true, nextOffset: 60 });
  assert.deepEqual(expertTaskPagination(20, 40, 20), { limit: 20, offset: 40, hasMore: false, nextOffset: null });
});
