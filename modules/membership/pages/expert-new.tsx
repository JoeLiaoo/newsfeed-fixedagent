import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { FileInput } from "@aihot/web/components/member-ui/file-input";
import { Label } from "@aihot/web/components/member-ui/label";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "experts", name: "新增专家" };
export const meta = () => pageMeta({ title: "新增专家", path: "/experts/new", noindex: true });

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** A new expert: the skill package that becomes one. The import checks it and publishes it. */
export default function NewExpertPage() {
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<{ slug: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function importSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("skillFile");
    if (!(file instanceof File) || !file.size) { setMessage("请选择 Markdown 或 ZIP 技能文件。"); return; }
    if (file.size > 1_000_000) { setMessage("文件不得超过 1 MB。"); return; }
    setBusy(true); setMessage("正在检查技能文件…");
    try {
      const response = await fetch("/api/v1/membership/experts/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, base64: await fileAsBase64(file) }) });
      const data = await response.json() as { expert?: { slug: string; name: string; status: string; missingDependencies: string[] }; error?: string };
      if (!response.ok) { setMessage(`导入失败：${data.error ?? "文件格式无效"}`); return; }
      setCreated({ slug: data.expert?.slug ?? "", name: data.expert?.name ?? "" });
      setMessage(data.expert?.status === "blocked" ? `已导入但暂不可运行，缺少依赖：${data.expert.missingDependencies.join("、")}` : `已检查并发布「${data.expert?.name}」。`);
      form.reset();
    } catch { setMessage("导入失败，请检查文件后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><Link to="/experts"><ArrowLeft size={14} aria-hidden="true" />专家平台</Link></Button>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">新增专家</h1>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    {created && <p className="mb-5 text-sm"><Link to={`/experts/${encodeURIComponent(created.slug)}`} className="text-accent underline-offset-4 hover:underline">进入「{created.name}」</Link></p>}

    <Card>
      <CardHeader><CardTitle>导入技能</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-4 text-sm leading-relaxed text-ink-3">接受带 YAML frontmatter 的单个 SKILL.md 或 ZIP（根目录包含 manifest.json 与 SKILL.md），最多 1 MB。技能按自身声明及平台已开放的能力执行：未声明工具的技能为文本任务专家，直接填写任务要求；完整声明主体检索、工商画像与一层直接投资三项平台能力的技能为一层对外投资核查，需先确认企业主体；完整声明全部平台能力的技能为对外投资全景图，逐层穿透并逐项标注能力缺口。声明的工具或其他技能依赖会被结构化检查，未接入的依赖会阻止运行。</p>
        <form onSubmit={importSkill} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid min-w-0 flex-1 gap-2"><Label htmlFor="skill-file">技能文件</Label><FileInput id="skill-file" name="skillFile" accept=".md,.zip,text/markdown,application/zip" required /></div>
          <Button type="submit" variant="outline" disabled={busy}>{busy ? "检查中…" : "检查并导入"}</Button>
        </form>
      </CardContent>
    </Card>
  </main>;
}
