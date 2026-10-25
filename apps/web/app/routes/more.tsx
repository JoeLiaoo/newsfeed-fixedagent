import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { Settings2 } from "lucide-react";
import { POLICY, SITE } from "@aihot/site";
import type { loader as rootLoader } from "../root";
import { useChangelogDot } from "../components/shell/Sidebar";
import { PhoneBar } from "../components/shell/PhoneBar";
import { sidebar } from "../components/shell/nav";
import { NavList } from "../components/shell/NavGroups";
import type { Screen } from "../components/shell/screens";
import { edgeTtl } from "../lib/api.server";
import { webModules } from "../site-modules";
import { pageMeta } from "../lib/seo";
import { setFontPreference, useFontPreference } from "../lib/local-state";
import { Select } from "../components/ui/Controls";
import { ThemeSwitch } from "../components/shell/ThemeSwitch";
import { Filings } from "../components/shell/Filings";
import { IconChevronRight, IconHeart, IconMessage, IconMoon, IconPlug, IconSparkles } from "../components/icons";

export const handle: Screen = { tab: "me", name: "我的" };

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: "我的", path: "/more", noindex: true });
}

/**
 * "我的", the phone's last tab (the address stays /more): the site's groups first, so every entry
 * is one tap away on a narrow screen, then this browser's account pages, the tools and the site's own pages.
 */
type Row = { to: string; label: string; icon: ReactNode; detail?: ReactNode };

/** The ways in that the agent page offers, the modules' first; its row names the first three. */
const agentWays = () => [...webModules().flatMap((m) => m.agentWays ?? []), "MCP", "RSS", "API"];

/** The modules' tools first, then the engine's. */
const tools = (): Row[] => [
  ...webModules().flatMap((m) => m.tools ?? []),
  { to: "/agent", label: "Agent 接入", icon: <IconPlug size={20} />, detail: agentWays().slice(0, 3).join(" · ") },
];

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="px-4 pb-2 pt-6 text-[13px] font-semibold text-ink-3">{title}</h2>}
      <ul className="card divide-y divide-line-soft overflow-hidden">{children}</ul>
    </section>
  );
}

function RowLink({ row, dot = false }: { row: Row; dot?: boolean }) {
  return (
    <li>
      <Link viewTransition to={row.to} className="flex min-h-[52px] items-center gap-3 px-4 text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk lg:hover:bg-bg-sunk">
        <span className="text-ink-3">{row.icon}</span>
        <span className="flex flex-1 items-center gap-2">
          {row.label}
          {dot && <span className="size-[7px] rounded-full bg-hot" aria-label="有新的更新" />}
        </span>
        {row.detail && <span className="text-[14px] font-normal text-ink-4">{row.detail}</span>}
        <IconChevronRight size={16} className="text-ink-4" />
      </Link>
    </li>
  );
}

export default function MorePage() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const [member, setMember] = useState<{ realName: string; username: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/membership/me", { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { location.href = "/login"; return; }
        if (!response.ok) return;
        const result = await response.json() as { user: { realName: string; username: string } };
        setMember(result.user);
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const changelogDot = useChangelogDot(root?.changelogVersion ?? null);
  const font = useFontPreference();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title="我的" large />
      <h1 className="hidden pb-4 pt-1 text-[22px] font-bold text-ink lg:block">我的</h1>
      {member && <p className="px-4 text-sm text-ink-3"><span className="font-medium text-ink">{member.realName}</span> · @{member.username}</p>}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4 2xl:grid-cols-3">
        <section>
          <h2 className="px-4 pb-2 pt-6 text-[13px] font-semibold text-ink-3">导航</h2>
          <div className="card overflow-hidden">
            <NavList groups={sidebar()} />
          </div>
        </section>
        <Group>
          <RowLink row={{ to: "/settings/profile", label: "个人设置", icon: <Settings2 size={20} /> }} />
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="text-ink-3">
              <IconMoon size={20} />
            </span>
            <span className="flex-1">外观</span>
            <ThemeSwitch className="w-[126px]" />
          </li>
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="w-5 text-center text-ink-3" aria-hidden="true">Aa</span>
            <span className="flex-1">字体</span>
            <Select aria-label="字体" value={font ?? "system"} onChange={(e) => setFontPreference(e.target.value === "browser" ? "browser" : null)}>
              <option value="system">默认字体</option>
              <option value="browser">浏览器默认字体</option>
            </Select>
          </li>
        </Group>
        <Group title="工具与入口">
          {tools().map((r) => (
            <RowLink key={r.to} row={r} />
          ))}
        </Group>
        <Group title="关于">
          <RowLink row={{ to: "/about", label: `关于 ${SITE.name}`, icon: <IconHeart size={20} /> }} />
          <RowLink row={{ to: "/changelog", label: "更新日志", icon: <IconSparkles size={20} /> }} dot={changelogDot} />
          <RowLink row={{ to: "/feedback", label: "意见反馈", icon: <IconMessage size={20} /> }} />
        </Group>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] leading-[2] text-ink-4">
        <Link viewTransition to="/terms" className="hover:text-ink-2">{POLICY.terms.name}</Link>
        <Link viewTransition to="/privacy" className="hover:text-ink-2">隐私说明</Link>
        <a href="/feed.xml" className="hover:text-ink-2">RSS</a>
        {SITE.github && <a href={SITE.github} target="_blank" rel="noopener noreferrer" className="hover:text-ink-2">GitHub 开源</a>}
        <Filings className="hover:text-ink-2" badgeSize={13} />
      </div>
    </div>
  );
}
