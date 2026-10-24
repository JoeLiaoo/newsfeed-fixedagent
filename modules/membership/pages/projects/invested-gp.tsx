import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { createGpProjectsLoader, initialGpProjectsState } from "./invested-gp-state.ts";

export const handle: Screen = { tab: "me", name: "已投GP直投项目" };
export const meta = () => pageMeta({ title: "已投GP直投项目", path: "/projects/invested-gp", noindex: true });

function displayDate(value: string | null) {
  if (!value) return "日期未知";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export default function InvestedGpProjectsPage() {
  const [searchParams] = useSearchParams();
  const matched = searchParams.get("matched") === "1";
  const [{items,interestTags,nextOffset,loading,loadingMore,message,retry},setPage] = useState(initialGpProjectsState);
  const [loader] = useState(() => createGpProjectsLoader(setPage, () => { location.href = "/login"; }));
  useEffect(() => {
    void loader.load(matched, 0);
    return () => loader.cancel();
  }, [loader, matched]);

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{matched ? "与我关注匹配" : "已投GP直投项目"}</h1>
      <nav aria-label="GP 项目筛选" className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant={matched ? "outline" : "default"}><Link to="/projects/invested-gp">全部已核实</Link></Button>
        <Button asChild variant={matched ? "default" : "outline"}><Link to="/projects/invested-gp?matched=1">与我关注匹配</Link></Button>
      </nav>
    </header>

    {message && <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3" role="alert">
      <span>{message}</span><Button variant="outline" onClick={() => void loader.load(matched, retry.offset, retry.append)}>重试</Button>
    </Alert>}

    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载项目…</p>
        : matched && !interestTags.length && !message
          ? <Card className="px-6 py-10">
            <p className="font-medium text-ink">还没有选择关注赛道</p>
            <p className="mt-2 text-sm text-ink-3">选择关注赛道后，这里会显示与之匹配的已核实投资。</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/settings/interests">设置关注赛道</Link></Button>
          </Card>
        : items.length
        ? <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map(item => <li key={item.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold text-ink">{item.investee_name}</p>
                  <p className="mt-1 break-words text-sm text-ink-3">{item.gp_name}</p>
                </div>
                <div><Badge variant="success">已核实</Badge></div>
                <div className="flex flex-wrap gap-2">
                  {item.sector_tags.length
                    ? item.sector_tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)
                    : <span className="text-sm text-ink-3">暂无赛道标签</span>}
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm text-ink-3">
                  <span className="inline-flex items-center gap-1.5" aria-label={`投资日期：${displayDate(item.event_date)}`}>
                    <CalendarDays size={15} aria-hidden="true" />{displayDate(item.event_date)}
                  </span>
                  {item.source_url && <a className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={item.source_url} target="_blank" rel="noreferrer">
                    核对来源<ExternalLink size={14} aria-hidden="true" />
                  </a>}
                </div>
              </Card>
            </li>)}
          </ul>
          {nextOffset !== null && <div className="mt-6 flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loader.load(matched, nextOffset, true)}>
              {loadingMore ? "正在加载…" : "加载更多"}
            </Button>
          </div>}
        </>
        : message ? null : <Card className="px-6 py-12 text-center">
          <p className="font-medium text-ink">{matched ? "暂无匹配的已核实投资" : "暂无已核实的直投项目"}</p>
          <p className="mt-2 text-sm text-ink-3">{matched ? "后续审核通过且赛道标签与关注重合的投资会显示在这里。" : "经审核并处于有效状态的项目会显示在这里。"}</p>
        </Card>}
  </main>;
}
