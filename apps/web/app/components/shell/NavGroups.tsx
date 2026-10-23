// The site's groups, drawn twice from one list: the desktop sidebar (compact rows) and the phone's 我的
// page (rows in a card). A group with children opens with a button, a group of its own is a link.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocation } from "react-router";
import { IntentLink } from "../ui/IntentLink";
import { sidebarIsActive, type NavGroup, type NavItem } from "./nav";

/**
 * A group holding the page the reader is on opens by itself, so a deep link shows its entry; what the
 * reader opens or closes after that is kept.
 */
function useOpened(pathname: string) {
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const isOpen = (group: NavGroup) => (group.id in opened ? opened[group.id] : group.items?.some((item) => sidebarIsActive(item, pathname)) ?? false);
  return { isOpen, toggle: (id: string) => setOpened((current) => ({ ...current, [id]: !current[id] })) };
}

/** The desktop sidebar's rows: a group with children opens them, a group of its own leads to its page. */
export function SidebarGroups({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();
  const { isOpen, toggle } = useOpened(pathname);
  return (
    <ul className="flex flex-col">
      {groups.map((group) => {
        const Icon = group.icon;
        const children = group.items ?? [];
        if (!children.length) {
          const on = group.to ? sidebarIsActive({ to: group.to }, pathname) : false;
          return (
            <li key={group.id} className="pt-2 first:pt-0">
              <IntentLink
                to={group.to ?? "/"}
                aria-current={on ? "page" : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] font-semibold text-ink transition-colors duration-150 ${
                  on ? "bg-accent/10" : "hover:bg-bg-sunk"
                }`}
              >
                <span className={`flex w-[22px] shrink-0 justify-center ${on ? "text-accent" : "text-ink-3"}`}>
                  <Icon size={17} />
                </span>
                <span className="min-w-0 truncate">{group.title}</span>
              </IntentLink>
            </li>
          );
        }
        const open = isOpen(group);
        const panelId = `nav-group-${group.id}`;
        return (
          <li key={group.id} className="pt-2 first:pt-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(group.id)}
              className="flex h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-[14px] font-semibold text-ink transition-colors duration-150 hover:bg-bg-sunk"
            >
              <span className="flex w-[22px] shrink-0 justify-center text-ink-3">
                <Icon size={17} />
              </span>
              <span className="min-w-0 truncate">{group.title}</span>
              <ChevronDown size={15} className={`ml-auto shrink-0 text-ink-4 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
            </button>
            <ul id={panelId} hidden={!open} className="mt-0.5 ml-[13px] border-l border-line-soft pl-2">
              {children.map((item) => (
                <li key={item.to}>
                  <SideChild item={item} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function SideChild({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const on = sidebarIsActive(item, pathname);
  return (
    <IntentLink
      to={item.to}
      aria-current={on ? "page" : undefined}
      className={`flex h-9 items-center rounded-control px-2.5 text-[13.5px] transition-colors duration-150 ${
        on ? "bg-accent/10 font-semibold text-ink dark:bg-accent-soft" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className="min-w-0 truncate">{item.label}</span>
    </IntentLink>
  );
}

/** The 我的 page's rows: the same groups, in a card, with the children under the group that holds them. */
export function NavList({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();
  const { isOpen, toggle } = useOpened(pathname);
  return (
    <ul className="divide-y divide-line-soft">
      {groups.map((group) => {
        const Icon = group.icon;
        const children = group.items ?? [];
        if (!children.length) {
          const on = group.to ? sidebarIsActive({ to: group.to }, pathname) : false;
          return (
            <li key={group.id}>
              <IntentLink
                to={group.to ?? "/"}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-[52px] items-center gap-3 px-4 text-[16px] transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk ${
                  on ? "font-semibold text-accent" : "font-medium text-ink"
                }`}
              >
                <span className={on ? "text-accent" : "text-ink-3"}>
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                <ChevronRight size={16} className="shrink-0 text-ink-4" />
              </IntentLink>
            </li>
          );
        }
        const open = isOpen(group);
        const panelId = `nav-list-${group.id}`;
        return (
          <li key={group.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(group.id)}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk"
            >
              <span className="text-ink-3">
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1 truncate">{group.title}</span>
              <ChevronRight size={16} className={`shrink-0 text-ink-4 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
            </button>
            <ul id={panelId} hidden={!open} className="border-t border-line-soft bg-bg-sunk/40">
              {children.map((item) => (
                <li key={item.to}>
                  <ListChild item={item} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function ListChild({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const on = sidebarIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <IntentLink
      to={item.to}
      aria-current={on ? "page" : undefined}
      className={`flex min-h-[48px] items-center gap-3 py-2 pl-4 pr-4 text-[15px] transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk ${
        on ? "font-semibold text-accent" : "font-medium text-ink-2"
      }`}
    >
      <span className="text-ink-4">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </IntentLink>
  );
}
