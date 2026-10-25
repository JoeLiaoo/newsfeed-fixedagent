import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { fakeApi, startWebServer, visit, type WebServer } from "./web-server.ts";

let taskPosts = 0;
let releaseDocument: () => void = () => {};
let releaseTarget: () => void = () => {};
const documentGate = new Promise<void>(resolve => { releaseDocument = resolve; });
const targetGate = new Promise<void>(resolve => { releaseTarget = resolve; });
const investment = { id: "verified-fixture", gp_name: "核实 GP", investee_name: "已核实企业", sector_tags: ["光伏"], event_date: "2026-10-20", status: "verified", source_url: null, source_placeholder: false };

const api = fakeApi(async (url, _res, req) => {
  const path = url.pathname;
  if (path === "/api/v1/membership/me") return { user: { username: "fixture-user", realName: "测试员工", role: "member" }, tags: ["光伏"], catalog: ["光伏"] };
  if (path === "/api/v1/membership/knowledge/bases") return { bases: [] };
  if (path === "/api/v1/membership/knowledge/bases/kb-not-real" || (url.searchParams.get("baseId") === "kb-not-real" && path.startsWith("/api/v1/membership/knowledge/"))) { _res.statusCode = 404; return { error: "knowledge_base_not_found" }; }
  if (path === "/api/v1/membership/knowledge/documents/doc-body") return { document: { id: "doc-body", title: "正文材料", status: "active", baseId: "base-fixture", createdAt: "2026-10-22T00:00:00Z" }, versions: [{ id: "version-body", versionNo: 1, fileName: "note.md", format: "markdown", byteSize: 48, sha256: "abc", bodyMd: "# 材料标题\n\n这段原文应在材料详情中可读。", extractionStatus: "available", createdAt: "2026-10-22T00:00:00Z", uploaderName: "测试员工", taskState: "succeeded" }] };
  if (path === "/api/v1/membership/knowledge/pages/related-fixture") return { page: { id: "related-fixture", slug: "related-fixture", pageType: "view", targetName: "关联测试", status: "published", baseId: "kb-abc", revision: 1, bodyMd: "## Related Pages\n\n- [kb-abc-chai-discovery](/knowledge/targets/kb-abc-chai-discovery)", updatedAt: "2026-10-22T00:00:00Z", freshness: "fresh", freshnessLabel: "新近", coverage: { analysts: 0, firms: 0, reports: 0, first_report: null, last_report: null } }, citations: [{ label: "S1", versionId: "v1", fileName: "note.md", format: "markdown", documentId: "doc-body", documentTitle: "正文材料" }], issues: [], related: [{ slug: "kb-abc-chai-discovery", localSlug: "chai-discovery", targetName: "AI 药物发现" }] };
  if (path === "/api/v1/membership/digest/history") return { digests: [
    { date: "2026-10-22", preferenceVersion: 2, itemCount: 4 },
    { date: "2026-10-22", preferenceVersion: 1, itemCount: 3 },
  ] };
  if (path === "/api/v1/membership/digest") return { date: "2026-10-22", preferenceVersion: 2, window: { start: "2026-10-21T16:00:00Z", cutoff: "2026-10-22T16:00:00Z" }, items: [] };
  if (path === "/api/v1/membership/experts") return { experts: [{ slug: "outbound-investment-panorama", name: "对外投资全景图", description: "逐层核查", version: "1", status: "available", execution_mode: "xinhua_panorama", missing_dependencies: [] }] };
  if (path === "/api/v1/membership/expert-tasks") {
    if (req.method === "POST") taskPosts++;
    return { tasks: [] };
  }
  if (path === "/api/v1/membership/gp-projects") return { investments: [investment], pagination: { nextOffset: null } };
  if (path === `/api/v1/membership/gp-projects/${investment.id}`) return { investment };
  if (path === "/api/v1/membership/knowledge/documents/doc-fixture") {
    await documentGate;
    return { document: { id: "doc-fixture", title: "测试材料", status: "active", baseId: "base-fixture", createdAt: "2026-10-22T00:00:00Z" }, versions: [] };
  }
  if (path === "/api/v1/membership/knowledge/pages/page-fixture") {
    await targetGate;
    return { page: { id: "page-fixture", slug: "page-fixture", pageType: "view", targetName: "测试知识页", status: "published", baseId: "base-fixture", revision: 1, bodyMd: "正文", updatedAt: "2026-10-22T00:00:00Z", freshness: "fresh", freshnessLabel: "新近", coverage: null }, citations: [], issues: [] };
  }
  return undefined;
});

let web: WebServer;
let browser: Browser;
before(async () => { web = await startWebServer(api); browser = await chromium.launch({ channel: "chrome" }); });
after(async () => { releaseDocument(); releaseTarget(); await browser?.close(); await web?.stop(); });

test("employee smoke UI shows one history day, current identity, GP detail and panorama empty-name error", async () => {
  const page = await browser.newPage();
  try {
    await visit(page, web.origin + "/");
    await expect(page.getByRole("navigation", { name: "日报历史" }).getByRole("link")).toHaveCount(1);
    await visit(page, web.origin + "/more");
    await expect(page.getByRole("region", { name: "当前登录账号" })).toContainText("测试员工");
    await expect(page.getByRole("region", { name: "当前登录账号" })).toContainText("@fixture-user");
    await visit(page, web.origin + "/projects/invested-gp");
    await page.getByRole("link", { name: "已核实企业" }).click();
    await expect(page).toHaveURL(/\/projects\/invested-gp\/verified-fixture$/);
    await expect(page.getByRole("heading", { name: "已核实企业" })).toBeVisible();
    await visit(page, web.origin + "/experts/outbound-investment-panorama");
    await expect(page.getByLabel("目标企业名称")).toBeVisible();
    await page.getByRole("button", { name: "提交任务" }).click();
    await expect(page.locator("#company-name-error")).toHaveText("请填写至少 2 个字的目标企业名称。");
    assert.equal(taskPosts, 0);
  } finally { await page.close(); }
});

test("more renders the current identity from its server loader even when browser API fetches fail", async () => {
  const page = await browser.newPage();
  try {
    let browserMeRequests = 0;
    await page.route("**/api/v1/membership/me", route => { browserMeRequests++; return route.abort(); });
    const response = await page.goto(web.origin + "/more");
    assert.equal(response?.status(), 200);
    await expect(page.getByRole("region", { name: "当前登录账号" })).toContainText("测试员工");
    await expect(page.getByRole("region", { name: "当前登录账号" })).toContainText("@fixture-user");
    assert.equal(browserMeRequests, 0);
    assert.match(response?.headers()["cache-control"] ?? "", /private, no-store/);
  } finally { await page.close(); }
});

test("knowledge document and page show a loading status until their reads finish", async () => {
  const page = await browser.newPage();
  try {
    await visit(page, web.origin + "/knowledge/documents/doc-fixture");
    await expect(page.getByRole("status", { name: "正在加载材料…" })).toBeVisible();
    await expect(page.getByRole("status", { name: "正在加载材料…" }).locator('[class*="animate-pulse"]')).toBeVisible();
    releaseDocument();
    await expect(page.getByRole("heading", { name: "测试材料" })).toBeVisible();
    await visit(page, web.origin + "/knowledge/targets/page-fixture");
    await expect(page.getByRole("status", { name: "正在加载知识页…" })).toBeVisible();
    await expect(page.getByRole("status", { name: "正在加载知识页…" }).locator('[class*="animate-pulse"]')).toBeVisible();
    releaseTarget();
    await expect(page.getByRole("heading", { name: "测试知识页" })).toBeVisible();
  } finally { releaseDocument(); releaseTarget(); await page.close(); }
});

test("bare knowledge detail paths return to the existing knowledge list", async () => {
  const page = await browser.newPage();
  try {
    for (const path of ["/knowledge/documents", "/knowledge/targets"]) {
      await visit(page, web.origin + path);
      await expect(page).toHaveURL(web.origin + "/knowledge");
      await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();
    }
  } finally { await page.close(); }
});

test("published markdown material renders its body after loading", async () => {
  const page = await browser.newPage();
  try {
    await visit(page, web.origin + "/knowledge/documents/doc-body");
    await expect(page.getByRole("heading", { name: "正文材料" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "材料标题" })).toBeVisible();
    await expect(page.getByRole("region", { name: "版本 1 正文" })).toContainText("这段原文应在材料详情中可读。");
    await expect(page.getByRole("link", { name: "下载原件" })).toBeVisible();
  } finally { await page.close(); }
});

test("unknown base remains in knowledge and offers a return link", async () => {
  const page = await browser.newPage();
  try {
    await visit(page, web.origin + "/knowledge/bases/kb-not-real");
    await expect(page).toHaveURL(web.origin + "/knowledge/bases/kb-not-real");
    await expect(page.getByRole("status")).toContainText("知识库不存在。");
    await expect(page.getByRole("link", { name: "返回知识库" })).toHaveAttribute("href", "/knowledge");
  } finally { await page.close(); }
});

test("target page resolves related title and counts its rendered source", async () => {
  const page = await browser.newPage();
  try {
    await visit(page, web.origin + "/knowledge/targets/related-fixture");
    await expect(page.getByRole("link", { name: "AI 药物发现" })).toHaveAttribute("href", "/knowledge/targets/kb-abc-chai-discovery");
    await expect(page.locator("main header")).toContainText("来源 1");
    await expect(page.getByText("[S1] 正文材料")).toBeVisible();
  } finally { await page.close(); }
});
