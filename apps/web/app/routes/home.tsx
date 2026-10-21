import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import { API_BASE_URL } from "../lib/api.server";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "featured", name: "我的日报" };
export async function loader({ request }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") ?? "";
  const headers = { cookie, accept: "application/json" };
  const me = await fetch(`${API_BASE_URL}/api/v1/membership/me`, { headers, cache: "no-store" });
  if (me.status === 401) throw redirect("/login");
  if (!me.ok) throw new Response("平台暂时不可用", { status: 503 });
  const profile = await me.json() as { tags: string[] };
  if (!profile.tags.length) throw redirect("/settings/interests");
  const response = await fetch(`${API_BASE_URL}/api/v1/membership/digest`, { headers, cache: "no-store" });
  if (!response.ok) throw new Response("个人日报暂时不可用", { status: 503 });
  return response.json();
}
export function headers() { return { "Cache-Control": "private, no-store", Vary: "Cookie" }; }
export function meta() { return [{ title: "我的日报 · 中信私募ai平台" }]; }

type Digest = { date: string; generatedAt: string; items: Array<{ article_id: string; title: string; summary: string | null; url: string; tags: string[]; source_name: string; published_at: string | null; timeline_at: string }> };
export default function Home() {
  const digest = useLoaderData() as Digest;
  return <main className="mx-auto max-w-4xl px-5 py-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-ink-muted">{digest.date}</p><h1 className="mt-1 text-2xl font-semibold">我的日报</h1></div><div className="flex gap-4"><a href="/settings/interests" className="text-red-700 underline">调整关注赛道</a><button type="button" onClick={async () => { await fetch("/api/v1/membership/logout", { method: "POST" }); location.href = "/login"; }} className="text-red-700 underline">退出登录</button></div></div><p className="mt-3 text-ink-muted">根据你的关注赛道，从已公开的资讯中筛选今日内容；每条均保留原始来源。</p>{digest.items.length === 0 ? <section className="mt-8 rounded-lg border p-6"><h2 className="font-semibold">今日暂无匹配资讯</h2><p className="mt-2 text-ink-muted">共享资讯池没有找到与你当前关注赛道匹配的公开内容。</p><a href="/all" className="mt-3 inline-block text-red-700 underline">查看实时新闻</a></section> : <ol className="mt-6 divide-y">{digest.items.map((item, index) => <li key={item.article_id} className="py-5"><p className="text-sm text-ink-muted">{index + 1} · {item.source_name} · {item.tags.join("、")}</p><h2 className="mt-2 text-lg font-semibold"><a className="hover:text-red-700" href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h2>{item.summary && <p className="mt-2 leading-7">{item.summary}</p>}<p className="mt-2 text-xs text-ink-muted">{new Date(item.published_at ?? item.timeline_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · <a href={`/items/${encodeURIComponent(item.article_id)}`} className="underline">站内阅读</a></p></li>)}</ol>}</main>;
}
