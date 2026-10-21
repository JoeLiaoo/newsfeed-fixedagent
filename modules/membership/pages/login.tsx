import { useState, type FormEvent } from "react";
import { Link, redirect, useNavigate } from "react-router";

export async function loader({ request }: { request: Request }) {
  try {
    const response = await fetch(`${process.env.API_BASE_URL || "http://127.0.0.1:3001"}/api/v1/membership/me`, { headers: { cookie: request.headers.get("cookie") ?? "" } });
    if (response.ok) throw redirect("/");
  } catch (error) { if (error instanceof Response) throw error; }
  return null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/membership/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error === "pending_approval" ? "账号等待管理员审核。" : "登录失败，请检查用户名、密码或账号状态。"); return; }
    const next = new URLSearchParams(window.location.search).get("next");
    navigate(next?.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
  }
  return <main className="mx-auto max-w-md px-5 py-12"><h1 className="text-2xl font-semibold">中信私募ai平台</h1><p className="mt-2 text-ink-muted">员工登录</p><form onSubmit={submit} className="mt-8 grid gap-4"><label className="grid gap-1">用户名<input name="username" required autoComplete="username" className="rounded border p-3" /></label><label className="grid gap-1">密码<input name="password" type="password" required autoComplete="current-password" className="rounded border p-3" /></label><button disabled={busy} className="rounded bg-red-700 p-3 text-white">{busy ? "登录中…" : "登录"}</button>{message && <p role="alert">{message}</p>}</form><p className="mt-5">还没有账号？ <Link className="text-red-700 underline" to="/register">注册</Link></p></main>;
}
