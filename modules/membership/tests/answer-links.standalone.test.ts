import assert from "node:assert/strict";
import test from "node:test";
import { answerWithPageLinks } from "../pages/answer-links.ts";

test("answer page list links bare slugs without rewriting existing Markdown links", () => {
  const slug = "kb-example-company";
  const existing = `[原链接](/knowledge/targets/${slug})`;
  const answerMd = `正文 ${slug}\n\n本次参考的知识页列表\n- ${slug}\n- ${existing}\n免责声明。`;
  const result = answerWithPageLinks({ answerMd, citations: [{ pageSlug: slug, title: "公司[观点]" }] });
  assert.match(result, /- \[公司\\\[观点\\\]\]\(\/knowledge\/targets\/kb-example-company\)/);
  assert.match(result, /- \[原链接\]\(\/knowledge\/targets\/kb-example-company\)/);
  assert.match(result, /^正文 kb-example-company/m);
});
