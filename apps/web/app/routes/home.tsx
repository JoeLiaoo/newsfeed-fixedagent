import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import { API_BASE_URL } from "../lib/api.server";
import type { Screen } from "../components/shell/screens";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { Button } from "../components/member-ui/button";
import { Settings2 } from "lucide-react";
import { oneDigestPerDay } from "./home-history.ts";

export const handle: Screen = { tab: "featured", name: "我的日报" };
type Digest = {
  date: string;
  preferenceVersion: number;
  window: { start: string; cutoff: string };
  items: Array<{ article_id: string; title: string; summary: string | null; url: string; tags: string[]; source_name: string; published_at: string | null; timeline_at: string }>;
};
type DigestHistory = { date: string; preferenceVersion: number; itemCount: number };
export async function loader({ request }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") ?? "";
  const headers = { cookie, accept: "application/json" };
  const me = await fetch(`${API_BASE_URL}/api/v1/membership/me`, { headers, cache: "no-store" });
  if (me.status === 401) throw redirect("/login");
  if (!me.ok) throw new Response("平台暂时不可用", { status: 503 });
  const profile = await me.json() as { tags: string[] };
  if (!profile.tags.length) throw redirect("/settings/interests");
  const requestedDate = new URL(request.url).searchParams.get("date");
  const digestPath = requestedDate ? `/api/v1/membership/digest?date=${encodeURIComponent(requestedDate)}` : "/api/v1/membership/digest";
  const response = await fetch(`${API_BASE_URL}${digestPath}`, { headers, cache: "no-store" });
  if (!response.ok) throw new Response("个人日报暂时不可用", { status: 503 });
  const [digest, historyResponse] = await Promise.all([
    response.json() as Promise<Digest>,
    fetch(`${API_BASE_URL}/api/v1/membership/digest/history`, { headers, cache: "no-store" }),
  ]);
  const history = historyResponse.ok ? (await historyResponse.json() as { digests: DigestHistory[] }).digests : [];
  return { digest, history: oneDigestPerDay(history) };
}
export function headers() { return { "Cache-Control": "private, no-store", Vary: "Cookie" }; }
export function meta() { return [{ title: "我的日报 · 中信私募ai平台" }]; }

export default function Home() {
  const { digest, history } = useLoaderData<typeof loader>();
  const today=beijingDate(new Date());
  const isToday=digest.date===today;
  const formatInstant=(value:string)=>`${beijingDate(value)} ${beijingTime(value)}`;
  return <main className="mx-auto max-w-4xl px-5 py-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-ink-muted">{digest.date}{isToday ? " · 当期快照" : " · 历史快照"}</p><h1 className="mt-1 text-2xl font-semibold">我的日报</h1></div><Button asChild><a href="/settings/profile"><Settings2 aria-hidden="true" />个人设置</a></Button></div><p className="mt-3 text-ink-muted">本期窗口：{formatInstant(digest.window.start)} 至 {formatInstant(digest.window.cutoff)}；关注版本 {digest.preferenceVersion}。快照生成后保持固定，按事件去重。</p>{history.length > 0 && <nav aria-label="日报历史" className="mt-4 flex flex-wrap gap-2">{history.map((entry) => <a key={`${entry.date}-${entry.preferenceVersion}`} href={entry.date===today?"/":`/?date=${entry.date}`} aria-current={entry.date === digest.date ? "date" : undefined} className="rounded-mark border px-3 py-1.5 text-sm">{entry.date} · {entry.itemCount}</a>)}</nav>}{digest.items.length === 0 ? <section className="mt-8 rounded-card border p-6"><h2 className="font-semibold">本期暂无匹配资讯</h2><p className="mt-2 text-ink-muted">共享资讯池没有找到与你本期关注方向匹配的已发布内容。</p><a href="/all" className="mt-3 inline-block text-red-700 underline">查看实时新闻</a></section> : <ol className="mt-6 divide-y">{digest.items.map((item, index) => <li key={item.article_id} className="py-5"><p className="text-sm text-ink-muted">{index + 1} · {item.source_name} · {item.tags.join("、")}</p><h2 className="mt-2 text-lg font-semibold"><a className="hover:text-red-700" href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h2>{item.summary && <p className="mt-2 leading-7">{item.summary}</p>}<p className="mt-2 text-xs text-ink-muted">{formatInstant(item.published_at ?? item.timeline_at)} · <a href={`/items/${encodeURIComponent(item.article_id)}`} className="underline">站内阅读</a></p></li>)}</ol>}</main>;
}
