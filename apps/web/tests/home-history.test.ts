import assert from "node:assert/strict";
import { test } from "node:test";
import { oneDigestPerDay } from "../app/routes/home-history.ts";

test("home history shows one chip per Beijing calendar day, keeping newest preference version", () => {
  assert.deepEqual(oneDigestPerDay([
    { date: "2026-10-23", preferenceVersion: 2, itemCount: 3 },
    { date: "2026-10-22", preferenceVersion: 4, itemCount: 7 },
    { date: "2026-10-22", preferenceVersion: 3, itemCount: 5 },
    { date: "2026-10-21", preferenceVersion: 1, itemCount: 2 },
  ]), [
    { date: "2026-10-23", preferenceVersion: 2, itemCount: 3 },
    { date: "2026-10-22", preferenceVersion: 4, itemCount: 7 },
    { date: "2026-10-21", preferenceVersion: 1, itemCount: 2 },
  ]);
});
