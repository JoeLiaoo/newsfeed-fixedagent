import { useEffect, useState, type FormEvent } from "react";
import { EXPERT_SLUG, SAMPLE_COMPANIES } from "../experts/catalog.ts";

type Expert = { slug: string; name: string; description: string; version: string; status: string; execution_mode: "xinhua_trial" | "text_only"; missing_dependencies: string[] };
type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string; notes?: string };
  result: { candidates?: Candidate[]; preview?: string } | null; errorCode: string | null; errorMessage: string | null;
  createdAt: string; hasArtifact: boolean; executionAttempts: number;
};

const stateText: Record<string, string> = { queued: "排队中", waiting_input: "等待选择主体", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const errorText: Record<string, string> = { xinhua_not_configured: "新华财经 MCP 尚未配置，请联系管理员。", xinhua_unavailable: "新华财经 MCP 暂时不可用。", xinhua_tool_unavailable: "当前账号缺少所需工具，任务未完成。", xinhua_tool_failed: "新华财经未返回可用结果。", xinhua_identity_unverified: "未能按唯一 ID 或完整信用代码核验主体，报告已停止。", xinhua_entity_mismatch: "服务商返回的主体与所选企业不一致，报告已停止。", expert_execution_failed: "任务未完成，请检查配置后重试。" };

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

  async function load() {
    const [expertResponse, taskResponse] = await Promise.all([fetch("/api/v1/membership/experts"), fetch("/api/v1/membership/expert-tasks")]);
    if (!expertResponse.ok || !taskResponse.ok) { location.href = "/login"; return; }
    const expertData = await expertResponse.json() as { experts: Expert[] };
    const taskData = await taskResponse.json() as { tasks: Task[] };
    setExperts(expertData.experts);
    setTasks(taskData.tasks);
    setSelectedSlug(old => expertData.experts.some(expert => expert.slug === old && expert.status === "available") ? old : expertData.experts.find(expert => expert.status === "available")?.slug ?? "");
    setLoading(false);
  }

  useEffect(() => { void load().catch(() => { setMessage("加载失败，请刷新重试。"); setLoading(false); }); }, []);
  useEffect(() => {
    if (!tasks.some(task => task.state === "queued" || task.state === "running")) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [tasks]);

  const selectedExpert = experts.find(expert => expert.slug === selectedSlug);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("任务已提交…");
    const response = await fetch("/api/v1/membership/expert-tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ slug: selectedSlug, companyName, notes }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessage(data.error === "expert_dependencies_missing" ? "该专家依赖尚未接入。" : data.error === "expert_task_rate_limited" ? "任务并发或每小时提交上限已达到，请稍后重试。" : "任务提交失败，请检查输入并重试。"); return; }
    setCompanyName(""); setNotes(""); setMessage("任务已进入队列。离开此页不会中断任务。"); await load();
  }

  async function importSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("skillFile");
    if (!(file instanceof File) || !file.size) { setMessage("请选择 Markdown 或 ZIP 技能文件。"); return; }
    if (file.size > 1_000_000) { setMessage("文件不得超过 1 MB。"); return; }
    setMessage("正在检查技能文件…");
    try {
      const response = await fetch("/api/v1/membership/experts/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, base64: await fileAsBase64(file) }) });
      const data = await response.json() as { expert?: { name: string; status: string; missingDependencies: string[] }; error?: string };
      if (!response.ok) { setMessage(`导入失败：${data.error ?? "文件格式无效"}`); return; }
      setMessage(data.expert?.status === "blocked" ? `已导入但暂不可运行，缺少依赖：${data.expert.missingDependencies.join("、")}` : `已检查并发布「${data.expert?.name}」。`);
      event.currentTarget.reset(); await load();
    } catch { setMessage("导入失败，请检查文件后重试。"); }
  }

  async function selectEntity(taskId: string, companyId: string) {
    const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/entity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
    setMessage(response.ok ? "已确认主体，继续查询…" : "主体确认失败，请刷新后重试。"); await load();
  }

  async function taskAction(taskId: string, action: "retry" | "cancel") {
    const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/${action}`, { method: "POST" });
    setMessage(response.ok ? (action === "retry" ? "任务已重新提交。" : "已请求取消任务。") : "操作失败，请刷新后重试。"); await load();
  }

  return <main className="mx-auto max-w-5xl px-5 py-8">
    <h1 className="text-2xl font-semibold">专家平台</h1>
    <p className="mt-2 text-ink-muted">任务异步执行，材料和产物保留 7 天；任务状态、错误和下载仅对提交者开放。自定义技能只能以文本调用 DeepSeek，不开放 MCP、代码执行或文件系统权限。</p>
    {message && <p className="mt-4 rounded border p-3" role="status">{message}</p>}
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">专家目录</h2>
      {loading ? <p className="mt-3">正在加载…</p> : experts.length ? <div className="mt-3 grid gap-3 md:grid-cols-2">{experts.map(expert => <button type="button" key={expert.slug} disabled={expert.status !== "available"} onClick={() => setSelectedSlug(expert.slug)} className={`rounded border p-4 text-left ${selectedSlug === expert.slug ? "border-red-700" : ""} disabled:opacity-60`}><strong>{expert.name}</strong><p className="mt-1 text-sm text-ink-muted">{expert.description}</p><p className="mt-2 text-xs">{expert.execution_mode === "text_only" ? "纯文本模式（DeepSeek）" : "新华财经适配试运行"} · v{expert.version} · {expert.status === "available" ? "可运行" : `缺少依赖：${expert.missing_dependencies.join("、")}`}</p></button>)}</div> : <p className="mt-3">暂无已发布的专家。</p>}
      {selectedExpert && <form onSubmit={submit} className="mt-5 grid gap-3 border-t pt-5">
        {selectedSlug === EXPERT_SLUG ? <><label className="grid gap-1 text-sm">目标企业名称<input required minLength={2} maxLength={200} value={companyName} onChange={event => setCompanyName(event.target.value)} className="rounded border p-2" placeholder="输入待核查主体" /></label><p className="text-xs text-ink-muted">示例：{SAMPLE_COMPANIES.join("；")}。系统先检索同名候选，须由你确认主体后才查询。当前仅生成一层直接投资底稿，不代表完整穿透。</p></> : <label className="grid gap-1 text-sm">任务要求<textarea required minLength={2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={5} className="rounded border p-2" /></label>}
        {selectedSlug === EXPERT_SLUG && <label className="grid gap-1 text-sm">补充材料或核查备注（可选，纯文本，最多 20,000 字）<textarea maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={4} className="rounded border p-2" placeholder="不要粘贴密钥或不必要的个人信息" /></label>}
        <button className="justify-self-start rounded bg-red-700 px-5 py-2 text-white">提交任务</button>
      </form>}
    </section>
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">导入技能</h2>
      <p className="mt-1 text-sm text-ink-muted">接受带 YAML frontmatter 的单个 SKILL.md 或 ZIP（根目录包含 manifest.json 与 SKILL.md），最多 1 MB。自定义技能只以纯文本模式调用 DeepSeek；声明的工具或其他技能依赖会被结构化检查，当前不可执行的依赖会阻止运行。</p>
      <form onSubmit={importSkill} className="mt-3 flex flex-wrap items-center gap-3"><input name="skillFile" type="file" accept=".md,.zip,text/markdown,application/zip" required /><button className="rounded border px-4 py-2">检查并导入</button></form>
    </section>
    <section className="mt-6 rounded-lg border p-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">我的任务</h2><button type="button" onClick={() => void load()} className="text-sm underline">刷新</button></div>
      {!tasks.length ? <p className="mt-3 text-sm text-ink-muted">暂无任务。</p> : <div className="mt-3 space-y-4">{tasks.map(task => <article key={task.id} className="rounded border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{task.expertName}</strong><span className="text-sm">{stateText[task.state] ?? task.state} · {task.stage}</span></div><p className="mt-1 text-xs text-ink-muted">{new Date(task.createdAt).toLocaleString("zh-CN")} · 执行尝试 {task.executionAttempts}/3 · 到期后自动清理</p>
        {task.errorMessage && <p className="mt-3 text-sm text-red-700">{errorText[task.errorCode ?? ""] ?? task.errorMessage}</p>}
        {task.state === "waiting_input" && <div className="mt-3 space-y-2"><p className="text-sm">请选择正确的工商主体，确认后系统才会继续：</p>{task.result?.candidates?.map(candidate => <button type="button" key={candidate.id} onClick={() => void selectEntity(task.id, candidate.id)} className="block w-full rounded border p-3 text-left text-sm hover:border-red-700"><strong>{candidate.name}</strong><span className="ml-2 text-ink-muted">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span></button>)}</div>}
        {task.result?.preview && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{task.result.preview}</pre>}
        <div className="mt-3 flex gap-3 text-sm">{task.hasArtifact && <a className="text-red-700 underline" href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>下载 Markdown 产物</a>}{task.state === "failed" && task.executionAttempts < 3 && <button type="button" onClick={() => void taskAction(task.id, "retry")} className="underline">重试</button>}{["queued", "running", "waiting_input"].includes(task.state) && <button type="button" onClick={() => void taskAction(task.id, "cancel")} className="underline">取消</button>}</div>
      </article>)}</div>}
    </section>
  </main>;
}
