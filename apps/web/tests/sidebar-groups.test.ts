// Failure: a group that opened itself because it holds the page the reader is on could not be closed
// with the first press — the first press set it open again and only the second one closed it
// (2026-10-24). A press turns over what is on screen: the desktop sidebar and the phone's 我的 page
// do the same, a group that is not on the page opens with the first press, and a closed group's
// children stay out of the keyboard's reach.
// The machine's Chrome is used (channel: "chrome"), so no browser download is needed to run this.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { FIXTURE_AT as at, fakeApi, startWebServer, visit, type WebServer } from "./web-server.ts";

const api = fakeApi((url) => {
  const path = url.pathname;
  if (path === "/api/site/topics") return { groups: [], topics: [] };
  // The web server asks the api who the reader is before it draws a page; the home page is the reader's digest.
  if (path === "/api/v1/membership/me") return { user: { username: "tester", realName: "测试", role: "member" }, tags: ["ai-models"], catalog: ["ai-models", "ai-products"] };
  if (path === "/api/v1/membership/digest/history") return { digests: [] };
  if (path === "/api/v1/membership/digest") return { date: "2026-10-04", preferenceVersion: 1, window: { start: "2026-10-03T16:00:00.000Z", cutoff: "2026-10-04T16:00:00.000Z" }, items: [] };
  if (path === "/api/v1/membership/knowledge/bases") return { bases: [] };
  if (path === "/api/v1/membership/experts") return { experts: [] };
  if (path === "/api/site/reports/daily/latest-page") return { index: [], report: null };
  if (path === "/api/site/hot") return { computedAt: at, windowHours: 48, entries: [] };
  if (path === "/api/site/timeline") return { filters: { channel: "all", category: null, tag: null }, cards: [], nextCursor: null, hot: null, dayCounts: {} };
  return undefined;
});
let web: WebServer;
let chrome: Browser;
before(async () => {
  web = await startWebServer(api);
  chrome = await chromium.launch({ channel: "chrome" });
});
after(async () => { await chrome?.close(); await web?.stop(); });

test("the desktop sidebar's group that opened itself closes with the first press and opens with the next", async () => {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await visit(page, web.origin + "/");
    const group = page.locator('button[aria-controls="nav-group-news"]');
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#nav-group-news")).toBeVisible();
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#nav-group-news")).toBeHidden();
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    // The keyboard turns the group over as well.
    await group.focus();
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press(" ");
    await expect(group).toHaveAttribute("aria-expanded", "true");
  } finally { await context.close(); }
});

test("a deep link opens the group of its page, and the first press closes it", async () => {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await visit(page, web.origin + "/projects/invested-gp");
    const group = page.locator('button[aria-controls="nav-group-projects"]');
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
  } finally { await context.close(); }
});

test("the phone's 我的 page opens and closes the groups by the same rule", async () => {
  const context = await chrome.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    const page = await context.newPage();
    await visit(page, web.origin + "/more");
    const group = page.locator('button[aria-controls="nav-list-news"]');
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#nav-list-news")).toBeVisible();
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    // A closed group's children are out of the keyboard's reach.
    const child = page.locator("#nav-list-news a").first();
    await child.evaluate((el) => (el as HTMLElement).focus());
    assert.equal(await child.evaluate((el) => el === document.activeElement), false, "a hidden child cannot be focused");
  } finally { await context.close(); }
});

test("phone tabs open knowledge and experts while desktop keeps its sidebar entries", async () => {
  const phone = await chrome.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const desktop = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await phone.newPage();
    await visit(page, web.origin + "/");
    const bar = page.getByRole("navigation", { name: "底部导航" });
    const links = bar.getByRole("link");
    await expect(links).toHaveText(["精选", "知识库", "专家平台", "我的"]);
    for (const [index, path] of ["/", "/knowledge", "/experts", "/more"].entries()) {
      await expect(links.nth(index)).toHaveAttribute("href", path);
    }
    await expect(links.nth(0)).toHaveAttribute("aria-current", "page");

    await links.nth(1).click();
    await expect(page).toHaveURL(web.origin + "/knowledge");
    await expect(links.nth(1)).toHaveAttribute("aria-current", "page");
    await links.nth(2).click();
    await expect(page).toHaveURL(web.origin + "/experts");
    await expect(links.nth(2)).toHaveAttribute("aria-current", "page");
    await links.nth(3).click();
    await expect(page).toHaveURL(web.origin + "/more");
    await expect(links.nth(3)).toHaveAttribute("aria-current", "page");

    await visit(page, web.origin + "/knowledge/bases/new");
    await expect(bar.getByRole("link", { name: "知识库" })).toHaveAttribute("aria-current", "page");
    await visit(page, web.origin + "/experts/new");
    await expect(bar.getByRole("link", { name: "专家平台" })).toHaveAttribute("aria-current", "page");
    for (const path of ["/hot", "/daily"]) {
      await visit(page, web.origin + path);
      await expect(bar.getByRole("link", { name: "精选" })).toHaveAttribute("aria-current", "page");
    }

    const widePage = await desktop.newPage();
    await visit(widePage, web.origin + "/");
    await expect(widePage.getByRole("navigation", { name: "底部导航" })).toBeHidden();
    const sidebar = widePage.getByRole("navigation", { name: "主导航" });
    await expect(sidebar.getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    await expect(sidebar.getByRole("link", { name: "专家平台" })).toHaveAttribute("href", "/experts");
    await expect(sidebar.getByRole("link", { name: "热点榜" })).toHaveAttribute("href", "/hot");
    await expect(sidebar.getByRole("link", { name: /日报/ })).toHaveAttribute("href", "/daily");
  } finally { await phone.close(); await desktop.close(); }
});
