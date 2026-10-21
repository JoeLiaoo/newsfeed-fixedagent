import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";

export default function RegisterPage() {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/v1/membership/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), realName: form.get("realName"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "username_taken" ? "用户名已被使用。" : result.message ?? "注册失败，请检查填写内容。"); return; }
      setDone(true);
    } catch { setMessage("注册请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-md px-5 py-12"><Card>
    <CardHeader><CardTitle>员工注册</CardTitle><CardDescription>提交后由管理员审核账号。</CardDescription></CardHeader>
    <CardContent>{done ? <div className="grid gap-4"><Alert role="status">注册已提交，管理员审核通过后即可登录。</Alert><Button asChild variant="outline"><Link to="/login">返回登录</Link></Button></div> : <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2"><Label htmlFor="username">用户名</Label><Input id="username" name="username" minLength={3} maxLength={40} required autoComplete="username" /></div>
      <div className="grid gap-2"><Label htmlFor="realName">真实姓名</Label><Input id="realName" name="realName" minLength={2} maxLength={80} required autoComplete="name" /></div>
      <div className="grid gap-2"><Label htmlFor="password">密码（至少 12 位）</Label><Input id="password" name="password" type="password" minLength={12} maxLength={200} required autoComplete="new-password" /></div>
      <Button type="submit" disabled={busy}>{busy ? "正在提交…" : "提交审核"}</Button>{message && <Alert>{message}</Alert>}
    </form>}</CardContent>
  </Card></main>;
}
