import { useState, type FormEvent } from "react";
import { Link, redirect, useNavigate } from "react-router";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";

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
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/v1/membership/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "pending_approval" ? "账号等待管理员审核。" : "登录失败，请检查用户名、密码或账号状态。"); return; }
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(next?.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch { setMessage("登录请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-md px-5 py-12">
    <Card>
      <CardHeader><CardTitle className="text-xl">中信私募ai平台</CardTitle><CardDescription>员工登录</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="username">用户名</Label><Input id="username" name="username" required autoComplete="username" /></div>
          <div className="grid gap-2"><Label htmlFor="password">密码</Label><Input id="password" name="password" type="password" required autoComplete="current-password" /></div>
          <Button type="submit" disabled={busy}>{busy ? "登录中…" : "登录"}</Button>
          {message && <Alert>{message}</Alert>}
        </form>
        <p className="mt-5 text-sm text-ink-3">还没有账号？ <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/register">注册</Link></p>
      </CardContent>
    </Card>
  </main>;
}
