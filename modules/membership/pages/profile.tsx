import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Bell, ChevronRight, LogOut, SlidersHorizontal } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";

export default function ProfilePage() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/membership/me")
      .then(response => { if (response.ok) setReady(true); else location.href = "/login"; })
      .catch(() => setMessage("个人设置加载失败，请刷新重试。"));
  }, []);

  async function logout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/membership/logout", { method: "POST" });
      if (!response.ok) { setMessage("退出失败，请重试。"); return; }
      location.href = "/login";
    } catch { setMessage("网络异常，请重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <h1 className="mb-6 text-2xl font-semibold tracking-tight">个人设置</h1>
    {message && <Alert role="status" className="mb-5">{message}</Alert>}
    {!ready ? <p role="status" className="text-sm text-ink-3">正在加载个人设置…</p> : <Card>
      <CardHeader><CardTitle>账号与通知</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <Button asChild variant="outline" size="lg" className="h-auto min-h-14 w-full justify-start whitespace-normal text-left">
          <Link to="/settings/interests"><SlidersHorizontal aria-hidden="true" />调整关注赛道<ChevronRight aria-hidden="true" className="ml-auto" /></Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-auto min-h-14 w-full justify-start whitespace-normal text-left">
          <Link to="/settings/notifications"><Bell aria-hidden="true" />绑定微信<ChevronRight aria-hidden="true" className="ml-auto" /></Link>
        </Button>
        <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => void logout()} className="h-auto min-h-14 w-full cursor-pointer justify-start whitespace-normal text-left">
          <LogOut aria-hidden="true" />退出登录
        </Button>
      </CardContent>
    </Card>}
  </main>;
}
