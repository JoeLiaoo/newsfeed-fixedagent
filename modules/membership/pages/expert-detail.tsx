import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { Textarea } from "@aihot/web/components/member-ui/textarea";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { COMING_SOON_EXPERT_STATUS, EXPERT_MODE_INPUTS, EXPERT_MODE_LABELS, BUILTIN_SLUGS, PANORAMA_EXPERT_SLUG, SAMPLE_COMPANIES, modeNeedsEntity, expertStatusBadge } from "../experts/catalog.ts";

export const handle: Screen = { tab: "me", name: "专家" };
export const meta = () => pageMeta({ title: "专家详情", path: "/experts", noindex: true });

type Expert = {
  slug: string; name: string; description: string; version: string; status: string;
  execution_mode: "xinhua_trial" | "xinhua_panorama" | "text_only"; missing_dependencies: string[];
};
type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string; notes?: string };
  result: { candidates?: Candidate[]; preview?: string; approximate?: boolean; panorama?: { incomplete: boolean; gapCount: number; limits: string[] } } | null; errorCode: string | null; errorMessage: string | null;
  createdAt: string; hasArtifact: boolean; hasCheckpoint: boolean; executionAttempts: number;
  materials: Array<{ id: string; filename: string; byteSize: number; sha256: string; extractionStatus: string; extractionNote: string | null }>;
};

/** How many tasks one page of this expert's history carries. */
const PAGE_SIZE = 20;

const STATE_TEXT: Record<string, string> = { queued: "排队中", waiting_input: "等待选择主体", running: "执行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
const STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { queued: "warning", waiting_input: "warning", running: "default", succeeded: "success", failed: "destructive", cancelled: "secondary" };
const ERROR_TEXT: Record<string, string> = {
  xinhua_not_configured: "企业信息查询服务尚未配置，请联系管理员。", xinhua_unavailable: "企业信息查询服务暂时不可用。", xinhua_tool_unavailable: "当前账号缺少所需工具，任务未完成。", xinhua_tool_failed: "企业信息查询未返回可用结果。", xinhua_no_candidates: "未匹配到该名称的企业主体，请核对登记名称或改用更短的关键词。", xinhua_entity_id_missing: "查询返回的主体缺少可核验的唯一标识，报告已停止。", xinhua_response_invalid: "查询返回内容无法解析，报告已停止。", xinhua_identity_unverified: "未能按唯一 ID 或完整信用代码核验主体，报告已停止。", xinhua_entity_mismatch: "查询返回的主体与所选企业不一致，报告已停止。", expert_execution_failed: "任务未完成，请检查配置后重试。",
};

/** One expert: what it is, the task it takes, and the tasks it has run for this employee. */
export default function ExpertDetailPage() {
  const { slug } = useParams();
  const [expert, setExpert] = useState<Expert | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);

  async function loadExpert() {
    const response = await fetch("/api/v1/membership/experts");
    if (!response.ok) { location.href = "/login"; return null; }
    const data = await response.json() as { experts: Expert[] };
    const found = data.experts.find(entry => entry.slug === slug) ?? null;
    setExpert(found);
    return found;
  }

  /** One page of this expert's own history; the server filters by the expert and by the caller. */
  async function loadTasks(offset: number) {
    const response = await fetch(`/api/v1/membership/expert-tasks?expertSlug=${encodeURIComponent(slug ?? "")}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!response.ok) { location.href = "/login"; return; }
    const data = await response.json() as { tasks: Task[]; pagination: { nextOffset: number | null } };
    setTasks(data.tasks);
    setNextOffset(data.pagination.nextOffset ?? null);
    setPageOffset(offset);
  }

  async function load(offset: number) {
    await Promise.all([loadExpert(), loadTasks(offset)]);
  }

  async function turn(offset: number) {
    setPaging(true);
    try { await loadTasks(offset); }
    catch { setMessage("任务列表加载失败，请重试。"); }
    finally { setPaging(false); }
  }

  useEffect(() => { void load(0).catch(() => { setMessage("加载失败，请刷新重试。"); }).finally(() => setLoading(false)); }, [slug]);
  useEffect(() => {
    if (!tasks.some(task => task.state === "queued" || task.state === "running")) return;
    const timer = setInterval(() => { void loadTasks(pageOffset).catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [tasks, pageOffset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("任务已提交…");
    try {
      if (files.length > 3 || files.some(file => file.size > 5 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) { setMessage("最多上传 3 个文件，单个不超过 5 MB，总计不超过 10 MB。"); return; }
      const materials = await Promise.all(files.map(async file => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return { fileName: file.name, base64: btoa(binary) };
      }));
      const response = await fetch("/api/v1/membership/expert-tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ slug, companyName, notes, materials }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setMessage(data.error === "expert_dependencies_missing" ? "该专家依赖尚未接入。" : data.error === "expert_coming_soon" ? "该专家仍在开发中，暂不接收任务。" : data.error === "expert_task_rate_limited" ? "任务并发或每小时提交上限已达到，请稍后重试。" : data.error?.startsWith("expert_material_") ? "任务材料不符合要求，请使用有文字层的 PDF、DOCX、PPTX 或 UTF-8 Markdown，并检查大小。" : "任务提交失败，请检查输入并重试。"); return; }
      setCompanyName(""); setNotes(""); setFiles([]); setMessage("任务已进入队列。离开此页不会中断任务。"); await load(0);
    } catch { setMessage("任务提交请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function selectEntity(taskId: string, companyId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/entity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      setMessage(response.ok ? "已确认主体，继续查询…" : "主体确认失败，请刷新后重试。"); await load(pageOffset);
    } catch { setMessage("主体确认请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function taskAction(taskId: string, action: "retry" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/${action}`, { method: "POST" });
      setMessage(response.ok ? (action === "retry" ? "任务已重新提交。" : "已请求取消任务。") : "操作失败，请刷新后重试。"); await load(pageOffset);
    } catch { setMessage("操作请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function deleteMaterial(taskId: string, materialId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${taskId}/materials/${materialId}`, { method: "DELETE" });
      setMessage(response.ok ? "任务材料已删除。" : "材料删除失败，请确认任务已结束。");
      await load(pageOffset);
    } catch { setMessage("材料删除请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <p className="text-sm text-ink-3" role="status">正在加载专家…</p>
  </main>;

  if (!expert) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">专家</h1>
    <Alert className="mt-4" role="status">该专家不存在，或你无权查看。</Alert>
    <p className="mt-4"><IntentLink to="/experts" className="text-sm text-accent underline-offset-4 hover:underline">返回专家平台</IntentLink></p>
  </main>;

  const badge = expertStatusBadge(expert.status);
  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><IntentLink to="/experts"><ArrowLeft size={14} aria-hidden="true" />专家平台</IntentLink></Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">{expert?.name ?? "专家"}</h1>
        {expert && <Badge variant={badge.variant}>{badge.label}</Badge>}
        {expert && expert.status !== COMING_SOON_EXPERT_STATUS && <Badge variant="secondary">{EXPERT_MODE_LABELS[expert.execution_mode] ?? expert.execution_mode}</Badge>}
      </div>
      {expert && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-3">{expert.description}</p>}
      {expert && <p className="mt-1 text-xs text-ink-3">{expert.status === COMING_SOON_EXPERT_STATUS ? `v${expert.version}` : [EXPERT_MODE_INPUTS[expert.execution_mode], `v${expert.version}`].filter(Boolean).join(" · ")}</p>}
      {expert && expert.missing_dependencies.length > 0 && <p className="mt-1 text-xs text-amber-ink">缺少依赖：{expert.missing_dependencies.join("、")}</p>}
    </header>
    {expert && expert.status === COMING_SOON_EXPERT_STATUS && <Alert className="mb-5" role="status">开发中，敬请期待。该专家仍在接入数据源，开放后可在详情页直接提交任务。</Alert>}
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid gap-6">
      {expert && expert.status === "available" && <Card>
        <CardHeader><CardTitle>提交任务</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            {modeNeedsEntity(expert.execution_mode) ? <>
              <div className="grid gap-2"><Label htmlFor="company-name">目标企业名称</Label><Input id="company-name" required minLength={2} maxLength={200} value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="输入待核查主体" /></div>
              <p className="text-xs leading-relaxed text-ink-3">示例：{SAMPLE_COMPANIES.join("；")}。系统先检索同名候选，须由你确认主体后才查询。{expert.execution_mode === "xinhua_panorama" ? "确认后逐层核查。默认预算为最多 4 层、25 个主体、90 次查询，每个主体最多处理 20 条关系；达到上限或遇到无法核实的数据时，报告会标明不完整并列出缺口。" : "当前仅生成一层直接投资底稿，不代表完整穿透。"}</p>
            </> : null}
            {expert.execution_mode === "text_only" && <div className="grid gap-2"><Label htmlFor="task-notes">任务要求</Label><Textarea id="task-notes" required minLength={2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={5} /></div>}
            {modeNeedsEntity(expert.execution_mode) && <div className="grid gap-2"><Label htmlFor="task-notes">核查备注（内置专家可选）</Label><Textarea id="task-notes" required={!BUILTIN_SLUGS.has(slug ?? "")} minLength={BUILTIN_SLUGS.has(slug ?? "") ? undefined : 2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={4} /></div>}
            <div className="grid gap-2"><Label htmlFor="task-materials">任务材料（可选）</Label><Input id="task-materials" type="file" multiple accept=".pdf,.docx,.pptx,.md,.markdown,.txt" onChange={event => setFiles(Array.from(event.target.files ?? []))} /><p className="text-xs text-ink-3">PDF、DOCX、PPTX、Markdown；最多 3 个，单个 5 MB、总计 10 MB。材料与报告仅本人可访问，七天后清理。</p></div>
            <Button type="submit" disabled={busy}>{busy ? "请稍候…" : "提交任务"}</Button>
          </form>
        </CardContent>
      </Card>}

      {expert && expert.status !== COMING_SOON_EXPERT_STATUS && <Card>
        <CardHeader className="flex-row items-center justify-between"><div><CardTitle>我的任务</CardTitle></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(pageOffset)}>刷新</Button></CardHeader>
        <CardContent>
          {!tasks.length ? <p className="text-sm text-ink-3">{pageOffset > 0 ? "这一页没有任务记录，可回到上一页查看。" : "该专家还没有任务记录。提交任务后，运行记录与产物会显示在这里。"}</p> : <div className="grid gap-4">{tasks.map(task => <article key={task.id} className="rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{task.expertName}</h3><Badge variant={STATE_VARIANT[task.state] ?? "secondary"}>{STATE_TEXT[task.state] ?? task.state}</Badge></div>
            <p className="mt-2 text-xs text-ink-3">{task.stage} · {new Date(task.createdAt).toLocaleString("zh-CN")} · 执行尝试 {task.executionAttempts}/3 · 到期后自动清理</p>
            {task.errorMessage && <Alert className="mt-3" variant="destructive">{ERROR_TEXT[task.errorCode ?? ""] ?? task.errorMessage}</Alert>}
            {task.expertSlug === PANORAMA_EXPERT_SLUG && task.state === "succeeded" && task.result?.panorama?.incomplete && <Alert className="mt-3">结果不完整：{task.result.panorama.gapCount} 项核实缺口{task.result.panorama.limits.length ? `；达到上限：${task.result.panorama.limits.join("、")}` : ""}。请先查看报告中的缺口与未覆盖关系。</Alert>}
            {task.state === "waiting_input" && <div className="mt-4 grid gap-2"><p className="text-sm">请选择正确的工商主体，确认后系统才会继续：</p>{task.result?.approximate && <p className="text-xs text-ink-3">未匹配到完全一致的名称，以下为近似候选，请确认主体后再继续。</p>}{task.result?.candidates?.map(candidate => <Button key={candidate.id} type="button" variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal px-3 py-3 text-left" onClick={() => void selectEntity(task.id, candidate.id)}><span><span className="block font-medium">{candidate.name}</span><span className="mt-1 block text-xs font-normal text-ink-3">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span></span></Button>)}</div>}
            {task.result?.preview && <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-xs text-ink-2">{task.result.preview}</pre>}
            {task.materials?.length > 0 && <div className="mt-3 text-sm">{task.materials.map(material => <div key={material.id} className="flex flex-wrap items-center gap-2">{task.state === "cancelled" ? <span>{material.filename}</span> : <a className="text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/materials/${material.id}`}>{material.filename}</a>}<span className="text-xs text-ink-3">{Math.ceil(material.byteSize / 1024)} KB · {material.extractionStatus === "available" ? "已用于任务" : material.extractionStatus === "unavailable" ? "无法提取文字" : "等待处理"}</span>{["succeeded", "failed", "cancelled"].includes(task.state) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteMaterial(task.id, material.id)}>删除</Button>}</div>)}</div>}
            <div className="mt-4 flex flex-wrap gap-2">
              {task.hasArtifact && <Button asChild variant="link" className="h-9 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>下载 Markdown 产物</a></Button>}
              {task.expertSlug === PANORAMA_EXPERT_SLUG && task.hasCheckpoint && <Button asChild variant="link" className="h-9 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/checkpoint`}>下载采集台账 JSONL</a></Button>}
              {task.state === "failed" && task.executionAttempts < 3 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "retry")}>重试</Button>}
              {["queued", "running", "waiting_input"].includes(task.state) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "cancel")}>取消</Button>}
            </div>
          </article>)}</div>}
          {(nextOffset !== null || pageOffset > 0) && <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={paging || pageOffset === 0} onClick={() => void turn(Math.max(0, pageOffset - PAGE_SIZE))}>上一页</Button>
            <span className="text-xs text-ink-3">第 {Math.floor(pageOffset / PAGE_SIZE) + 1} 页</span>
            <Button type="button" variant="outline" size="sm" disabled={paging || nextOffset === null} onClick={() => void turn(nextOffset ?? pageOffset)}>下一页</Button>
          </div>}
        </CardContent>
      </Card>}
    </div>
  </main>;
}
