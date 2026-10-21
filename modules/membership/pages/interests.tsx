import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Checkbox } from "@aihot/web/components/member-ui/checkbox";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { DIRECTIONS } from "../catalog.ts";

type Me = { tags: string[]; catalog: string[]; user: { role: string } };

export default function InterestsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/membership/me")
      .then(async response => {
        if (!response.ok) { location.href = "/login"; return; }
        const data = await response.json() as Me;
        setMe(data);
        setSelected(data.tags);
      })
      .catch(() => setMessage("加载失败，请刷新重试。"));
  }, []);

  function toggle(tag: string) {
    setSelected(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/membership/interests", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tags: selected }) });
      setMessage(response.ok ? "关注赛道已保存。" : "保存失败，请重试。");
    } catch { setMessage("保存请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function add() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/membership/interests/custom", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tag: custom }) });
      if (!response.ok) { setMessage("新增失败，请检查名称或重新登录。"); return; }
      const data = await response.json() as { tag: string };
      setSelected(current => [...new Set([...current, data.tag])]);
      setMe(current => current ? { ...current, catalog: [...new Set([...current.catalog, data.tag])] } : current);
      setCustom(""); setMessage("公共标签已保存到你的关注，并加入全员共享目录。");
    } catch { setMessage("新增请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">关注赛道</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-3">选择一级方向时默认勾选全部细分赛道；之后可逐项调整。新增标签会进入全员共享目录。</p>
      {me?.user.role === "admin" && <Button asChild variant="link" className="mt-2 h-auto px-0"><Link to="/settings/admin-members">管理员：审核员工账号</Link></Button>}
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    {!me ? <p className="text-sm text-ink-3" role="status">正在加载关注设置…</p> : <form onSubmit={save} className="grid gap-5">
      {DIRECTIONS.map(direction => {
        const chosen = direction.tags.filter(tag => selected.includes(tag)).length;
        const checked: boolean | "indeterminate" = chosen === direction.tags.length ? true : chosen > 0 ? "indeterminate" : false;
        return <Card key={direction.name}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3 text-base">
              <Checkbox id={`direction-${direction.name}`} checked={checked} onCheckedChange={() => setSelected(current => checked ? current.filter(tag => !(direction.tags as readonly string[]).includes(tag)) : [...new Set([...current, ...direction.tags])])} />
              <Label htmlFor={`direction-${direction.name}`} className="cursor-pointer text-base">{direction.name}</Label>
            </CardTitle>
            <CardDescription>已选 {chosen} / {direction.tags.length} 个细分赛道</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
          {direction.tags.map(tag => {
            const id = `tag-${encodeURIComponent(tag)}`;
            return <div key={tag} className="flex items-center gap-2.5 rounded-control px-2 py-2 hover:bg-bg-sunk">
              <Checkbox id={id} checked={selected.includes(tag)} onCheckedChange={() => toggle(tag)} />
              <Label htmlFor={id} className="cursor-pointer font-normal">{tag}</Label>
            </div>;
          })}
          </CardContent>
        </Card>;
      })}
      <Card>
        <CardHeader className="pb-3"><CardTitle>公共新增标签</CardTitle><CardDescription>新增标签会加入共享目录，你也可以在这里选择已有标签。</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {me.catalog.filter(tag => !DIRECTIONS.some(direction => (direction.tags as readonly string[]).includes(tag))).map(tag => {
              const id = `custom-tag-${encodeURIComponent(tag)}`;
              return <div key={tag} className="flex items-center gap-2.5 rounded-control px-2 py-2 hover:bg-bg-sunk">
                <Checkbox id={id} checked={selected.includes(tag)} onCheckedChange={() => toggle(tag)} />
                <Label htmlFor={id} className="cursor-pointer font-normal">{tag}</Label>
              </div>;
            })}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input value={custom} onChange={event => setCustom(event.target.value)} maxLength={80} minLength={2} placeholder="新增公共标签" aria-label="新增公共标签" />
            <Button type="button" variant="outline" disabled={busy || custom.trim().length < 2} onClick={() => void add()}>新增标签</Button>
          </div>
        </CardContent>
      </Card>
      <Button type="submit" className="justify-self-start" disabled={busy}>{busy ? "保存中…" : "保存关注"}</Button>
    </form>}
  </main>;
}
