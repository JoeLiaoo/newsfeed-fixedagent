import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { RadioGroup, RadioGroupItem } from "@aihot/web/components/member-ui/radio-group";
import { Textarea } from "@aihot/web/components/member-ui/textarea";
import { EXPERT_SLUG, SAMPLE_COMPANIES } from "../experts/catalog.ts";

type Expert = { slug: string; name: string; description: string; version: string; status: string; execution_mode: "xinhua_trial" | "text_only"; missing_dependencies: string[] };
type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string; notes?: string };
  result: { candidates?: Candidate[]; preview?: string; approximate?: boolean } | null; errorCode: string | null; errorMessage: string | null;
  createdAt: string; hasArtifact: boolean; executionAttempts: number;
};

const STATE_TEXT: Record<string, string> = { queued: "排队中", waiting_input: "等待选择主体", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { queued: "warning", waiting_input: "warning", running: "default", succeeded: "success", failed: "destructive", cancelled: "secondary" };
const ERROR_TEXT: Record<string, string> = {
  xinhua_not_configured: "新华财经 MCP 尚未配置，请联系管理员。", xinhua_unavailable: "新华财经 MCP 暂时不可用。", xinhua_tool_unavailable: "当前账号缺少所需工具，任务未完成。", xinhua_tool_failed: "新华财经未返回可用结果。", xinhua_no_candidates: "新华财经未匹配到该名称的主体，请核对登记名称或改用更短的关键词。", xinhua_entity_id_missing: "新华财经返回的主体缺少可核验的唯一标识，报告已停止。", xinhua_response_invalid: "新华财经返回内容无法解析，报告已停止。", xinhua_identity_unverified: "未能按唯一 ID 或完整信用代码核验主体，报告已停止。", xinhua_entity_mismatch: "服务商返回的主体与所选企业不一致，报告已停止。", expert_execution_failed: "任务未完成，请检查配置后重试。",
};

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

export default function ExpertsPage() {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(EXPERT_SLUG);
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [expertResponse, taskResponse] = await Promise.all([fetch("/api/v1/membership/experts"), fetch("/api/v1/membership/expert-tasks")]);
    if (!expertResponse.ok || !taskResponse.ok) { location.href = "/login"; return; }
    const expertData = await expertResponse.json() as { experts: Expert[] };
    const taskData = await taskResponse.json() as { tasks: Task[] };
    setExperts(expertData.experts);
    setTasks(taskData.tasks);
    setSelectedSlug(current => expertData.experts.some(expert => expert.slug === current && expert.status === "available") ? current : expertData.experts.find(expert => expert.status === "available")?.slug ?? "");
    setLoading(false);
  }

  useEffect(() => { void load().catch(() => { setMessage("加载失败，请刷新重试。"); setLoading(false); }); }, []);
  useEffect(() => {
    if (!tasks.some(task => task.state === "queued" || task.state === "running")) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [tasks]);

  const selectedExpert = experts.find(expert => expert.slug === selectedSlug);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("任务已提交…");
    try {
      const response = await fetch("/api/v1/membership/expert-tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ slug: selectedSlug, companyName, notes }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setMessage(data.error === "expert_dependencies_missing" ? "该专家依赖尚未接入。" : data.error === "expert_task_rate_limited" ? "任务并发或每小时提交上限已达到，请稍后重试。" : "任务提交失败，请检查输入并重试。"); return; }
      setCompanyName(""); setNotes(""); setMessage("任务已进入队列。离开此页不会中断任务。"); await load();
    } catch { setMessage("任务提交请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function importSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("skillFile");
    if (!(file instanceof File) || !file.size) { setMessage("请选择 Markdown 或 ZIP 技能文件。"); return; }
    if (file.size > 1_000_000) { setMessage("文件不得超过 1 MB。"); return; }
    setBusy(true); setMessage("正在检查技能文件…");
    try {
      const response = await fetch("/api/v1/membership/experts/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, base64: await fileAsBase64(file) }) });
      const data = await response.json() as { expert?: { name: string; status: string; missingDependencies: string[] }; error?: string };
      if (!response.ok) { setMessage(`导入失败：${data.error ?? "文件格式无效"}`); return; }
      setMessage(data.expert?.status === "blocked" ? `已导入但暂不可运行，缺少依赖：${data.expert.missingDependencies.join("、")}` : `已检查并发布「${data.expert?.name}」。`);
      form.reset(); await load();
    } catch { setMessage("导入失败，请检查文件后重试。"); }
    finally { setBusy(false); }
  }

  async function selectEntity(taskId: string, companyId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/entity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      setMessage(response.ok ? "已确认主体，继续查询…" : "主体确认失败，请刷新后重试。"); await load();
    } catch { setMessage("主体确认请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function taskAction(taskId: string, action: "retry" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/${action}`, { method: "POST" });
      setMessage(response.ok ? (action === "retry" ? "任务已重新提交。" : "已请求取消任务。") : "操作失败，请刷新后重试。"); await load();
    } catch { setMessage("操作请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">专家平台</h1><p className="mt-2 max-w-4xl text-sm leading-relaxed text-ink-3">任务异步执行，材料和产物保留 7 天；任务状态、错误和下载仅对提交者开放。自定义技能只能以文本调用 DeepSeek，不开放 MCP、代码执行或文件系统权限。</p></header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>专家目录</CardTitle><CardDescription>选择专家后填写任务信息，复杂规则和查询结果仍处于试运行阶段。</CardDescription></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-ink-3" role="status">正在加载专家目录…</p> : experts.length ? <RadioGroup value={selectedSlug} onValueChange={setSelectedSlug} aria-label="选择专家" className="grid gap-3 md:grid-cols-2">
            {experts.map(expert => <div key={expert.slug} onClick={() => { if (expert.status === "available") setSelectedSlug(expert.slug); }} className={`flex h-full cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors ${selectedSlug === expert.slug ? "border-accent bg-accent-soft/40" : "border-line hover:bg-bg-sunk"} ${expert.status !== "available" ? "cursor-not-allowed opacity-70" : ""}`}>
              <RadioGroupItem id={`expert-${expert.slug}`} value={expert.slug} aria-label={`选择${expert.name}`} disabled={expert.status !== "available"} className="mt-1" />
              <span className="grid min-w-0 gap-2"><span className="font-semibold text-ink">{expert.name}</span><span className="text-sm leading-relaxed text-ink-3">{expert.description}</span><span className="flex flex-wrap items-center gap-2 text-xs text-ink-3"><Badge variant={expert.status === "available" ? "success" : "warning"}>{expert.status === "available" ? "可运行" : "缺少依赖"}</Badge>{expert.execution_mode === "text_only" ? "纯文本模式（DeepSeek）" : "新华财经适配试运行"} · v{expert.version}{expert.missing_dependencies.length > 0 && ` · ${expert.missing_dependencies.join("、")}`}</span></span>
            </div>)}
          </RadioGroup> : <p className="text-sm text-ink-3">暂无已发布的专家。</p>}
          {selectedExpert && <form onSubmit={submit} className="mt-6 grid gap-4 border-t border-line pt-5">
            {selectedSlug === EXPERT_SLUG ? <>
              <div className="grid gap-2"><Label htmlFor="company-name">目标企业名称</Label><Input id="company-name" required minLength={2} maxLength={200} value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="输入待核查主体" /></div>
              <p className="text-xs leading-relaxed text-ink-3">示例：{SAMPLE_COMPANIES.join("；")}。系统先检索同名候选，须由你确认主体后才查询。当前仅生成一层直接投资底稿，不代表完整穿透。</p>
            </> : <div className="grid gap-2"><Label htmlFor="task-notes">任务要求</Label><Textarea id="task-notes" required minLength={2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={5} /></div>}
            {selectedSlug === EXPERT_SLUG && <div className="grid gap-2"><Label htmlFor="task-notes">补充材料或核查备注（可选，纯文本，最多 20,000 字）</Label><Textarea id="task-notes" maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={4} placeholder="不要粘贴密钥或不必要的个人信息" /></div>}
            <Button type="submit" disabled={busy}>{busy ? "请稍候…" : "提交任务"}</Button>
          </form>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>导入技能</CardTitle><CardDescription>检查 ZIP 包或单独的 SKILL.md，并提示尚未满足的依赖。</CardDescription></CardHeader>
        <CardContent><p className="mb-4 text-sm leading-relaxed text-ink-3">接受带 YAML frontmatter 的单个 SKILL.md 或 ZIP（根目录包含 manifest.json 与 SKILL.md），最多 1 MB。自定义技能只以纯文本模式调用 DeepSeek；声明的工具或其他技能依赖会被结构化检查，当前不可执行的依赖会阻止运行。</p>
          <form onSubmit={importSkill} className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="grid min-w-0 flex-1 gap-2"><Label htmlFor="skill-file">技能文件</Label><Input id="skill-file" name="skillFile" type="file" accept=".md,.zip,text/markdown,application/zip" required /></div><Button type="submit" variant="outline" disabled={busy}>{busy ? "检查中…" : "检查并导入"}</Button></form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between"><div><CardTitle>我的任务</CardTitle><CardDescription className="mt-2">任务状态与产物仅对提交者可见。</CardDescription></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}>刷新</Button></CardHeader>
        <CardContent>
          {!tasks.length ? <p className="text-sm text-ink-3">暂无任务。</p> : <div className="grid gap-4">{tasks.map(task => <article key={task.id} className="rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{task.expertName}</h3><Badge variant={STATE_VARIANT[task.state] ?? "secondary"}>{STATE_TEXT[task.state] ?? task.state}</Badge></div>
            <p className="mt-2 text-xs text-ink-3">{task.stage} · {new Date(task.createdAt).toLocaleString("zh-CN")} · 执行尝试 {task.executionAttempts}/3 · 到期后自动清理</p>
            {task.errorMessage && <Alert className="mt-3" variant="destructive">{ERROR_TEXT[task.errorCode ?? ""] ?? task.errorMessage}</Alert>}
            {task.state === "waiting_input" && <div className="mt-4 grid gap-2"><p className="text-sm">请选择正确的工商主体，确认后系统才会继续：</p>{task.result?.approximate && <p className="text-xs text-ink-3">未匹配到完全一致的名称，以下为近似候选，请确认主体后再继续。</p>}{task.result?.candidates?.map(candidate => <Button key={candidate.id} type="button" variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal px-3 py-3 text-left" onClick={() => void selectEntity(task.id, candidate.id)}><span><span className="block font-medium">{candidate.name}</span><span className="mt-1 block text-xs font-normal text-ink-3">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span></span></Button>)}</div>}
            {task.result?.preview && <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-xs text-ink-2">{task.result.preview}</pre>}
            <div className="mt-4 flex flex-wrap gap-2">
              {task.hasArtifact && <Button asChild variant="link" className="h-9 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>下载 Markdown 产物</a></Button>}
              {task.state === "failed" && task.executionAttempts < 3 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "retry")}>重试</Button>}
              {["queued", "running", "waiting_input"].includes(task.state) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "cancel")}>取消</Button>}
            </div>
          </article>)}</div>}
        </CardContent>
      </Card>
    </div>
  </main>;
}
