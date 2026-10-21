import { useEffect, useState } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";

type Pending = { id: string; username: string; real_name: string; created_at: string };

export default function AdminMembersPage() {
  const [users, setUsers] = useState<Pending[]>([]);
  const [message, setMessage] = useState("加载中…");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/v1/membership/admin/pending");
    if (!response.ok) { setMessage("需要管理员权限。"); return; }
    const data = await response.json() as { users: Pending[] };
    setUsers(data.users);
    setMessage(data.users.length ? "" : "没有待审核账号。");
  }

  useEffect(() => { void reload().catch(() => setMessage("加载失败，请刷新重试。")); }, []);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id); setMessage("");
    try {
      const response = await fetch(`/api/v1/membership/admin/${encodeURIComponent(id)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      if (!response.ok) { setMessage("操作失败，请重试。"); return; }
      await reload();
    } catch { setMessage("操作请求失败，请检查网络后重试。"); }
    finally { setBusyId(null); }
  }

  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">员工账号审核</h1><p className="mt-2 text-sm text-ink-3">审核待开通的员工账号。</p></header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    <Card>
      <CardHeader><CardTitle>待审核账号</CardTitle><CardDescription>通过后，员工即可登录并设置关注赛道。</CardDescription></CardHeader>
      {!!users.length && <CardContent className="grid gap-3">
        {users.map(user => <div key={user.id} className="flex flex-col gap-3 rounded-control border border-line-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="truncate font-medium text-ink">{user.real_name}</p><p className="mt-1 text-sm text-ink-3">{user.username}</p></div>
          <div className="flex items-center gap-2">
            <Badge variant="warning">待审核</Badge>
            <Button size="sm" disabled={busyId !== null} onClick={() => void decide(user.id, "approve")}>{busyId === user.id ? "处理中…" : "通过"}</Button>
            <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void decide(user.id, "reject")}>拒绝</Button>
          </div>
        </div>)}
      </CardContent>}
    </Card>
  </main>;
}
