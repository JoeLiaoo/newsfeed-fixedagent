import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeSource } from "../gp/source.ts";

test("employee GP links preserve real HTTPS provenance and hide demo URLs", () => {
  assert.deepEqual(employeeSource("https://publisher.example.cn/report/1"), { url: "https://publisher.example.cn/report/1", placeholder: false });
  assert.deepEqual(employeeSource("https://example.org/demo/gp-board-html/2026-10-24"), { url: null, placeholder: true });
  assert.deepEqual(employeeSource("https://www.example.org/demo"), { url: null, placeholder: true });
  assert.deepEqual(employeeSource(null), { url: null, placeholder: false });
  assert.deepEqual(employeeSource("http://untrusted.test/report"), { url: null, placeholder: false });
});
