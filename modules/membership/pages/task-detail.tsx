import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { ArrowLeft, Download, FileText, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS, PANORAMA_EXPERT_SLUG } from "../experts/catalog.ts";
import { companyRelationLabel } from "../experts/data.ts";

export const handle: Screen = { tab: "me", name: "任务" };
export const meta = () => pageMeta({ title: "任务详情", path: "/tasks", noindex: true });

type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null; typeName?: string | null; branchOf?: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string; notes?: string };
  result: { candidates?: Candidate[]; preview?: string; approximate?: boolean; query?: string; panorama?: { incomplete: boolean; gapCount: number; limits: string[] } } | null;
  errorCode: string | null; errorMessage: string | null; executionAttempts: number;
  createdAt: string; updatedAt: string; expiresAt: string; hasArtifact: boolean; hasCheckpoint: boolean;
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

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><IntentLink to="/experts"><ArrowLeft size={14} aria-hidden="true" />专家平台</IntentLink></Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">
          <IntentLink to={`/experts/${encodeURIComponent(task.expertSlug)}`} className="underline-offset-4 hover:underline">{task.expertName}</IntentLink>
        </h1>
        <Badge variant={EXPERT_TASK_STATE_VARIANTS[task.state] ?? "secondary"}>{EXPERT_TASK_STATE_LABELS[task.state] ?? task.state}</Badge>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        步骤：{EXPERT_TASK_STAGE_LABELS[task.stage] ?? task.stage} · 创建 {when(task.createdAt)} · 更新 {when(task.updatedAt)} · 到期清理 {when(task.expiresAt)} · 执行尝试 {task.executionAttempts}/3
      </p>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>任务信息</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {task.input?.companyName ? <p className="text-ink-2">核查主体：{task.input.companyName}</p> : null}
          {notes ? <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-xs leading-relaxed text-ink-2">{notes}</p> : null}
          {!task.input?.companyName && !notes ? <p className="text-ink-3">没有填写输入内容。</p> : null}
          <p className="text-xs text-ink-3">任务编号 {task.id}</p>
        </CardContent>
      </Card>

      {isFailed && <Alert variant="destructive">
        <p className="font-medium">任务未完成</p>
        <p className="mt-1">{EXPERT_TASK_ERROR_LABELS[task.errorCode ?? ""] ?? task.errorMessage ?? "任务未完成，请重试。"}</p>
      </Alert>}

      {task.result?.panorama?.incomplete && <Alert>
        结果不完整：{task.result.panorama.gapCount} 项核实缺口{task.result.panorama.limits.length ? `；达到上限：${task.result.panorama.limits.join("、")}` : ""}。请先查看报告中的缺口与未覆盖关系。
      </Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>结果</CardTitle>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {task.state === "waiting_input" && <div className="grid gap-2">
            <p className="text-sm">请选择正确的企业主体，确认后系统才会继续：</p>
            {task.result?.approximate && <p className="text-xs text-ink-3">未匹配到完全一致的名称，以下为近似候选，请确认主体后再继续。</p>}
            {candidates.length === 0 && <p className="text-sm text-ink-3">没有可选主体，请回到专家页重新提交。</p>}
            {candidates.map(candidate => {
              const relation = companyRelationLabel(candidate, candidates, task.result?.query);
              return <Button key={candidate.id} type="button" variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal px-3 py-3 text-left" onClick={() => void selectEntity(candidate.id)}><span><span className="flex flex-wrap items-center gap-2 font-medium">{candidate.name}{relation && <Badge variant="secondary">{relation}</Badge>}</span><span className="mt-1 block text-xs font-normal text-ink-3">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span></span></Button>;
            })}
          </div>}
          {task.result?.preview && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-xs leading-relaxed text-ink-2">{task.result.preview}</pre>}
          {!task.result?.preview && task.state !== "waiting_input" && <p className="text-sm text-ink-3">{active ? `任务进行中，当前步骤：${EXPERT_TASK_STAGE_LABELS[task.stage] ?? task.stage}。` : task.state === "succeeded" ? "任务已完成，产物可下载。" : "任务没有产出结果。"}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>产物与材料</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {task.hasArtifact && <Button asChild variant="outline" size="sm"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}><Download size={14} aria-hidden="true" />下载 Markdown 产物</a></Button>}
            {task.expertSlug === PANORAMA_EXPERT_SLUG && task.hasCheckpoint && <Button asChild variant="outline" size="sm"><a href={`/api/v1/membership/expert-tasks/${task.id}/checkpoint`}><FileText size={14} aria-hidden="true" />下载采集台账 JSONL</a></Button>}
          </div>
          {task.materials.length === 0 ? <p className="text-sm text-ink-3">没有上传材料。</p> : <div className="grid gap-2 text-sm">
            {task.materials.map(material => <div key={material.id} className="flex flex-wrap items-center gap-2">
              {task.state === "cancelled" ? <span>{material.filename}</span> : <a className="text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/materials/${material.id}`}>{material.filename}</a>}
              <span className="text-xs text-ink-3">{Math.ceil(material.byteSize / 1024)} KB · {material.extractionStatus === "available" ? "已用于任务" : material.extractionStatus === "unavailable" ? "无法提取文字" : "等待处理"}</span>
              {terminal && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteMaterial(material.id)}><Trash2 size={14} aria-hidden="true" />删除</Button>}
            </div>)}
          </div>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {isFailed && task.executionAttempts < 3 && <Button type="button" variant="outline" disabled={busy} onClick={() => void act("retry")}><RotateCcw size={14} aria-hidden="true" />重试</Button>}
        {active && <Button type="button" variant="ghost" disabled={busy} onClick={() => void act("cancel")}><XCircle size={14} aria-hidden="true" />取消任务</Button>}
      </div>
    </div>
  </main>;
}
