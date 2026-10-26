// How many employee source checks may run at once: one per employee, and at most four across the
// site. There is no hourly quota any more, so an employee who finished a check may start the next
// one straight away; only the running checks are counted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_CHECK_CONCURRENCY, sourceCheckMayStart } from "../sources.ts";

test("one employee runs one source check at a time", () => {
  const active = new Set<string>();
  assert.equal(sourceCheckMayStart(active, "employee-a"), true);
  active.add("employee-a");
  assert.equal(sourceCheckMayStart(active, "employee-a"), false, "a second check for the same employee waits");
  assert.equal(sourceCheckMayStart(active, "employee-b"), true, "another employee may check meanwhile");
});

test("at most four source checks run across the site at once", () => {
  const active = new Set<string>();
  for (let n = 0; n < SOURCE_CHECK_CONCURRENCY; n += 1) {
    assert.equal(sourceCheckMayStart(active, `employee-${n}`), true);
    active.add(`employee-${n}`);
  }
  assert.equal(active.size, 4);
  assert.equal(sourceCheckMayStart(active, "employee-4"), false, "the site is full");
});

test("a finished check frees its slot: the employee may check again without an hourly quota", () => {
  const active = new Set<string>();
  for (let round = 0; round < 10; round += 1) {
    assert.equal(sourceCheckMayStart(active, "employee-a"), true);
    active.add("employee-a");
    active.delete("employee-a");
  }
  assert.equal(active.size, 0);
});
