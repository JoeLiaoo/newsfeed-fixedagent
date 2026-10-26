import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { beijingStamp } from "@aihot/contracts/time";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { FileInput } from "@aihot/web/components/member-ui/file-input";
import { Label } from "@aihot/web/components/member-ui/label";
import { Textarea } from "@aihot/web/components/member-ui/textarea";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { COMING_SOON_EXPERT_STATUS, BUILTIN_SLUGS, EXPERT_STAGE_LABELS, FRONTIER_PODCAST_EXPERT_SLUG, HTML_PREVIEW_EXPERT_SLUGS, LISTED_FUND_PARTICIPATION_EXPERT_SLUG, PANORAMA_EXPERT_SLUG, SAMPLE_COMPANIES, SECTOR_PEER_EXPERT_SLUG, modeNeedsEntity, expertStatusBadge } from "../experts/catalog.ts";
import { companyRelationLabel, isBranchType } from "../experts/data.ts";
import { EXPERT_TASK_PAGE_SIZE } from "../experts/task-page.ts";
import { TASK_STATE_TEXT, TASK_STATE_VARIANT } from "../experts/task-state.ts";

export const handle: Screen = { tab: "me", name: "专家" };
export const meta = () => pageMeta({ title: "专家详情", path: "/experts", noindex: true });

type Expert = {
  slug: string; name: string; description: string; version: string; status: string;
  execution_mode: "xinhua_trial" | "xinhua_panorama" | "text_only" | "podcast_search" | "listed_fund_participation"; missing_dependencies: string[];
};
type Candidate = { id: string; name: string; status: string | null; creditCode: string | null; address: string | null; startDate: string | null; typeName?: string | null; branchOf?: string | null };
type Task = {
  id: string; expertSlug: string; expertName: string; state: string; stage: string; input: { companyName?: string | null; query?: string | null; region?: string; startDate?: string; endDate?: string; notes?: string; notesTruncated?: boolean };
  selectedEntity: { id?: string; name?: string; creditCode?: string | null } | null;
  result: { candidates?: Candidate[]; preview?: string; html?: string; format?: string; approximate?: boolean; query?: string; podcast?: { episodes: number; partial: boolean }; panorama?: { incomplete: boolean; gapCount: number; limits: string[] }; listedFund?: { incomplete: boolean; gaps: number; issuers: number; announcements: number } } | null; errorCode: string | null; errorMessage: string | null;
  createdAt: string; hasArtifact: boolean; executionAttempts: number;
  materials: Array<{ id: string; filename: string; byteSize: number; sha256: string; extractionStatus: string; extractionNote: string | null }>;
};

const ERROR_TEXT: Record<string, string> = {
  xinhua_not_configured: "企业信息查询服务尚未配置，请联系管理员。", xinhua_unavailable: "企业信息查询服务暂时不可用。", xinhua_tool_unavailable: "当前账号缺少所需工具，任务未完成。", xinhua_tool_failed: "企业信息查询未返回可用结果。", xinhua_no_candidates: "未匹配到该名称的企业主体，请核对登记名称或改用更短的关键词。", xinhua_entity_id_missing: "查询返回的主体缺少可核验的唯一标识，报告已停止。", xinhua_response_invalid: "查询返回内容无法解析，报告已停止。", xinhua_identity_unverified: "未能按唯一 ID 或完整信用代码核验主体，报告已停止。", xinhua_entity_mismatch: "查询返回的主体与所选企业不一致，报告已停止。", expert_execution_failed: "任务未完成，请检查配置后重试。",
};

/** What the employee typed, so a task in the list says which subject it is about. */
function taskSubject(task: Task) {
  return (task.result?.query ?? task.input.companyName ?? task.input.query ?? task.input.region ?? "").trim();
}

/** The reason a candidate is not the subject the employee had in mind, when the platform can tell. */
function branchNote(candidate: Candidate) {
  if (isBranchType(candidate.typeName)) return "该候选是分支机构，通常没有自己的对外投资记录";
  if (candidate.branchOf) return `该候选的登记名称建立在「${candidate.branchOf}」之上，可能是分支机构`;
  return null;
}

/** The error of a failed request: the API's own code when it gave one, its status when it did not. */
function submitErrorText(data: { error?: string; message?: string }, status: number) {
  if (data.error === "sector_query_required") return "请输入至少 2 个汉字或英文字母的企业或赛道名称。";
  if (data.error === "podcast_query_required") return "请输入 2 到 100 个字的话题。";
  if (data.error === "expert_dependencies_missing") return "该专家依赖尚未接入。";
  if (data.error === "expert_coming_soon") return "该专家仍在开发中，暂不接收任务。";
  if (data.error === "expert_task_rate_limited") return "任务并发或每小时提交上限已达到，请稍后重试。";
  if (data.error?.startsWith("expert_material_")) return "任务材料不符合要求，请使用有文字层的 PDF、DOCX、PPTX 或 UTF-8 Markdown，并检查大小。";
  if (data.error === "company_name_required") return "请填写至少 2 个字的目标企业名称。";
  if (data.error === "listed_fund_region_invalid") return "请填写省或市级行政区名称。";
  if (data.error === "listed_fund_year_invalid") return "年份须为 1990 年至今年之间的四位数字。";
  if (data.error === "listed_fund_date_range_invalid") return "请检查报告期的日期格式和先后顺序。";
  if (data.error === "listed_fund_stock_code_invalid" || data.error === "listed_fund_stock_code_duplicate") return "证券代码须为不重复的 6 位数字。";
  if (data.error === "api_unavailable") return "服务暂时不可用，请稍后重试；重试不会重复创建任务。";
  if (data.message) return data.message;
  return `任务提交失败（HTTP ${status}），请稍后重试；重试不会重复创建任务。`;
}

/** One expert: what it is, the task it takes, and the tasks it has run for this employee. */
export default function ExpertDetailPage() {
  const { slug } = useParams();
  const [expert, setExpert] = useState<Expert | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pageOffset, setPageOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [paging, setPaging] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [query, setQuery] = useState("");
  const [listedRegion, setListedRegion] = useState("浙江省");
  const [listedYear, setListedYear] = useState("");
  const [listedCodes, setListedCodes] = useState("");
  const [listedInputError, setListedInputError] = useState("");
  const listedRegionInput = useRef<HTMLInputElement>(null);
  const listedYearInput = useRef<HTMLInputElement>(null);
  const listedCodesInput = useRef<HTMLTextAreaElement>(null);
  const [queryError, setQueryError] = useState("");
  const queryInput = useRef<HTMLInputElement>(null);
  const [companyError, setCompanyError] = useState("");
  const companyInput = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // One submission carries one idempotency key: a retry after a gateway error returns the task the
  // first attempt may have created instead of starting a second one.
  const submitKey = useRef<{ signature: string; key: string } | null>(null);

  async function loadExpert() {
    const response = await fetch("/api/v1/membership/experts");
    if (!response.ok) { location.href = "/login"; return; }
    const data = await response.json() as { experts: Expert[] };
    setExpert(data.experts.find(entry => entry.slug === slug) ?? null);
  }

  /** Read one page of this expert's history; the server also scopes every row to the caller. */
  async function loadTasks(offset: number) {
    const response = await fetch(`/api/v1/membership/expert-tasks?expertSlug=${encodeURIComponent(slug ?? "")}&limit=${EXPERT_TASK_PAGE_SIZE}&offset=${offset}`);
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
    event.preventDefault();
    if (slug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG) {
      if (listedRegion.trim().length < 2) {
        setListedInputError("请填写省或市级行政区名称。");
        listedRegionInput.current?.focus();
        return;
      }
      const codes = listedCodes.trim() ? listedCodes.trim().split(/[\s,，;；]+/).filter(Boolean) : [];
      if (codes.some(code => !/^\d{6}$/.test(code)) || new Set(codes).size !== codes.length) {
        setListedInputError("证券代码须为不重复的 6 位数字。");
        listedCodesInput.current?.focus();
        return;
      }
      if (listedYear && (!/^\d{4}$/.test(listedYear) || Number(listedYear) < 1990 || Number(listedYear) > new Date().getFullYear())) {
        setListedInputError("年份须为 1990 年至今年之间的四位数字。");
        listedYearInput.current?.focus();
        return;
      }
    }
    setListedInputError("");
    if (slug === SECTOR_PEER_EXPERT_SLUG && [...query.trim()].filter(char => /[\p{Script=Han}\p{Script=Latin}]/u.test(char)).length < 2) {
      setQueryError("请输入至少 2 个汉字或英文字母的企业或赛道名称。");
      queryInput.current?.focus();
      return;
    }
    if (slug === FRONTIER_PODCAST_EXPERT_SLUG && [...query.trim()].filter(char => /[\p{Script=Han}\p{Script=Latin}\p{Nd}]/u.test(char)).length < 2) {
      setQueryError("请输入至少 2 个汉字、英文字母或数字的话题。");
      queryInput.current?.focus();
      return;
    }
    setQueryError("");
    if (modeNeedsEntity(expert?.execution_mode ?? "") && companyName.trim().length < 2) {
      setCompanyError("请填写至少 2 个字的目标企业名称。");
      companyInput.current?.focus();
      return;
    }
    setCompanyError("");
    setBusy(true); setMessage("任务已提交…");
    try {
      if (files.length > 3 || files.some(file => file.size > 5 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) { setMessage("最多上传 3 个文件，单个不超过 5 MB，总计不超过 10 MB。"); return; }
      const materials = await Promise.all(files.map(async file => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return { fileName: file.name, base64: btoa(binary) };
      }));
      const signature = JSON.stringify({ slug, companyName, query, listedRegion, listedYear, listedCodes, notes, materials: materials.map(material => material.fileName) });
      if (submitKey.current?.signature !== signature) submitKey.current = { signature, key: crypto.randomUUID() };
      const response = await fetch("/api/v1/membership/expert-tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": submitKey.current.key }, body: JSON.stringify({ slug, companyName, query, ...(slug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG ? { region: listedRegion, year: listedYear || undefined, stockCodes: listedCodes } : {}), notes, materials }) });
      const raw = await response.text();
      let data: { error?: string; message?: string } = {};
      try { data = JSON.parse(raw) as { error?: string; message?: string }; } catch { data = {}; }
      if (!response.ok) { setMessage(submitErrorText(data, response.status)); return; }
      submitKey.current = null;
      setCompanyName(""); setQuery(""); setListedYear(""); setListedCodes(""); setNotes(""); setFiles([]); setMessage("任务已进入队列。离开此页不会中断任务。"); await load(0);
    } catch { setMessage("任务提交请求失败，请检查网络后重试；重试不会重复创建任务。"); }
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
      <p className="mb-3"><IntentLink to="/account/artifacts" className="text-sm text-accent underline-offset-4 hover:underline">查看全部任务与产物</IntentLink></p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">{expert?.name ?? "专家"}</h1>
        {(expert.status !== "available" || expert.slug === SECTOR_PEER_EXPERT_SLUG) && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-3">{expert.description}</p>
      {expert.missing_dependencies.length > 0 && <p className="mt-1 text-xs text-amber-ink">缺少依赖：{expert.missing_dependencies.join("、")}</p>}
    </header>
    {expert.status === COMING_SOON_EXPERT_STATUS && <Alert className="mb-5" role="status">数据源接入中，暂不能提交任务。</Alert>}
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid gap-6">
      {expert && expert.status === "available" && <Card>
        <CardHeader><CardTitle>提交任务</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            {slug === SECTOR_PEER_EXPERT_SLUG && <>
              <div className="grid gap-2"><Label htmlFor="sector-query">企业或赛道</Label><Input ref={queryInput} id="sector-query" name="query" required maxLength={200} value={query} aria-invalid={!!queryError} aria-describedby={queryError ? "sector-query-error" : "sector-query-hint"} onInvalid={() => setQueryError("请输入至少 2 个汉字或英文字母的企业或赛道名称。")} onChange={event => { setQuery(event.target.value); if (queryError) setQueryError(""); }} placeholder="例如：商业航天…" />{queryError && <p id="sector-query-error" className="text-sm text-hot" role="alert">{queryError}</p>}</div>
              <p id="sector-query-hint" className="text-xs leading-relaxed text-ink-3">输入企业或赛道即可。看板整理可公开检索并附来源的信息；没有可靠证据时会说明未披露或未检索到。</p>
              <div className="grid gap-2"><Label htmlFor="sector-notes">备注（可选）</Label><Textarea id="sector-notes" name="notes" maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={3} /></div>
            </>}
            {slug === FRONTIER_PODCAST_EXPERT_SLUG && <>
              <div className="grid gap-2"><Label htmlFor="podcast-query">话题</Label><Input ref={queryInput} id="podcast-query" name="query" required maxLength={100} value={query} aria-invalid={!!queryError} aria-describedby={queryError ? "podcast-query-error" : "podcast-query-hint"} onInvalid={() => setQueryError("请输入至少 2 个汉字、英文字母或数字的话题。")} onChange={event => { setQuery(event.target.value); if (queryError) setQueryError(""); }} placeholder="例如：具身智能、半导体…" />{queryError && <p id="podcast-query-error" className="text-sm text-hot" role="alert">{queryError}</p>}</div>
              <p id="podcast-query-hint" className="text-xs leading-relaxed text-ink-3">输入一个话题（2 到 100 字）。系统检索公开播客文字库，读取匹配节目的中文要点与摘要，结果以网页摘要呈现，并可下载 Markdown 产物。</p>
            </>}
            {slug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG && <>
              <div className="grid gap-2"><Label htmlFor="listed-region">省或市</Label><Input ref={listedRegionInput} id="listed-region" name="region" autoComplete="off" required maxLength={40} value={listedRegion} aria-invalid={!!listedInputError && listedRegion.trim().length < 2} aria-describedby={listedInputError ? "listed-input-error" : undefined} onChange={event => { setListedRegion(event.target.value); if (listedInputError) setListedInputError(""); }} placeholder="例如：浙江省、杭州市…" /></div>
              <div className="grid gap-2"><Label htmlFor="listed-year">年份（可选）</Label><Input ref={listedYearInput} id="listed-year" name="year" type="number" inputMode="numeric" autoComplete="off" min="1990" max={new Date().getFullYear()} value={listedYear} aria-invalid={!!listedInputError && !!listedYear} aria-describedby={listedInputError && listedYear ? "listed-input-error" : undefined} onChange={event => { setListedYear(event.target.value); if (listedInputError) setListedInputError(""); }} placeholder="默认近三个自然年…" /></div>
              <div className="grid gap-2"><Label htmlFor="listed-codes">证券代码（可选）</Label><Textarea ref={listedCodesInput} id="listed-codes" name="stockCodes" spellCheck={false} value={listedCodes} aria-invalid={!!listedInputError && !!listedCodes.trim()} aria-describedby={listedInputError ? "listed-input-error" : undefined} onChange={event => { setListedCodes(event.target.value); if (listedInputError) setListedInputError(""); }} rows={2} placeholder="多个代码用空格或逗号分隔，例如 600120 600126…" /></div>
              {listedInputError && <p id="listed-input-error" className="text-sm text-hot" role="alert">{listedInputError}</p>}
              <p className="text-xs leading-relaxed text-ink-3">不填代码时使用平台有限的地区样本，不代表当地全部上市公司。结果仅整理公开披露可得记录，并列出未核实和预算截断范围；不是全市场 LP 排名或完整工商穿透。</p>
            </>}
            {modeNeedsEntity(expert.execution_mode) ? <>
              <div className="grid gap-2"><Label htmlFor="company-name">目标企业名称</Label><Input ref={companyInput} id="company-name" required minLength={2} maxLength={200} value={companyName} aria-invalid={!!companyError} aria-describedby={companyError ? "company-name-error" : undefined} onInvalid={() => setCompanyError("请填写至少 2 个字的目标企业名称。")} onChange={event => { setCompanyName(event.target.value); if (companyError) setCompanyError(""); }} placeholder="输入待核查主体" />{companyError && <p id="company-name-error" className="text-sm text-hot" role="alert">{companyError}</p>}</div>
              <p className="text-xs leading-relaxed text-ink-3">示例：{SAMPLE_COMPANIES.join("；")}。系统先检索同名候选，须由你确认主体后才查询。{expert.execution_mode === "xinhua_panorama" ? "确认后逐层核查。默认预算为最多 4 层、25 个主体、90 次查询，每个主体最多处理 20 条关系；达到上限或遇到无法核实的数据时，报告会标明不完整并列出缺口。" : "当前仅生成一层直接投资底稿，不代表完整穿透。"}</p>
            </> : null}
            {expert.execution_mode === "text_only" && slug !== SECTOR_PEER_EXPERT_SLUG && slug !== FRONTIER_PODCAST_EXPERT_SLUG && <div className="grid gap-2"><Label htmlFor="task-notes">任务要求</Label><Textarea id="task-notes" required minLength={2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={5} /></div>}
            {modeNeedsEntity(expert.execution_mode) && <div className="grid gap-2"><Label htmlFor="task-notes">核查备注（内置专家可选）</Label><Textarea id="task-notes" required={!BUILTIN_SLUGS.has(slug ?? "")} minLength={BUILTIN_SLUGS.has(slug ?? "") ? undefined : 2} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} rows={4} /></div>}
            {slug !== SECTOR_PEER_EXPERT_SLUG && slug !== FRONTIER_PODCAST_EXPERT_SLUG && <div className="grid gap-2"><Label htmlFor="task-materials">任务材料（可选）</Label><FileInput id="task-materials" multiple accept=".pdf,.docx,.md,.markdown,.txt" onChange={event => setFiles(Array.from(event.target.files ?? []))} /><p className="text-xs text-ink-3">PDF、DOCX、Markdown；PPT 请先转换为 PDF。最多 3 个，单个 5 MB、总计 10 MB。材料与报告仅本人可访问，七天后清理。</p></div>}
            <Button type="submit" disabled={busy}>{busy ? "请稍候…" : "提交任务"}</Button>
          </form>
        </CardContent>
      </Card>}

      {expert && expert.status !== COMING_SOON_EXPERT_STATUS && <Card>
        <CardHeader className="flex-row items-center justify-between"><div><CardTitle>我的任务</CardTitle></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load(pageOffset)}>刷新</Button></CardHeader>
        <CardContent>
          {!tasks.length ? <p className="text-sm text-ink-3">{pageOffset > 0 ? "这一页没有任务记录，可回到上一页查看。" : "该专家还没有任务记录。提交任务后，运行记录与产物会显示在这里。"}</p> : <div className="grid gap-4">{tasks.map(task => <article key={task.id} className="rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{task.expertName}</h3><Badge variant={TASK_STATE_VARIANT[task.state] ?? "secondary"}>{TASK_STATE_TEXT[task.state] ?? task.state}</Badge></div>
            {taskSubject(task) && <p className="mt-1 break-words text-sm text-ink-2">查询：{taskSubject(task)}</p>}
            {task.selectedEntity?.name && <p className="mt-1 break-words text-xs text-ink-3">已确认主体：{task.selectedEntity.name}{task.selectedEntity.creditCode ? `（${task.selectedEntity.creditCode}）` : ""}</p>}
            <p className="mt-2 text-xs text-ink-3">{EXPERT_STAGE_LABELS[task.stage] ?? task.stage} · {beijingStamp(task.createdAt)} · 执行尝试 {task.executionAttempts}/3 · 到期后自动清理</p>
            {task.errorMessage && <Alert className="mt-3" variant="destructive">{task.errorMessage ?? ERROR_TEXT[task.errorCode ?? ""] ?? task.errorCode}</Alert>}
            {task.expertSlug === PANORAMA_EXPERT_SLUG && task.state === "succeeded" && task.result?.panorama?.incomplete && <Alert className="mt-3">结果不完整：{task.result.panorama.gapCount} 项核实缺口{task.result.panorama.limits.length ? `；达到上限：${task.result.panorama.limits.join("、")}` : ""}。请先查看报告中的缺口与未覆盖关系。</Alert>}
            {task.state === "waiting_input" && <div className="mt-4 grid gap-2"><p className="text-sm">请选择正确的工商主体，确认后系统才会继续：</p>{task.result?.approximate && <p className="text-xs text-ink-3">未找到名称包含「{taskSubject(task)}」的登记主体，以下为近似候选。</p>}{task.result?.candidates?.map(candidate => <Button key={candidate.id} type="button" variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal px-3 py-3 text-left" onClick={() => void selectEntity(task.id, candidate.id)}><span><span className="flex flex-wrap items-center gap-2 font-medium">{candidate.name}{companyRelationLabel(candidate, task.result?.candidates ?? [], taskSubject(task), task.result?.approximate) && <Badge variant="secondary">{companyRelationLabel(candidate, task.result?.candidates ?? [], taskSubject(task), task.result?.approximate)}</Badge>}</span><span className="mt-1 block text-xs font-normal text-ink-3">{candidate.status ?? "状态未知"} · {candidate.address ?? "地址未提供"} · {candidate.creditCode ?? "统一代码未提供"}</span>{branchNote(candidate) && <span className="mt-1 block text-xs font-normal text-ink-3">{branchNote(candidate)}</span>}</span></Button>)}</div>}
            {task.result?.preview && <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-xs text-ink-2">{task.result.preview}</pre>}
            {task.expertSlug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG && task.result?.listedFund?.incomplete && <Alert className="mt-3">结果存在 {task.result.listedFund.gaps} 项核实缺口；请查看报告中的范围与未核事项。</Alert>}
            {HTML_PREVIEW_EXPERT_SLUGS.has(task.expertSlug) && task.result?.format === "html" && task.result.html && <div className="mt-4"><p className="mb-2 break-words text-sm font-medium">{task.expertSlug === SECTOR_PEER_EXPERT_SLUG ? "网页看板" : task.expertSlug === PANORAMA_EXPERT_SLUG ? "全景图报告" : task.expertSlug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG ? "基金参与报告" : "播客摘要"} · {task.input.region ?? task.input.query ?? task.input.companyName}{task.result.podcast ? ` · 收录 ${task.result.podcast.episodes} 集` : ""}</p><iframe title={`${task.expertSlug === SECTOR_PEER_EXPERT_SLUG ? "赛道同业竞争看板" : task.expertSlug === PANORAMA_EXPERT_SLUG ? "对外投资全景图" : task.expertSlug === LISTED_FUND_PARTICIPATION_EXPERT_SLUG ? "地区上市公司基金参与" : "前沿播客"}：${task.input.region ?? task.input.query ?? task.input.companyName ?? "查询"}`} srcDoc={task.result.html} sandbox="" className="h-[680px] w-full rounded-card border border-line bg-white" /></div>}
            {task.materials?.length > 0 && <div className="mt-3 text-sm">{task.materials.map(material => <div key={material.id} className="flex flex-wrap items-center gap-2">{task.state === "cancelled" ? <span>{material.filename}</span> : <a className="text-accent underline-offset-4 hover:underline" href={`/api/v1/membership/expert-tasks/${task.id}/materials/${material.id}`}>{material.filename}</a>}<span className="text-xs text-ink-3">{Math.ceil(material.byteSize / 1024)} KB · {material.extractionStatus === "available" ? "已用于任务" : material.extractionStatus === "unavailable" ? "无法提取文字" : "等待处理"}</span>{["succeeded", "failed", "cancelled"].includes(task.state) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteMaterial(task.id, material.id)}>删除</Button>}</div>)}</div>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="link" className="h-9 px-0"><IntentLink to={`/tasks/${task.id}`}>查看详情</IntentLink></Button>
              {task.hasArtifact && <Button asChild variant="link" className="h-9 px-0"><a href={`/api/v1/membership/expert-tasks/${task.id}/artifact`}>下载{task.expertSlug === SECTOR_PEER_EXPERT_SLUG ? " HTML 看板" : " Markdown 产物"}</a></Button>}
              {task.state === "failed" && task.executionAttempts < 3 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "retry")}>重试</Button>}
              {["queued", "running", "waiting_input"].includes(task.state) && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void taskAction(task.id, "cancel")}>取消</Button>}
            </div>
          </article>)}</div>}
          {(nextOffset !== null || pageOffset > 0) && <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={paging || pageOffset === 0} onClick={() => void turn(Math.max(0, pageOffset - EXPERT_TASK_PAGE_SIZE))}>上一页</Button>
            <span className="text-xs text-ink-3">第 {Math.floor(pageOffset / EXPERT_TASK_PAGE_SIZE) + 1} 页</span>
            <Button type="button" variant="outline" size="sm" disabled={paging || nextOffset === null} onClick={() => void turn(nextOffset ?? pageOffset)}>下一页</Button>
          </div>}
        </CardContent>
      </Card>}
    </div>
  </main>;
}
