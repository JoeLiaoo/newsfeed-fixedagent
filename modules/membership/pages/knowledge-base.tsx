import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ChevronDown, Download, FileUp, Link2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { FileInput } from "@aihot/web/components/member-ui/file-input";
import { Label } from "@aihot/web/components/member-ui/label";
import { renderMarkdown } from "@aihot/web/lib/markdown";
import { pageMeta, siteUrl } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { FRESHNESS_LABELS, TASK_ERRORS, TASK_STAGE_LABELS, TASK_STATE_LABELS, type FreshnessTier } from "../knowledge/catalog.ts";

export const handle: Screen = { tab: "knowledge", name: "知识库" };
export const meta = () => pageMeta({ title: "知识库", path: "/knowledge", noindex: true });

const ENDPOINT = "/api/v1/membership/knowledge/";
/** How many builds one page of the build list holds. */
const TASK_PAGE_SIZE = 20;
/** How many answers one page of the answer history holds. */
const ANSWER_PAGE_SIZE = 10;
/** What the page says when the library holds no published page at all. */
const NO_PUBLISHED_PAGES = "本库尚无已发布知识页，先上传材料并等待构建完成。";

type Base = { id: string; name: string; description: string; status: string; createdAt: string; updatedAt: string };
type Overview = {
  documents: number; versions: number; pages: number; queued: number; running: number; failed: number;
  openIssues: number; blockingIssues: number; namedAnalysts: number; myId: string;
  freshness: { fresh: number; semi: number; stale: number; undated: number };
};
type DocumentRow = {
  id: string; title: string; uploaderId: string; uploaderName: string; createdAt: string; versionNo: number;
  fileName: string; format: string; byteSize: number; sourceTitle: string | null; sourceAuthor: string | null; sourceOrg: string | null; sourceDate: string | null; sourceKind: string | null;
  sourceUrl: string | null;
  versionCreatedAt: string; freshness: FreshnessTier;
  extractionStatus: string; extractionNote: string | null; taskState: string | null; taskStage: string | null;
  errorCode: string | null; errorMessage: string | null;
};
type TaskRow = {
  id: string; stage: string; state: string; attemptCount: number; errorCode: string | null; errorMessage: string | null;
  createdAt: string; documentTitle: string; uploaderName: string; versionNo: number; fileName: string;
};
type PageRow = {
  slug: string; pageType: string; targetType: string | null; targetName: string | null; track: string | null;
  revision: number; coverage: { analysts: number; firms: number; reports: number; last_report: string | null } | null;
  citationCount: number; issueCount: number; freshness: string; freshnessLabel: string;
};
type AnswerCitation = {
  label: string; pageSlug: string; title: string; analyst: string | null; organization: string | null;
  publishedOn: string | null; anchor: string | null; citationId: string | null; versionId: string | null;
  documentId: string | null; documentTitle: string | null; fileName: string | null;
};
type Answer = {
  id: string; question: string; answerMd: string; citations: AnswerCitation[];
  coverage: { analysts: number; firms: number; reports: number; first_report: string | null; last_report: string | null };
  freshness: Array<{ pageSlug: string; tier: string | null; lastReport: string | null }>;
  createdAt?: string;
};

const PAGE_TYPE_LABEL: Record<string, string> = { view: "观点页", query: "预编译问答", concept: "判断框架", monitor: "监测指标" };
const FRESHNESS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { fresh: "success", semi: "warning", stale: "destructive", undated: "secondary" };
const STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { queued: "warning", running: "default", succeeded: "success", failed: "destructive", cancelled: "secondary" };

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

/** A source without a recorded material stays readable without inventing a link. */
function AnswerCitations({ citations }: { citations: AnswerCitation[] }) {
  if (!citations.length) return <p className="text-xs text-ink-3">这次回答没有可跳转的引用。</p>;
  return <ul className="grid gap-2">{citations.map((citation, index) => <li key={`${citation.pageSlug}-${citation.label}-${index}`} className="rounded-card border border-line p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-ink">[{citation.label}] <Link to={`/knowledge/targets/${encodeURIComponent(citation.pageSlug)}`} className="text-accent underline-offset-4 hover:underline">{citation.title || citation.pageSlug}</Link></span>
      <span className="flex flex-wrap items-center gap-2">
        {citation.documentId && <Link to={`/knowledge/documents/${encodeURIComponent(citation.documentId)}`} className="text-sm text-accent underline-offset-4 hover:underline">材料</Link>}
        {citation.versionId && <Button asChild variant="outline" size="sm"><a href={`${ENDPOINT}versions/${encodeURIComponent(citation.versionId)}/original`}><Download size={14} aria-hidden="true" />原件</a></Button>}
      </span>
    </div>
    <p className="mt-1 text-xs text-ink-3">{citation.analyst ?? "分析师未知"} · {citation.organization ?? "机构未知"} · {citation.publishedOn ?? "日期未知"}{citation.documentTitle ? ` · ${citation.documentTitle}` : ""}</p>
  </li>)}</ul>;
}

/** One knowledge base: its materials, the pages they built, and the answers it gives. */
export default function KnowledgeBasePage() {
  const { id } = useParams();
  const baseId = id ?? "";
  const [base, setBase] = useState<Base | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentNextOffset, setDocumentNextOffset] = useState<number | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [taskOffset, setTaskOffset] = useState(0);
  const [taskNextOffset, setTaskNextOffset] = useState<number | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageNextOffset, setPageNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerMessage, setAnswerMessage] = useState("");
  const [history, setHistory] = useState<Answer[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [openAnswerId, setOpenAnswerId] = useState<string | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const historyRead = useRef("");
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (term: string) => {
    const scope = encodeURIComponent(baseId);
    const [baseResponse, overviewResponse, documentsResponse, pagesResponse] = await Promise.all([
      fetch(`${ENDPOINT}bases/${scope}`),
      fetch(`${ENDPOINT}overview?baseId=${scope}`),
      fetch(`${ENDPOINT}documents?baseId=${scope}&query=${encodeURIComponent(term)}`),
      fetch(`${ENDPOINT}pages?baseId=${scope}&query=${encodeURIComponent(term)}`),
    ]);
    if (baseResponse.status === 401 || overviewResponse.status === 401) { location.href = "/login"; return; }
    if (baseResponse.status === 404 || overviewResponse.status === 404) { setMissing(true); setMessage("知识库不存在。"); return; }
    if (!baseResponse.ok || !overviewResponse.ok || !documentsResponse.ok || !pagesResponse.ok) throw new Error("knowledge_base_load_failed");
    setBase((await baseResponse.json() as { base: Base }).base);
    setOverview((await overviewResponse.json() as { overview: Overview }).overview);
    const documentResult = await documentsResponse.json() as { documents: DocumentRow[]; nextOffset: number | null };
    setDocuments(documentResult.documents);
    setDocumentNextOffset(documentResult.nextOffset);
    const pageResult = await pagesResponse.json() as { pages: PageRow[]; nextOffset: number | null };
    setPages(pageResult.pages);
    setPageNextOffset(pageResult.nextOffset);
  }, [baseId]);

  /** The builds of this base, one page at a time. */
  const loadTasks = useCallback(async () => {
    const response = await fetch(`${ENDPOINT}tasks?baseId=${encodeURIComponent(baseId)}&limit=${TASK_PAGE_SIZE}&offset=${taskOffset}`);
    if (!response.ok) return;
    const result = await response.json() as { tasks: TaskRow[]; nextOffset: number | null };
    setTasks(result.tasks);
    setTaskNextOffset(result.nextOffset);
  }, [baseId, taskOffset]);

  useEffect(() => { void Promise.all([load(search), loadTasks()]).catch(() => setMessage("加载失败，请刷新重试。")).finally(() => setLoading(false)); }, [load, loadTasks, search]);
  useEffect(() => { setHistoryOffset(0); }, [baseId]);
  const loadHistory = useCallback(async (offset: number) => {
    const read = `${baseId}:${offset}`;
    historyRead.current = read;
    const response = await fetch(`${ENDPOINT}answers?baseId=${encodeURIComponent(baseId)}&limit=${ANSWER_PAGE_SIZE}&offset=${offset}`);
    if (!response.ok) { if (historyRead.current === read) setHistoryFailed(true); return; }
    const result = await response.json() as { answers: Answer[]; pagination: { nextOffset: number | null } };
    if (historyRead.current !== read) return;
    setHistoryFailed(false);
    setHistory(result.answers);
    setHistoryNextOffset(result.pagination.nextOffset);
  }, [baseId]);
  useEffect(() => { void loadHistory(historyOffset).catch(() => setHistoryFailed(true)); }, [loadHistory, historyOffset, historyReload]);
  useEffect(() => {
    if (!tasks.some(task => task.state === "queued" || task.state === "running")) return;
    const timer = setInterval(() => { void loadTasks().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [tasks, loadTasks]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const picked = file;
    const url = sourceUrl.trim();
    if (!picked && !url) { setMessage("请选择文件或粘贴网页链接。"); return; }
    if (picked && url) { setMessage("请上传文件或添加网页链接，每次选择一种方式。"); return; }
    setBusy(true);
    setMessage("正在上传…");
    try {
      const response = url ? await fetch(`${ENDPOINT}documents/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseId, url }),
      }) : await fetch(`${ENDPOINT}documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseId,
          fileName: picked!.name,
          base64: await fileAsBase64(picked!),
        }),
      });
      const result = await response.json() as { duplicate?: boolean; message?: string; error?: string };
      if (!response.ok) { setMessage(result.message ?? result.error ?? "上传失败，请重试。"); return; }
      setMessage(result.duplicate ? result.message ?? "这份材料已在本库中，无需重复添加。" : url ? "链接已加入队列，正在读取网页并构建知识页。" : "材料已加入队列，正在构建知识页。");
      form.reset();
      setFile(null);
      setSourceUrl("");
      await Promise.all([load(search), loadTasks()]);
    } catch { setMessage("上传失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function retry(taskId: string) {
    setBusy(true);
    try {
      const response = await fetch(`${ENDPOINT}tasks/${taskId}/retry`, { method: "POST" });
      setMessage(response.ok ? "已重新提交构建。" : "该任务当前不可重试。");
      await Promise.all([load(search), loadTasks()]);
    } catch { setMessage("操作失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }

  async function loadMore(kind: "documents" | "pages") {
    const offset = kind === "documents" ? documentNextOffset : pageNextOffset;
    if (offset === null) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`${ENDPOINT}${kind}?baseId=${encodeURIComponent(baseId)}&query=${encodeURIComponent(search)}&offset=${offset}`);
      if (!response.ok) throw new Error("knowledge_list_failed");
      if (kind === "documents") {
        const result = await response.json() as { documents: DocumentRow[]; nextOffset: number | null };
        setDocuments(current => [...current, ...result.documents]);
        setDocumentNextOffset(result.nextOffset);
      } else {
        const result = await response.json() as { pages: PageRow[]; nextOffset: number | null };
        setPages(current => [...current, ...result.pages]);
        setPageNextOffset(result.nextOffset);
      }
    } catch { setMessage("加载更多失败，请重试。"); }
    finally { setLoadingMore(false); }
  }

  async function withdraw(documentId: string) {
    setBusy(true);
    try {
      const response = await fetch(`${ENDPOINT}documents/${documentId}/withdraw`, { method: "POST" });
      setMessage(response.ok ? "材料已从共享库撤回，由它生成的知识页同时下架。" : "撤回失败，请刷新后重试。");
      setWithdrawing(null);
      await Promise.all([load(search), loadTasks()]);
    } catch { setMessage("撤回失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim().length < 2) { setAnswerMessage("请输入要问的问题。"); return; }
    setBusy(true);
    setAnswer(null);
    setAnswerMessage("正在从共享库检索…");
    try {
      const response = await fetch(`${ENDPOINT}answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseId, question }) });
      const result = await response.json().catch(() => ({})) as { answer?: Answer; error?: string; message?: string };
      if (!response.ok) {
        setAnswerMessage(result.message ?? (result.error === "knowledge_base_not_found" ? "该知识库不存在或已停用，请返回知识库列表。" : result.error === "knowledge_no_coverage" ? TASK_ERRORS.knowledge_no_coverage : response.status === 404 ? "问答接口不可用，请联系管理员核对 API 发布版本。" : response.status === 401 ? "登录已失效，请重新登录后提问。" : "问答失败，请重试。"));
        return;
      }
      if (!result.answer) { setAnswerMessage("问答未返回结果，请重试。"); return; }
      setAnswer(result.answer);
      setAnswerMessage("");
      setMessage("");
      setHistoryOffset(0);
      setHistoryReload(token => token + 1);
      setOpenAnswerId(result.answer.id);
    } catch { setAnswerMessage("问答请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <p className="text-sm text-ink-3" role="status">正在加载知识库…</p>
  </main>;

  if (missing || !base) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">知识库</h1>
    <Alert className="mt-4" role="status">{message}</Alert>
    <p className="mt-4"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
  </main>;

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><Link to="/knowledge"><ArrowLeft size={14} aria-hidden="true" />知识库</Link></Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold tracking-tight text-ink">{base?.name ?? "知识库"}</h1>
      </div>
      {base?.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-3">{base.description}</p>}
      <Link to="#answers" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline"><MessageSquare size={15} aria-hidden="true" />问答记录</Link>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid gap-6">
      <Card id="ask" className="border-accent/30">
        <CardHeader><CardTitle>知识库问答</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={ask} className="grid gap-3">
            <div className="grid gap-2"><Label htmlFor="wiki-question">问题</Label><Input id="wiki-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder="例如：当前各机构对某标的的评级分歧在哪里？" /></div>
            <Button type="submit" disabled={busy}><MessageSquare size={16} aria-hidden="true" />{busy ? "检索中…" : "提问"}</Button>
          </form>
          {answerMessage && <Alert role="status">{answerMessage}</Alert>}
          {answer && <div className="grid gap-3">
            <div className="text-sm leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.answerMd, siteUrl()).html }} />
            <div className="grid gap-1 border-t border-line pt-3"><h3 className="text-sm font-semibold text-ink">参考资料</h3><AnswerCitations citations={answer.citations} /></div>
            <p className="text-xs text-ink-4">覆盖：分析师 {answer.coverage.analysts} · 机构 {answer.coverage.firms} · 材料 {answer.coverage.reports} · {answer.coverage.first_report ?? "起始日期未知"} 至 {answer.coverage.last_report ?? "最近日期未知"}</p>
          </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>添加材料</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={upload} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wiki-file">上传文件</Label>
              <FileInput key={sourceUrl.trim() ? "url-entry" : "file-entry"} id="wiki-file" name="file" accept=".pdf,.docx,.md,.markdown,.txt,application/pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} required={!sourceUrl.trim()} />
              <p className="text-xs text-ink-3">支持 PDF、DOCX、Markdown。标题与已标注的来源信息会从内容中提取；未能识别的仍显示未知。</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wiki-url">网页链接</Label>
              <Input id="wiki-url" type="url" inputMode="url" autoComplete="url" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); if (event.target.value) setFile(null); }} placeholder="https://…" />
            </div>
            <Button type="submit" disabled={busy}>{sourceUrl.trim() ? <Link2 size={16} aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}{busy ? "处理中…" : sourceUrl.trim() ? "添加网页" : "上传材料"}</Button>
          </form>
        </CardContent>
      </Card>

      <details className="rounded-card border border-line bg-surface text-ink shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-base font-semibold">构建状态</summary>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>处理进度</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => void Promise.all([load(search), loadTasks()])}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
        </CardHeader>
        <CardContent>
          {!tasks.length ? <p className="text-sm text-ink-3">暂无构建任务。</p> : <ul className="grid gap-3">{tasks.map(task => <li key={task.id} className="rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{task.documentTitle}</span>
              <Badge variant={STATE_VARIANT[task.state] ?? "secondary"}>{TASK_STATE_LABELS[task.state] ?? task.state}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-3">{task.state === "running" ? `${TASK_STAGE_LABELS[task.stage] ?? task.stage} · ` : ""}{new Date(task.createdAt).toLocaleString("zh-CN")}</p>
            {task.errorCode && <p className="mt-2 text-sm text-hot">{TASK_ERRORS[task.errorCode] ?? task.errorMessage ?? task.errorCode}</p>}
            {task.state === "failed" && task.attemptCount < 5 && <div className="mt-3"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retry(task.id)}>重试</Button></div>}
          </li>)}</ul>}
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm text-ink-3">
            <span>第 {Math.floor(taskOffset / TASK_PAGE_SIZE) + 1} 页</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={taskOffset === 0} onClick={() => setTaskOffset(Math.max(0, taskOffset - TASK_PAGE_SIZE))}>上一页</Button>
              <Button type="button" variant="outline" size="sm" disabled={taskNextOffset === null} onClick={() => setTaskOffset(taskNextOffset ?? taskOffset)}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </details>

      <details className="rounded-card border border-line bg-surface text-ink shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-base font-semibold">材料与知识页</summary>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>材料与知识页</CardTitle>
          <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
            <Input aria-label="检索共享库" value={query} onChange={event => setQuery(event.target.value)} placeholder="标的 / 来源 / 关键词" className="h-9 w-44" />
            <Button type="submit" variant="outline" size="sm"><Search size={14} aria-hidden="true" />检索</Button>
          </form>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">知识页 {pages.length}</h3>
            {!pages.length ? <p className="text-sm text-ink-3">暂无已发布的知识页。</p> : <ul className="grid gap-2">{pages.map(page => <li key={page.slug} className="rounded-card border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/knowledge/targets/${encodeURIComponent(page.slug)}`} className="font-medium text-ink underline-offset-4 hover:underline">{page.targetName ?? page.slug}</Link>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary">{PAGE_TYPE_LABEL[page.pageType] ?? page.pageType}</Badge>
                  <Badge variant={FRESHNESS_VARIANT[page.freshness] ?? "secondary"}>{page.freshnessLabel}</Badge>
                  {page.issueCount > 0 && <Badge variant="warning">质量问题 {page.issueCount}</Badge>}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-3">最近材料 {page.coverage?.last_report ?? "日期未知"}</p>
            </li>)}</ul>}
            {pageNextOffset !== null && <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore("pages")}>{loadingMore ? "加载中…" : "加载更多知识页"}</Button>}
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">材料 {documents.length}</h3>
            {!documents.length ? <p className="text-sm text-ink-3">共享库中还没有材料。</p> : <ul className="grid gap-2">{documents.map(document => <li key={document.id} className="rounded-card border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{document.title}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant={STATE_VARIANT[document.taskState ?? ""] ?? "secondary"}>{TASK_STATE_LABELS[document.taskState ?? ""] ?? "未构建"}</Badge>
                  <Badge variant={FRESHNESS_VARIANT[document.freshness] ?? "secondary"}>{FRESHNESS_LABELS[document.freshness] ?? "时效未知"}</Badge>
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-3">{document.sourceOrg ?? "机构未知"} · {document.sourceAuthor ?? "分析师未知"} · {document.sourceDate ?? "材料日期未知"} · {document.sourceKind ?? "类型未知"} · {document.uploaderName} · 入库 {new Date(document.versionCreatedAt).toLocaleString("zh-CN")}</p>
              {document.sourceUrl && <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-accent underline-offset-4 hover:underline">来源网页：{document.sourceUrl}</a>}
              {document.extractionStatus === "unavailable" && <p className="mt-1 text-xs text-hot">{document.extractionNote ?? "未能提取文本"}</p>}
              {document.errorCode && <p className="mt-1 text-xs text-hot">{TASK_ERRORS[document.errorCode] ?? document.errorMessage ?? document.errorCode}</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                <Link to={`/knowledge/documents/${document.id}`} className="text-sm text-accent underline-offset-4 hover:underline">材料详情</Link>
                {withdrawing === document.id
                  ? <span className="flex flex-wrap items-center gap-2 text-xs text-hot">撤回后该材料及其生成的知识页将从共享库下架，且不可恢复。<Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void withdraw(document.id)}>确认撤回</Button><Button type="button" variant="ghost" size="sm" onClick={() => setWithdrawing(null)}>取消</Button></span>
                  : document.uploaderId === overview?.myId
                    ? <button type="button" className="text-sm text-ink-3 underline-offset-4 hover:underline" onClick={() => setWithdrawing(document.id)}>撤回</button>
                    : null}
              </div>
            </li>)}</ul>}
            {documentNextOffset !== null && <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore("documents")}>{loadingMore ? "加载中…" : "加载更多材料"}</Button>}
          </div>
        </CardContent>
      </details>

      <Card id="answers">
        <CardHeader><CardTitle>问答记录</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {historyFailed ? <p className="text-sm text-ink-3">问答记录暂时读不到，请刷新重试。</p>
            : !history.length ? <p className="text-sm text-ink-3">还没有问答记录。</p>
            : <ul className="grid gap-2">{history.map(item => <li key={item.id} className="rounded-card border border-line p-3">
              <button type="button" aria-expanded={openAnswerId === item.id} className="flex w-full items-start justify-between gap-2 text-left"
                onClick={() => setOpenAnswerId(openAnswerId === item.id ? null : item.id)}>
                <span className="text-sm font-medium text-ink">{item.question}</span>
                <ChevronDown size={16} aria-hidden="true" className={`mt-0.5 shrink-0 text-ink-4 transition-transform duration-150 ${openAnswerId === item.id ? "rotate-180" : ""}`} />
              </button>
              <p className="mt-1 text-xs text-ink-3">{item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "时间未知"} · 分析师 {item.coverage.analysts} · 机构 {item.coverage.firms} · 材料 {item.coverage.reports}</p>
              {openAnswerId === item.id && <div className="mt-3 grid gap-3 border-t border-line pt-3">
                <div className="text-sm leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answerMd, siteUrl()).html }} />
                <div className="grid gap-1"><h3 className="text-sm font-semibold text-ink">参考资料</h3><AnswerCitations citations={item.citations} /></div>
              </div>}
            </li>)}</ul>}
          {history.length > 0 && <div className="flex items-center justify-between border-t border-line pt-3 text-sm text-ink-3">
            <span>第 {Math.floor(historyOffset / ANSWER_PAGE_SIZE) + 1} 页</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={historyOffset === 0}
                onClick={() => { setOpenAnswerId(null); setHistoryOffset(Math.max(0, historyOffset - ANSWER_PAGE_SIZE)); }}>上一页</Button>
              <Button type="button" variant="outline" size="sm" disabled={historyNextOffset === null}
                onClick={() => { setOpenAnswerId(null); setHistoryOffset(historyNextOffset ?? historyOffset); }}>下一页</Button>
            </div>
          </div>}
        </CardContent>
      </Card>
    </div>
  </main>;
}
