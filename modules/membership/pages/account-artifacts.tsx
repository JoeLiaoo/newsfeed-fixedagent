import { useEffect, useState } from "react";
import { Download, FileText, ChevronRight } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { beijingStamp } from "@aihot/contracts/time";
import { TASK_STAGE_TEXT, TASK_STATE_TEXT, TASK_STATE_VARIANT, TASK_STATES_RUNNING } from "../experts/task-state.ts";

export const handle: Screen = { tab: "me", name: "我的任务与产物" };
export const meta = () => pageMeta({ title: "我的任务与产物", path: "/account/artifacts", noindex: true });

type Material = { id: string; filename: string; byteSize: number; extractionStatus: string };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string;
  input: { companyName: string | null; query: string | null; notes: string; notesTruncated: boolean };
  createdAt: string; updatedAt: string; hasArtifact: boolean;
  materials: Material[];
};
type Page = { tasks: Task[]; pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null } };

/** How many task records one page of the library carries. */
const PAGE_SIZE = 20;

/** The groups the reader filters by; each names the states it covers. */
const FILTERS = [
  { id: "", label: "全部" },
  { id: "queued,waiting_input,running", label: "进行中" },
  { id: "succeeded", label: "已完成" },
  { id: "failed", label: "失败" },
  { id: "cancelled", label: "已取消" },
];

/** My own task records and the products they left behind, across every expert. */
export default function AccountArtifactsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filter) query.set("state", filter);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/membership/expert-tasks?${query.toString()}`);
        if (response.status === 401) { location.href = "/login"; return; }
        if (!response.ok) throw new Error("request_failed");
        const data = await response.json() as Page;
        if (!current) return;
        setTasks(data.tasks);
        setNextOffset(data.pagination.nextOffset ?? null);
      } catch {
        if (current) setError("任务与产物暂时无法加载，请重试。");
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [offset, filter, reload]);

  function turn(next: number) {
    setOffset(Math.max(0, next));
  }

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">我的任务与产物</h1>
    </header>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="任务状态">
      {FILTERS.map(entry => <Button key={entry.label} type="button" size="sm" variant={filter === entry.id ? "default" : "outline"} aria-pressed={filter === entry.id}
        onClick={() => { setFilter(entry.id); setOffset(0); }}>{entry.label}</Button>)}
    </div>
    {error && <Alert role="alert" className="mb-5">{error} <Button type="button" size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>重试</Button></Alert>}
    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载任务与产物…</p>
      : tasks.length
        ? <ul className="grid gap-4">{tasks.map(task => <li key={task.id}>
          <Card className="grid gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <IntentLink to={`/experts/${encodeURIComponent(task.expertSlug)}`} className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-4 hover:underline">
                {task.expertName}<ChevronRight size={14} aria-hidden="true" className="text-ink-3" />
              </IntentLink>
              <Badge variant={TASK_STATE_VARIANT[task.state] ?? "secondary"}>{TASK_STATE_TEXT[task.state] ?? task.state}</Badge>
            </div>
            <p className="text-xs text-ink-3">提交 {beijingStamp(task.createdAt)} · 更新 {beijingStamp(task.updatedAt)}{TASK_STATES_RUNNING.includes(task.state) ? ` · ${TASK_STAGE_TEXT[task.stage] ?? task.stage}` : ""}</p>
            {(task.input.companyName || task.input.query || task.input.notes) && <p className="text-sm text-ink-2">
              {task.input.companyName || task.input.query || task.input.notes}{task.input.notesTruncated ? "…" : ""}
            </p>}
            {task.materials.length > 0 && <ul className="grid gap-1 text-sm">
              {task.materials.map(material => <li key={material.id} className="flex flex-wrap items-center gap-2">
                <a className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/materials/${material.id}`}>
                  <FileText size={14} aria-hidden="true" />{material.filename}
                </a>
                <span className="text-xs text-ink-3">{Math.ceil(material.byteSize / 1024)} KB · {material.extractionStatus === "available" ? "已用于任务" : material.extractionStatus === "unavailable" ? "无法提取文字" : "等待处理"}</span>
              </li>)}
            </ul>}
            <div className="flex flex-wrap gap-3">
              {task.hasArtifact && <a className="inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>
                <Download size={14} aria-hidden="true" />下载 Markdown 产物
              </a>}
            </div>
          </Card>
        </li>)}</ul>
        : <p className="text-sm text-ink-3">{offset > 0 ? "这一页没有任务记录，可回到上一页查看。" : "还没有任务记录。到专家平台提交任务后，运行记录和产物会出现在这里。"}</p>}
    <div className="mt-5 flex items-center justify-between border-t border-line-soft pt-3 text-sm text-ink-3">
      <span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={loading || offset === 0} onClick={() => turn(offset - PAGE_SIZE)}>上一页</Button>
        <Button type="button" size="sm" variant="outline" disabled={loading || nextOffset === null} onClick={() => turn(nextOffset ?? offset)}>下一页</Button>
      </div>
    </div>
  </main>;
}
