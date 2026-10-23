// Which sidebar entry is lit, and how a group opens and closes: one rule for the desktop sidebar and
// the phone's 我的 page, so the same group opens and closes the same way in both.
import type { NavGroup, NavItem } from "./nav";

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: Pick<NavItem, "to" | "end">, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** Whether a group opens by itself: it holds the page the reader is on, so a deep link shows its entry. */
export function groupDefaultOpen(group: NavGroup, pathname: string): boolean {
  return group.items?.some((item) => sidebarIsActive(item, pathname)) ?? false;
}

/** The group's open state: the reader's own choice when there is one, otherwise the default. */
export function groupOpen(opened: Record<string, boolean>, group: NavGroup, pathname: string): boolean {
  return opened[group.id] ?? groupDefaultOpen(group, pathname);
}

/** The state after a toggle: the opposite of what is on screen, the default included. */
export function groupToggled(opened: Record<string, boolean>, group: NavGroup, pathname: string): boolean {
  return !groupOpen(opened, group, pathname);
}
