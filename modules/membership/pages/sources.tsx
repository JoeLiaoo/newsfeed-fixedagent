import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";

type Source = { id: string; name: string; kind: string; enabled: boolean; health: string; last_ok_at: string | null; discovery_scope: string | null; discovery_method: string | null; preview_count: number | null; items_7d: number };
type Coverage = { tag: string; count: number };

function scopeLabel(scope: string | null) {
  return scope === "sitemap" ? "sitemap" : scope === "rss" ? "RSS/Atom" : "单个列表页";
}

/** Each failed stage has its own message; anything else is a failed check. */
const ERROR_TEXT: Record<string, string> = {
  invalid_source: "请填写信源名称、公开地址和来源类型。",
  invalid_url: "地址格式无效，请填写完整的 http(s) 地址。",
  invalid_origin: "请求来源无效，请刷新页面后重试。",
  login_required: "请先登录后再添加信源。",
  duplicate_source: "这个信源已经添加。",
  source_preview_rate_limited: "来源检查次数或并发已达上限，请稍后再试。",
  source_unreachable: "无法访问该地址，请确认地址公开可访问。",
  source_timeout: "来源检查超时，请换一个响应更快的地址或稍后再试。",
  source_not_parseable: "该地址不是可解析的 RSS、文章列表或 sitemap。",
  source_no_articles: "该地址没有可解析的文章条目。",
  source_not_found: "该地址没有内容，请核对地址。",
  source_forbidden: "目标站点拒绝访问，请换一个公开可访问的地址。",
  source_rate_limited: "目标站点暂时限流，请稍后重试。",
  source_upstream_error: "目标站点返回错误，请稍后重试。",
  source_article_pages_failed: "列表页可解析，但原文页都无法读取，请换一个可公开读取的地址。",
  source_validation_failed: "来源检查失败，请稍后重试。",
};

function discoveryLabel(method: string | null) {
  return method === "robots_txt" ? "robots.txt" : method === "homepage_link" ? "首页链接" : method === "well_known" ? "常见地址探测" : method === "homepage_alternate" ? "RSS 自动发现" : "手动地址";
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeSources, setActiveSources] = useState(0);
  const [aboutSnapshotSources, setAboutSnapshotSources] = useState<number | null>(null);

  async function load() {
    const response = await fetch("/api/v1/membership/sources");
    if (!response.ok) { setLoaded(false); setMessage(response.status === 401 ? "请先登录后查看信源。" : "加载信源失败，请刷新重试。"); return; }
    const data = await response.json() as { sources?: Source[]; coverage?: Coverage[]; activeSources?: number };
    if (!Array.isArray(data.sources) || !Array.isArray(data.coverage) || typeof data.activeSources !== "number") throw new Error("invalid_sources_response");
    setSources(data.sources); setCoverage(data.coverage);
    setActiveSources(data.activeSources); setLoaded(true);
    if (!data.sources.length) {
      try {
        const snapshot = await fetch("/api/site/stats");
        const stats = await snapshot.json() as { sources?: number };
        setAboutSnapshotSources(snapshot.ok && typeof stats.sources === "number" ? stats.sources : null);
      } catch { setAboutSnapshotSources(null); }
    } else setAboutSnapshotSources(null);
  }

  useEffect(() => { void load().catch(() => { setLoaded(false); setMessage("加载信源失败，请刷新重试。"); }); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("正在检查公开内容和重复项…");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/v1/membership/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), sourceUrl: form.get("sourceUrl"), kind: form.get("kind") }) });
      const data = await response.json() as { error?: string; source?: { scope: string; previewCount: number; detailFailures?: number } };
      if (!response.ok) {
        setMessage(ERROR_TEXT[data.error ?? ""] ?? ERROR_TEXT.source_validation_failed!);
        return;
      }
      formElement.reset();
      const scope = data.source?.scope === "sitemap" ? "sitemap 索引" : data.source?.scope === "rss" ? "RSS/Atom 条目" : "提交的单个列表页";
      const unread = data.source?.detailFailures ?? 0;
      setMessage(`信源已加入共享采集池，预览发现 ${data.source?.previewCount ?? 0} 篇文章；实际采集范围：${scope}。${unread ? `其中 ${unread} 篇原文页未能读取。` : ""}`);
      await load();
    } catch { setMessage("信源检查请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-6xl px-5 py-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">资讯信源</h1><p className="mt-2 max-w-5xl text-sm leading-relaxed text-ink-3">RSS/Atom、sitemap 或文章列表页先经过公开地址、内容和重复检查。提交网站首页时会探测页面 RSS、robots.txt 和常见 sitemap 地址；若未发现，则只采集你提交的列表页。每位员工每小时最多检查 3 次，全站同时最多 4 次检查。系统只采集公开内容；下表持续显示实际采用的范围、首次预览数量和近 7 天收录量，不能据此保证覆盖全站。</p></header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    {loaded && !sources.length && aboutSnapshotSources !== null && aboutSnapshotSources > 0 && <Alert className="mb-5" role="alert">实时信源列表为空，但「关于」页最近快照显示 {aboutSnapshotSources} 个启用信源。两处数据不一致，请管理员核对 API 与数据库状态。</Alert>}
    <Card className="mb-6">
      <CardHeader><CardTitle>添加公开信源</CardTitle><CardDescription>新信源经检查后加入全员共享采集池。</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_2fr_1fr_auto] md:items-end">
        <div className="grid gap-2"><Label htmlFor="source-name">信源名称</Label><Input id="source-name" name="name" required minLength={2} maxLength={120} placeholder="例如：企业新闻" /></div>
        <div className="grid gap-2"><Label htmlFor="source-url">公开地址</Label><Input id="source-url" name="sourceUrl" type="url" required placeholder="RSS、网站首页、文章列表页或 sitemap.xml" /></div>
        <div className="grid gap-2"><Label htmlFor="source-kind">来源类型</Label><select id="source-kind" name="kind" className="flex h-10 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"><option value="rss">RSS / Atom</option><option value="web_list">网站首页或文章列表</option><option value="sitemap">网站 sitemap</option></select></div>
        <Button type="submit" disabled={busy}>{busy ? "检查中…" : "检查并添加"}</Button>
      </form></CardContent>
    </Card>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_2fr]">
      <Card>
        <CardHeader><CardTitle>赛道覆盖</CardTitle><CardDescription>近 7 天已发布的精选内容；资讯列表也可显示更早的内容。</CardDescription></CardHeader>
        <CardContent>{!loaded ? <p className="text-sm text-ink-3">正在读取共享数据…</p> : coverage.length ? <ul className="flex flex-wrap gap-2">{coverage.map(item => <li key={item.tag}><Badge variant="outline">{item.tag} · {item.count}</Badge></li>)}</ul> : <p className="text-sm text-ink-3">近 7 天暂无已发布的赛道内容。</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>共享信源健康情况</CardTitle><CardDescription>{loaded ? `全员共享 ${sources.length} 个信源，其中 ${activeSources} 个启用。` : "正在读取共享信源…"}数据反映实际采集范围。</CardDescription></CardHeader>
        <CardContent className="p-0 sm:px-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-y border-line bg-bg-sunk text-xs font-medium text-ink-3"><th scope="col" className="px-4 py-3 sm:first:pl-0">信源</th><th scope="col" className="px-3 py-3">实际范围</th><th scope="col" className="px-3 py-3">发现方式</th><th scope="col" className="px-3 py-3">初次预览</th><th scope="col" className="px-3 py-3">近 7 天</th><th scope="col" className="px-3 py-3">状态</th><th scope="col" className="px-3 py-3 sm:last:pr-0">最近成功</th></tr></thead>
              <tbody>{sources.map(source => <tr key={source.id} className="border-b border-line-soft last:border-0">
                <th scope="row" className="max-w-48 truncate px-4 py-3 font-medium sm:first:pl-0">{source.name}</th>
                <td className="px-3 py-3 text-ink-2">{scopeLabel(source.discovery_scope)}</td>
                <td className="px-3 py-3 text-ink-2">{discoveryLabel(source.discovery_method)}</td>
                <td className="px-3 py-3 text-ink-2">{source.preview_count ?? "—"}</td>
                <td className="px-3 py-3 text-ink-2">{source.items_7d}</td>
                <td className="px-3 py-3"><Badge variant={!source.enabled || source.health === "paused" ? "secondary" : source.health === "ok" ? "success" : source.health === "failing" ? "destructive" : "warning"}>{source.enabled ? source.health : "已停用"}</Badge></td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-3 sm:last:pr-0">{source.last_ok_at ? new Date(source.last_ok_at).toLocaleString("zh-CN") : "暂无成功记录"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {loaded && !sources.length && <p className="px-4 py-5 text-sm text-ink-3 sm:px-0">采集池中暂无共享信源。</p>}
        </CardContent>
      </Card>
    </div>
  </main>;
}
