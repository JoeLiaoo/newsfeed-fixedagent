import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS } from "../experts/catalog.ts";

const EXPERT_TASK_PAGE_SIZE = 20;

export const handle: Screen = { tab: "me", name: "任务" };
export const meta = () => pageMeta({ title: "任务记录", path: "/tasks", noindex: true });

type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string;
  input: { companyName?: string; query?: string }; result: { query?: string } | null;
  errorCode: string | null; errorMessage: string | null; createdAt: string; executionAttempts: number;
  hasArtifact: boolean; hasCheckpoint: boolean;
};

function subject(task: Task) { return (task.result?.query ?? task.input.companyName ?? task.input.query ?? "").trim(); }
function timestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN"); }

/** A paged, employee-wide history of tasks across every available expert. */
export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (pageOffset: number) => {
    const response = await fetch(`/api/v1/membership/expert-tasks?limit=${EXPERT_TASK_PAGE_SIZE}&offset=${pageOffset}`, { headers: { accept: "application/json" } });
    if (response.status === 401) { location.href = "/login"; return; }
    if (!response.ok) throw new Error("tasks_load_failed");
    const data = await response.json() as { tasks: Task[]; pagination: { nextOffset: number | null } };
    setTasks(data.tasks);
    setNextOffset(data.pagination.nextOffset);
    setOffset(pageOffset);
    setError("");
  }, []);

  useEffect(() => { void load(0).catch(() => setError("任务记录加载失败，请重试。" )).finally(() => setLoading(false)); }, [load]);
  useEffect(() => {
    if (!tasks.some(task => ["queued", "running", "waiting_input"].includes(task.state))) return;
    const timer = setInterval(() => { void load(offset).catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [load, offset, tasks]);

  async function turn(next: number) {
    setPaging(true);
    try { await load(next); } catch { setError("任务记录加载失败，请重试。" ); }
    finally { setPaging(false); }
  }

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><IntentLink to="/experts"><ArrowLeft size={14} aria-hidden="true" />专家平台</IntentLink></Button>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">任务记录</h1>
    </header>
    {error && <Alert className="mb-4" variant="destructive" role="status">{error}</Alert>}
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>全部任务</CardTitle>
        <Button type="button" variant="outline" size="sm" disabled={paging} onClick={() => void turn(offset)}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-ink-3" role="status">正在加载任务记录…</p>
          : !tasks.length ? <div className="grid gap-3"><p className="text-sm text-ink-3">暂无任务记录。</p><Button asChild variant="outline" className="w-fit"><IntentLink to="/experts">前往专家平台</IntentLink></Button></div>
            : <div className="grid gap-3">{tasks.map(task => <article key={task.id} className="rounded-card border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold"><IntentLink to={`/tasks/${task.id}`} className="underline-offset-4 hover:underline">{task.expertName}</IntentLink></h2>
                <Badge variant={EXPERT_TASK_STATE_VARIANTS[task.state] ?? "secondary"}>{EXPERT_TASK_STATE_LABELS[task.state] ?? task.state}</Badge>
              </div>
              {subject(task) && <p className="mt-1 break-words text-sm text-ink-2">查询：{subject(task)}</p>}
              <p className="mt-2 text-xs text-ink-3">{EXPERT_TASK_STAGE_LABELS[task.stage] ?? task.stage} · {timestamp(task.createdAt)} · 执行尝试 {task.executionAttempts}/3</p>
              {task.state === "failed" && <p className="mt-2 text-sm text-danger">{EXPERT_TASK_ERROR_LABELS[task.errorCode ?? ""] ?? task.errorMessage ?? "任务未完成。"}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="link" className="h-8 px-0"><IntentLink to={`/tasks/${task.id}`}>查看任务</IntentLink></Button>
                {task.hasArtifact && <Button asChild variant="link" className="h-8 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>下载产物</a></Button>}
                {task.hasCheckpoint && <Button asChild variant="link" className="h-8 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/checkpoint`}>下载采集台账</a></Button>}
              </div>
            </article>)}</div>}
        {(nextOffset !== null || offset > 0) && <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={paging || offset === 0} onClick={() => void turn(Math.max(0, offset - EXPERT_TASK_PAGE_SIZE))}>上一页</Button>
          <span className="text-xs text-ink-3">第 {Math.floor(offset / EXPERT_TASK_PAGE_SIZE) + 1} 页</span>
          <Button type="button" variant="outline" size="sm" disabled={paging || nextOffset === null} onClick={() => void turn(nextOffset ?? offset)}>下一页</Button>
        </div>}
      </CardContent>
    </Card>
  </main>;
}
