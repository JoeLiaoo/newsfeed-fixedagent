import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "me", name: "已投GP直投项目" };
export const meta = () => pageMeta({ title: "已投GP直投项目", path: "/projects/invested-gp", noindex: true });

type Investment = {
  id: string;
  gp_name: string;
  investee_name: string;
  sector_tags: string[];
  event_date: string | null;
  status: "verified";
  source_url: string | null;
};

type Page = { investments: Investment[]; pagination: { limit: number; offset: number; nextOffset: number | null } };
const PAGE_SIZE = 50;

function displayDate(value: string | null) {
  if (!value) return "日期未知";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export default function InvestedGpProjectsPage() {
  const [items, setItems] = useState<Investment[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<{ offset: number; append: boolean }>({ offset: 0, append: false });

  const load = useCallback(async (offset: number, append = false) => {
    setMessage("");
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/v1/membership/gp-projects?limit=${PAGE_SIZE}&offset=${offset}`);
      if (response.status === 401) { location.href = "/login"; return; }
      if (!response.ok) throw new Error("request_failed");
      const page = await response.json() as Page;
      setItems(current => append ? [...current, ...page.investments] : page.investments);
      setNextOffset(page.pagination.nextOffset);
      setRetry({ offset: 0, append: false });
    } catch {
      setMessage("项目列表暂时无法加载，请重试。");
      setRetry({ offset, append });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void load(0); }, [load]);

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">已投GP直投项目</h1>
    </header>

    {message && <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3" role="alert">
      <span>{message}</span><Button variant="outline" onClick={() => void load(retry.offset, retry.append)}>重试</Button>
    </Alert>}

    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载项目…</p>
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
                  {item.source_url && <a className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={item.source_url} target="_blank" rel="noreferrer">
                    核对来源<ExternalLink size={14} aria-hidden="true" />
                  </a>}
                </div>
              </Card>
            </li>)}
          </ul>
          {nextOffset !== null && <div className="mt-6 flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void load(nextOffset, true)}>
              {loadingMore ? "正在加载…" : "加载更多"}
            </Button>
          </div>}
        </>
        : message ? null : <Card className="px-6 py-12 text-center">
          <p className="font-medium text-ink">暂无已核实的直投项目</p>
          <p className="mt-2 text-sm text-ink-3">经审核并处于有效状态的项目会显示在这里。</p>
        </Card>}
  </main>;
}
