import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { allianceInstitutionOptions } from "../../gp/alliance.ts";
import { createGpProjectsLoader, initialGpProjectsState } from "./invested-gp-state.ts";
import { projectCardFundLine, projectQueryFilters, type ProjectCollection } from "./project-collection.ts";

export type { ProjectCollection } from "./project-collection.ts";

type Filters = { motherFund: string; subfund: string; sector: string; province: string };

function displayDate(value: string | null) {
  if (!value) return "日期未知";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export function ProjectList({collection}:{collection:ProjectCollection}) {
  const [searchParams,setSearchParams] = useSearchParams();
  const filters = projectQueryFilters(collection, searchParams);
  const filterKey=JSON.stringify(filters);
  const [{items,filterOptions,nextOffset,loading,loadingMore,message,retry},setPage] = useState(initialGpProjectsState);
  const [loader] = useState(() => createGpProjectsLoader(setPage, () => { location.href = "/login"; },collection.group));
  useEffect(() => {
    void loader.load(0, false, filters);
    return () => loader.cancel();
  }, [loader, filterKey]);
  function changeFilter(name:keyof Filters,value:string){
    const next=new URLSearchParams(searchParams);
    next.delete("matched");
    if (collection.institutions) next.delete("subfund");
    if(value)next.set(name,value);else next.delete(name);
    next.delete("offset");setSearchParams(next);
  }
  const motherOptions = collection.institutions ? allianceInstitutionOptions(filterOptions.mother_funds) : filterOptions.mother_funds;
  const motherLabel = collection.institutions?.label ?? "母基金";
  const motherAll = collection.institutions?.allLabel ?? "全部母基金";

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{collection.title}</h1>
      <div className={collection.institutions ? "mt-4 grid gap-3 sm:grid-cols-3" : "mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"} aria-label="已投项目筛选条件">
        <label className="grid gap-1 text-sm">{motherLabel}<select value={filters.motherFund} onChange={event=>changeFilter("motherFund",event.target.value)} className="min-h-11 rounded-control border border-line bg-surface px-3 text-base text-ink sm:text-sm"><option value="">{motherAll}</option>{motherOptions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        {collection.institutions ? null : <label className="grid gap-1 text-sm">子基金<select value={filters.subfund} onChange={event=>changeFilter("subfund",event.target.value)} className="min-h-11 rounded-control border border-line bg-surface px-3 text-base text-ink sm:text-sm"><option value="">全部子基金</option>{filterOptions.subfunds.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
        <label className="grid gap-1 text-sm">赛道<select value={filters.sector} onChange={event=>changeFilter("sector",event.target.value)} className="min-h-11 rounded-control border border-line bg-surface px-3 text-base text-ink sm:text-sm"><option value="">全部赛道</option>{filterOptions.sectors.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <label className="grid gap-1 text-sm">项目区域（省）<select value={filters.province} onChange={event=>changeFilter("province",event.target.value)} className="min-h-11 rounded-control border border-line bg-surface px-3 text-base text-ink sm:text-sm"><option value="">全部省份</option>{filterOptions.provinces.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      </div>
    </header>

    {message && <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3" role="alert">
      <span>{message}</span><Button variant="outline" onClick={() => void loader.load(retry.offset, retry.append, filters)}>重试</Button>
    </Alert>}

    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载项目…</p>
        : items.length
        ? <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map(item => <li key={item.id}>
              <Card className="relative flex h-full flex-col gap-3 p-5 hover:border-accent/50 focus-within:border-accent">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold text-ink"><Link className="rounded-control text-accent underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" to={`${collection.path}/${encodeURIComponent(item.id)}`}>{item.investee_name}</Link></p>
                  <p className="mt-1 break-words text-sm text-ink-3">{item.gp_name}</p>
                  <p className="mt-1 break-words text-xs text-ink-3">{projectCardFundLine(collection, item)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.sector_tags.length
                    ? item.sector_tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)
                    : <span className="text-sm text-ink-3">暂无赛道标签</span>}
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm text-ink-3">
                  <span className="inline-flex items-center gap-1.5" aria-label={`投资日期：${displayDate(item.event_date)}`}>
                    <CalendarDays size={15} aria-hidden="true" />{displayDate(item.event_date)}
                  </span>
                  {item.source_url && <a className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-control text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={item.source_url} target="_blank" rel="noreferrer">
                    核对来源<ExternalLink size={14} aria-hidden="true" />
                  </a>}
                  {item.source_placeholder && <span className="text-xs text-ink-3">演示/导入占位 · 无可核对来源</span>}
                  {!item.source_url && !item.source_placeholder && <span className="text-xs text-ink-3">来源待补充</span>}
                </div>
              </Card>
            </li>)}
          </ul>
          {nextOffset !== null && <div className="mt-6 flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loader.load(nextOffset, true, filters)}>
              {loadingMore ? "正在加载…" : "加载更多"}
            </Button>
          </div>}
        </>
        : message ? null : <Card className="px-6 py-12 text-center">
          <p className="font-medium text-ink">{Object.values(filters).some(Boolean) ? "没有符合筛选条件的项目" : "暂无已核实的直投项目"}</p>
          <p className="mt-2 text-sm text-ink-3">{Object.values(filters).some(Boolean) ? "可调整或清除筛选条件后重试。" : "经审核并处于有效状态的项目会显示在这里。"}</p>
          {Object.values(filters).some(Boolean)&&<Button variant="outline" className="mt-4" onClick={()=>setSearchParams({})}>清除筛选</Button>}
        </Card>}
  </main>;
}
