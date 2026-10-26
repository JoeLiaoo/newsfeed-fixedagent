import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicArticle } from "../knowledge/fetch-url.ts";
import { extractSourceMetadata } from "../knowledge/metadata.ts";

test("public article extraction keeps published metadata and removes page chrome", () => {
  const article = parsePublicArticle(`<!doctype html><html><head>
    <title>页面标题</title><meta property="og:title" content="研究报告标题">
    <meta name="author" content="张三"><meta property="og:site_name" content="研究机构">
    <meta property="article:published_time" content="2026-10-25T10:30:00+08:00">
    </head><body><nav>导航文字不应入库</nav><main><article><h1>正文标题</h1><p>${"公开网页正文。".repeat(20)}</p><script>不可执行内容</script></article></main></body></html>`, "https://example.com/report");
  assert.equal(article.url, "https://example.com/report");
  assert.equal(article.title, "研究报告标题");
  assert.equal(article.author, "张三");
  assert.equal(article.organization, "研究机构");
  assert.equal(article.date, "2026-10-25");
  assert.match(article.text, /公开网页正文/);
  assert.doesNotMatch(article.text, /导航文字|不可执行内容/);
});

test("material metadata is extracted only from headings and explicit attribution labels", () => {
  assert.deepEqual(extractSourceMetadata(`# 某公司季度跟踪\n作者：李四\n研究机构：某证券\n报告日期：2026-10-24\n材料类型：研究报告`), {
    title: "某公司季度跟踪", author: "李四", organization: "某证券", date: "2026-10-24", kind: "研究报告",
  });
  assert.deepEqual(extractSourceMetadata("作者在文中提到公司，但没有来源信息。\n报告日期：2026-02-30"), {
    title: null, author: null, organization: null, date: null, kind: null,
  });
});

test("public article extraction keeps unknown dates unknown and rejects empty pages", () => {
  const html = `<html><head><meta name="date" content="2026-02-31"></head><body><article>${"正文。".repeat(30)}</article></body></html>`;
  assert.equal(parsePublicArticle(html, "https://example.com").date, null);
  assert.throws(() => parsePublicArticle("<html><body><nav>only chrome</nav></body></html>", "https://example.com"), /knowledge_url_extract_empty/);
});
