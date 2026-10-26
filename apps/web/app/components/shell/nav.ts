// Site navigation in one place: the desktop sidebar's engine and module groups, and the phone's four tabs.
import type { ReactNode } from "react";
import { NAV, subjectAfter, withSubject } from "@aihot/site";
import { BriefcaseBusiness, Building2, FolderKanban, FolderTree, Landmark, Library, Newspaper } from "lucide-react";
import { webModules } from "../../site-modules";
import { IconBolt, IconBookmark, IconDoc, IconFlame, IconGrid, IconList, IconUser } from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
}

/** A group of the sidebar: a title with an icon, either a page of its own or a list of children. */
export interface NavGroup {
  /** The group's id: a module fills the group the engine declares (WebModule.sidebar). */
  id: string;
  title: string;
  icon: (p: { size?: number }) => ReactNode;
  /** The page the group leads to when it has no children. */
  to?: string;
  /** The group's children, in the order they are shown. */
  items?: NavItem[];
}

/** The site's groups, in the order the sidebar shows them. */
const GROUPS: NavGroup[] = [
  {
    id: "news",
    title: "资讯平台",
    icon: Newspaper,
    items: [
      { to: "/", label: "精选", icon: IconBolt, end: true },
      { to: "/all", label: subjectAfter("全部", "动态"), icon: IconList },
      { to: "/hot", label: "热点榜", icon: IconFlame },
      { to: "/daily", label: withSubject("日报"), icon: IconDoc },
      { to: "/topics", label: "主题", icon: IconGrid },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  { id: "experts", title: "专家平台", icon: BriefcaseBusiness },
  {
    id: "projects",
    title: "项目信息",
    icon: FolderKanban,
    items: [
      { to: "/projects/invested-gp", label: "已投GP直投项目", icon: FolderTree },
      { to: "/projects/citic-alliance", label: "中信股权联盟直投项目", icon: Landmark },
      { to: "/projects/market-leaders", label: "市场头部机构直投项目", icon: Building2 },
    ],
  },
  { id: "knowledge", title: "知识库", icon: Library },
];

/** Whether an engine page is a way in from the navigation (site.ts NAV.hidden); a hidden page still opens. */
export const inNav = (to: string) => !(NAV.hidden as readonly string[]).includes(to);

const UP = {
  "/hot": { name: "热点榜", back: "热点", tab: "featured" },
  "/topics": { name: "主题", back: "全部主题", tab: "me" },
} as const;

/**
 * Where pages under a navigation entry lead back up to: the entry, or 精选 in its place while the site hides
 * it. `name` is for breadcrumbs and desktop back links (热点榜), `back` for the phone bar (热点), `tab` the
 * phone tab it sits under, `crumbs` its breadcrumb after the site's home.
 */
export function navUp(entry: keyof typeof UP): { to: string; name: string; back: string; tab: TabKey; crumbs: Array<{ name: string; path: string }> } {
  if (!inNav(entry)) return { to: "/", name: "精选", back: "精选", tab: "featured", crumbs: [] };
  return { to: entry, ...UP[entry], crumbs: [{ name: UP[entry].name, path: entry }] };
}

/**
 * The sidebar's groups: the engine's, with the modules' entries in the group each of them names. A module
 * fills a group by its id: with children (the group's list) or with the page the group leads to.
 */
export function sidebar(): NavGroup[] {
  const groups: NavGroup[] = GROUPS.map((group) => ({
    ...group,
    items: group.items?.filter((item) => inNav(item.to)),
  }));
  for (const module of webModules()) {
    for (const entry of module.sidebar ?? []) {
      const group = groups.find((g) => g.id === entry.group);
      if (!group) continue;
      if (entry.items?.length) group.items = [...(group.items ?? []), ...entry.items.filter((item) => inNav(item.to))];
      if (entry.link) group.to = entry.link.to;
    }
  }
  return groups.filter((group) => group.to || group.items?.length);
}

// Which entry is lit and how a group opens and closes live in nav-state.ts, beside the two places that
// draw the groups; they are re-exported here so the navigation keeps one entry point.
export { sidebarIsActive } from "./nav-state";

/**
 * The phone tab bar has four fixed destinations. 全部, 热点 and 日报 remain available under 资讯;
 * "我的" at /more holds account pages and the other navigation entries. Each page declares its tab
 * in its route handle (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "knowledge"
  | "experts"
  | "me";

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "精选", icon: IconBolt },
  { key: "knowledge", to: "/knowledge", label: "知识库", icon: Library },
  { key: "experts", to: "/experts", label: "专家平台", icon: BriefcaseBusiness },
  { key: "me", to: "/more", label: "我的", icon: IconUser, changelog: true },
];

/** The phone tab bar's four destinations. */
export function tabs(): Tab[] {
  return ENGINE_TABS;
}
