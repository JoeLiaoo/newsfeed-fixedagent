import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { Textarea } from "@aihot/web/components/member-ui/textarea";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "me", name: "新增知识库" };
export const meta = () => pageMeta({ title: "新增知识库", path: "/knowledge/bases/new", noindex: true });

/** A new knowledge base: a name and, if it helps, what it is for. */
export default function NewKnowledgeBasePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("正在创建知识库…");
    try {
      const response = await fetch("/api/v1/membership/knowledge/bases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const result = await response.json() as { base?: { id: string; name: string }; message?: string; error?: string };
      if (!response.ok || !result.base) { setMessage(result.message ?? result.error ?? "创建失败，请重试。"); return; }
      navigate(`/knowledge/bases/${encodeURIComponent(result.base.id)}`);
    } catch { setMessage("创建请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><Link to="/knowledge"><ArrowLeft size={14} aria-hidden="true" />知识库</Link></Button>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">新增知识库</h1>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <Card>
      <CardHeader><CardTitle>知识库</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="base-name">名称</Label>
            <Input id="base-name" required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：新能源赛道投研" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="base-description">说明（可选）</Label>
            <Textarea id="base-description" maxLength={200} value={description} onChange={event => setDescription(event.target.value)} rows={3} placeholder="这个知识库收哪一类材料" />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "创建中…" : "创建知识库"}</Button>
        </form>
      </CardContent>
    </Card>
  </main>;
}
