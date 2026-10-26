import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { ArrowLeft, Download, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { artifactDownloadLabel, EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS, QUERY_EXPERT_SLUGS } from "../experts/catalog.ts";
import { companyRelationLabel } from "../experts/data.ts";

export const handle: Screen = { tab: "experts", name: "任务" };
export const meta = () => pageMeta({ title: "任务详情", path: "/tasks", noindex: true });

type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null; typeName?: string | null; branchOf?: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string; query?: string; region?: string; startDate?: string; endDate?: string; stockCodes?: string[]; notes?: string };
  result: { candidates?: Candidate[]; preview?: string; html?: string; format?: string; approximate?: boolean; query?: string; panorama?: { incomplete: boolean; gapCount: number; limits: string[] } } | null;
  errorCode: string | null; errorMessage: string | null; executionAttempts: number; confirmedAttempts: number; selectedEntity: { id?: string; name?: string } | null;
  createdAt: string; updatedAt: string; expiresAt: string; hasArtifact: boolean;
  materials: Array<{ id: string; filename: string; byteSize: number; sha256: string; extractionStatus: string; extractionNote: string | null }>;
};

/** The states in which the task is still moving and the page keeps watching it. */
const ACTIVE_STATES = ["queued", "running", "waiting_input"];
/** The states in which the task has stopped; its materials may be removed. */
const TERMINAL_STATES = ["succeeded", "failed", "cancelled"];

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN");
}

/** One task on its own page: where it is, what it produced, and what the employee can do next. */
export default function TaskDetailPage() {
  const { id } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/membership/expert-tasks/${encodeURIComponent(id ?? "")}`, { headers: { accept: "application/json" } });
    if (response.status === 401) { location.href = "/login"; return; }
    if (response.status === 404) { setTask(null); setMissing(true); setUnreadable(false); setLoading(false); return; }
    if (!response.ok) { setUnreadable(true); setLoading(false); return; }
    const data = await response.json() as { task: Task };
    setTask(data.task);
    setMissing(false);
    setUnreadable(false);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load().catch(() => { setUnreadable(true); setLoading(false); }); }, [load]);

  useEffect(() => {
    if (!task || !ACTIVE_STATES.includes(task.state)) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 4000);
    return () => clearInterval(timer);
  }, [load, task]);

  async function act(action: "retry" | "cancel") {
    if (!task) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${task.id}/${action}`, { method: "POST" });
      setMessage(response.ok ? (action === "retry" ? "任务已重新提交。" : "已请求取消任务。") : "操作失败，请刷新后重试。");
      await load();
    } catch { setMessage("操作请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function selectEntity(companyId: string) {
    if (!task) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${task.id}/entity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      setMessage(response.ok ? "已确认主体，继续执行…" : "主体确认失败，请刷新后重试。");
      await load();
    } catch { setMessage("主体确认请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function deleteMaterial(materialId: string) {
    if (!task) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/membership/expert-tasks/${task.id}/materials/${materialId}`, { method: "DELETE" });
      setMessage(response.ok ? "任务材料已删除。" : "材料删除失败，请确认任务已结束。");
      await load();
    } catch { setMessage("材料删除请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <p className="text-sm text-ink-3" role="status">正在加载任务…</p>
  </main>;

  if (unreadable) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">任务详情</h1>
    <Alert className="mt-4" variant="destructive" role="status">任务加载失败，请重试。</Alert>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => { setLoading(true); void load().catch(() => setUnreadable(true)); }}><RefreshCw size={14} aria-hidden="true" />重试</Button>
      <Button asChild variant="ghost"><IntentLink to="/experts">返回专家平台</IntentLink></Button>
    </div>
  </main>;

  if (missing || !task) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">任务详情</h1>
    <Alert className="mt-4" role="status">该任务不存在，或不属于你；任务到期后也会一并清理。</Alert>
    <p className="mt-4"><IntentLink to="/experts" className="text-sm text-accent underline-offset-4 hover:underline">返回专家平台</IntentLink></p>
  </main>;

  const active = ACTIVE_STATES.includes(task.state);
  const terminal = TERMINAL_STATES.includes(task.state);
  const isFailed = task.state === "failed";
  const candidates = task.result?.candidates ?? [];
  const notes = task.input?.notes?.trim() ?? "";
  const query = QUERY_EXPERT_SLUGS.has(task.expertSlug) ? task.input?.query?.trim() ?? "" : "";
  const succeeded = task.state === "succeeded";
  const subject = query || task.input?.companyName || task.input?.region || notes.split("\n")[0];

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-5 border-b border-line-soft pb-5">
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="任务导航">
        <Button asChild variant="outline" size="sm"><IntentLink to="/account/artifacts"><ArrowLeft size={14} aria-hidden="true" />我的任务与产物</IntentLink></Button>
        <Button asChild variant="ghost" size="sm"><IntentLink to="/experts">专家平台</IntentLink></Button>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">
          <IntentLink to={`/experts/${encodeURIComponent(task.expertSlug)}`} className="underline-offset-4 hover:underline">{task.expertName}</IntentLink>
        </h1>
        <Badge variant={EXPERT_TASK_STATE_VARIANTS[task.state] ?? "secondary"}>{EXPERT_TASK_STATE_LABELS[task.state] ?? task.state}</Badge>
      </div>
      {subject && <p className="mt-2 break-words text-sm text-ink-2">{subject}</p>}
      <p className="mt-2 text-xs text-ink-3">到期清理 {when(task.expiresAt)}</p>
      {succeeded && <div className="mt-3 flex flex-wrap gap-2">
        {task.hasArtifact && <Button asChild variant="outline" size="sm"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}><Download size={14} aria-hidden="true" />{artifactDownloadLabel(task.expertSlug)}</a></Button>}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
      </div>}
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid min-w-0 gap-6">
      {isFailed && <Alert variant="destructive">
        <p className="font-medium">任务未完成</p>
        <p className="mt-1">{EXPERT_TASK_ERROR_LABELS[task.errorCode ?? ""] ?? task.errorMessage ?? "任务未完成，请重试。"}</p>
      </Alert>}

      {succeeded && task.result?.panorama?.incomplete && <Alert>
        结果不完整：{task.result.panorama.gapCount} 项核实缺口{task.result.panorama.limits.length ? `；达到上限：${task.result.panorama.limits.join("、")}` : ""}。请先查看报告中的缺口与未覆盖关系。
      </Alert>}

      {task.state === "waiting_input" && <section className="grid gap-2" aria-label="选择企业主体">
            <p className="text-sm">请选择正确的企业主体，确认后系统才会继续：</p>
            {task.result?.approximate && <p className="text-xs text-ink-3">未匹配到完全一致的名称，以下为近似候选，请确认主体后再继续。</p>}
            {candidates.length === 0 && <p className="text-sm text-ink-3">没有可选主体，请回到专家页重新提交。</p>}
            {candidates.map(candidate => <Button key={candidate.id} type="button" variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal px-3 py-3 text-left" onClick={() => void selectEntity(candidate.id)}><span><span className="flex flex-wrap items-center gap-2 font-medium">{candidate.name}{companyRelationLabel(candidate, candidates, task.result?.query ?? task.input?.companyName ?? task.input?.query ?? "", task.result?.approximate) && <Badge variant="secondary">{companyRelationLabel(candidate, candidates, task.result?.query ?? task.input?.companyName ?? task.input?.query ?? "", task.result?.approximate)}</Badge>}</span><span className="mt-1 block text-xs font-normal text-ink-3">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span></span></Button>)}
      </section>}

      {succeeded ? <section className="min-w-0" aria-label="任务结果">
        {task.result?.format === "html" && task.result.html
          ? <iframe title={`${task.expertName}报告`} srcDoc={task.result.html} sandbox="" className="h-[720px] w-full rounded-card border border-line bg-white" />
          : task.result?.preview
            ? <><p className="mb-2 text-xs text-ink-3">内容预览，完整产物请下载。</p><pre className="whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3 text-xs leading-relaxed text-ink-2">{task.result.preview}</pre></>
            : <p className="text-sm text-ink-3">任务已完成，{task.hasArtifact ? "产物可下载。" : "没有可显示的结果。"}</p>}
      </section> : task.state !== "waiting_input" && <p className="text-sm text-ink-3">{active ? `任务进行中，当前步骤：${EXPERT_TASK_STAGE_LABELS[task.stage] ?? task.stage}。` : "任务没有产出结果。"}</p>}

      {!succeeded && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
        {task.hasArtifact && <Button asChild variant="outline" size="sm"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}><Download size={14} aria-hidden="true" />{artifactDownloadLabel(task.expertSlug)}</a></Button>}
        {isFailed && (task.selectedEntity ? task.confirmedAttempts : task.executionAttempts) < 3 && <Button type="button" variant="outline" disabled={busy} onClick={() => void act("retry")}><RotateCcw size={14} aria-hidden="true" />重试</Button>}
        {active && <Button type="button" variant="ghost" disabled={busy} onClick={() => void act("cancel")}><XCircle size={14} aria-hidden="true" />取消任务</Button>}
      </div>}

      <details className="border-t border-line-soft pt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">任务信息</summary>
        <div className="grid gap-3 pt-2 text-ink-2">
          {task.input?.companyName ? <p className="break-words">核查主体：{task.input.companyName}</p> : null}
          {query ? <p className="break-words">查询：{query}</p> : null}
          {notes ? <p className="whitespace-pre-wrap break-words">任务要求：{notes}</p> : null}
          {task.input?.region ? <p className="break-words">地区：{task.input.region} · 报告期：{task.input.startDate ?? "未提供"} 至 {task.input.endDate ?? "未提供"}</p> : null}
          {task.input?.stockCodes?.length ? <p className="break-words">证券代码：{task.input.stockCodes.join("、")}</p> : null}
          {!task.input?.companyName && !query && !task.input?.region && !notes ? <p className="text-ink-3">没有填写输入内容。</p> : null}
          <p className="text-xs text-ink-3">任务编号 {task.id} · 创建 {when(task.createdAt)} · 更新 {when(task.updatedAt)}</p>
          <p className="text-xs text-ink-3">步骤：{EXPERT_TASK_STAGE_LABELS[task.stage] ?? task.stage} · {task.selectedEntity ? `检索尝试 ${task.executionAttempts - task.confirmedAttempts}/3 · 执行尝试 ${task.confirmedAttempts}/3` : task.state === "waiting_input" ? `检索尝试 ${task.executionAttempts}/3` : `执行尝试 ${task.executionAttempts}/3`}</p>
        </div>
      </details>

      {task.materials.length > 0 && <section className="border-t border-line-soft pt-5" aria-label="任务材料">
        <h2 className="mb-3 text-sm font-medium text-ink">任务材料</h2>
        <div className="grid gap-2 text-sm">
            {task.materials.map(material => <div key={material.id} className="flex flex-wrap items-center gap-2">
              {task.state === "cancelled" ? <span>{material.filename}</span> : <a className="text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/materials/${material.id}`}>{material.filename}</a>}
              <span className="text-xs text-ink-3">{Math.ceil(material.byteSize / 1024)} KB · {material.extractionStatus === "available" ? "已用于任务" : material.extractionStatus === "unavailable" ? "无法提取文字" : "等待处理"}</span>
              {terminal && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteMaterial(material.id)}><Trash2 size={14} aria-hidden="true" />删除</Button>}
            </div>)}
        </div>
      </section>}
    </div>
  </main>;
}
