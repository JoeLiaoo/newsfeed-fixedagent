import { useEffect, useState } from "react";

type Pending = { id: string; username: string; real_name: string; created_at: string };
export default function AdminMembersPage() {
  const [users, setUsers] = useState<Pending[]>([]); const [message, setMessage] = useState("加载中…");
  async function reload() { const response = await fetch("/api/v1/membership/admin/pending"); if (!response.ok) { setMessage("需要管理员权限。"); return; } const data = await response.json(); setUsers(data.users); setMessage(data.users.length ? "" : "没有待审核账号。"); }
  useEffect(() => { void reload(); }, []);
  async function decide(id: string, decision: "approve" | "reject") { const response = await fetch(`/api/v1/membership/admin/${encodeURIComponent(id)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }); if (!response.ok) { setMessage("操作失败。"); return; } await reload(); }
  return <main className="mx-auto max-w-3xl px-5 py-8"><h1 className="text-2xl font-semibold">员工账号审核</h1>{message && <p className="mt-4">{message}</p>}<ul className="mt-5 divide-y">{users.map(user => <li key={user.id} className="flex items-center justify-between gap-4 py-4"><span>{user.real_name}（{user.username}）</span><span className="flex gap-2"><button onClick={() => decide(user.id, "approve")} className="rounded bg-red-700 px-3 py-2 text-white">通过</button><button onClick={() => decide(user.id, "reject")} className="rounded border px-3 py-2">拒绝</button></span></li>)}</ul></main>;
}
