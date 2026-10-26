// Failure: a group that opened itself because it holds the page the reader is on could not be closed
// with the first press — the first press set it open again and only the second one closed it
// (2026-10-24). A press turns over what is on screen, the default the group opened by itself included.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { NavGroup } from "../app/components/shell/nav.ts";
import { groupOpen, groupToggled, sidebarIsActive } from "../app/components/shell/nav-state.ts";

const icon = () => null;
const group = (id: string, items: Array<{ to: string; end?: boolean }>): NavGroup => ({
  id,
  title: id,
  icon,
  items: items.map((item) => ({ ...item, label: item.to, icon })),
});
const news = group("news", [{ to: "/", end: true }, { to: "/all" }, { to: "/hot" }]);
const projects = group("projects", [{ to: "/projects/invested-gp" }, { to: "/projects/citic-alliance" }, { to: "/projects/market-leaders" }]);

test("both project detail routes retain their collection entry in navigation", () => {
  for (const slug of ["citic-alliance", "market-leaders"]) {
    const path = `/projects/${slug}/project-1`;
    assert.equal(groupOpen({}, projects, path), true);
    assert.equal(sidebarIsActive({ to: `/projects/${slug}` }, path), true);
  }
});

test("a group that opened itself closes with the first press and opens again with the next", () => {
  assert.equal(groupOpen({}, news, "/"), true, "the group holds the page the reader is on, so it opens by itself");
  let opened: Record<string, boolean> = {};
  opened = { ...opened, news: groupToggled(opened, news, "/") };
  assert.equal(opened.news, false, "the first press closes what is on screen");
  assert.equal(groupOpen(opened, news, "/"), false);
  opened = { ...opened, news: groupToggled(opened, news, "/") };
  assert.equal(opened.news, true, "the next press opens it again");
});

test("a deep link opens the group of its page, and the first press closes it", () => {
  assert.equal(groupOpen({}, projects, "/projects/invested-gp"), true);
  const opened = { projects: groupToggled({}, projects, "/projects/invested-gp") };
  assert.equal(opened.projects, false);
});

test("a group that does not hold the page opens with the first press and closes with the next", () => {
  assert.equal(groupOpen({}, projects, "/"), false);
  let opened: Record<string, boolean> = {};
  opened = { ...opened, projects: groupToggled(opened, projects, "/") };
  assert.equal(opened.projects, true);
  opened = { ...opened, projects: groupToggled(opened, projects, "/") };
  assert.equal(opened.projects, false);
});

test("the reader's own choice is kept, whatever the page", () => {
  const opened = { news: false };
  assert.equal(groupOpen(opened, news, "/"), false, "a group the reader closed stays closed");
  assert.equal(groupOpen(opened, news, "/all"), false);
  assert.equal(groupToggled(opened, news, "/all"), true, "the next press opens it again");
});

test("the desktop sidebar and the phone's 我的 page open and close the groups by one rule", () => {
  const source = readFileSync(new URL("../app/components/shell/NavGroups.tsx", import.meta.url), "utf8");
  const withoutImports = source.replace(/^import .*$/gm, "");
  assert.equal((withoutImports.match(/useState/g) ?? []).length, 1, "the groups' open state lives in one place");
  assert.match(source, /export function SidebarGroups[\s\S]*?useOpened\(pathname\)/);
  assert.match(source, /export function NavList[\s\S]*?useOpened\(pathname\)/);
  assert.equal((source.match(/toggle\(group\)/g) ?? []).length, 2, "both places turn over the group on screen");
});
