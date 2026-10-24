import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, FileUp, MessageSquare, RefreshCw, Search } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { renderMarkdown } from "@aihot/web/lib/markdown";
import { pageMeta, siteUrl } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { FRESHNESS_LABELS, TASK_ERRORS, TASK_STAGE_LABELS, TASK_STATE_LABELS, type FreshnessTier } from "../knowledge/catalog.ts";

export const handle: Screen = { tab: "me", name: "知识库" };
export const meta = () => pageMeta({ title: "知识库", path: "/knowledge", noindex: true });

const ENDPOINT = "/api/v1/membership/knowledge/";

type Base = { id: string; name: string; description: string; status: string; createdAt: string; updatedAt: string };
type Overview = {
  documents: number; versions: number; pages: number; queued: number; running: number; failed: number;
  openIssues: number; blockingIssues: number; namedAnalysts: number; myId: string;
  freshness: { fresh: number; semi: number; stale: number; undated: number };
};
type DocumentRow = {
  id: string; title: string; uploaderId: string; uploaderName: string; createdAt: string; versionNo: number;
  fileName: string; format: string; byteSize: number; sourceTitle: string | null; sourceAuthor: string | null; sourceOrg: string | null; sourceDate: string | null; sourceKind: string | null;
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
type AnswerCitation = { label: string; pageSlug: string; title: string; analyst: string | null; organization: string | null; publishedOn: string | null; anchor: string | null };
type Answer = {
  id: string; question: string; answerMd: string; citations: AnswerCitation[];
  coverage: { analysts: number; firms: number; reports: number; first_report: string | null; last_report: string | null };
  freshness: Array<{ pageSlug: string; tier: string; lastReport: string | null }>;
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

/** One knowledge base: its materials, the pages they built, and the answers it gives. */
export default function KnowledgeBasePage() {
  const { id } = useParams();
  const baseId = id ?? "";
  const [base, setBase] = useState<Base | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentNextOffset, setDocumentNextOffset] = useState<number | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageNextOffset, setPageNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (term: string) => {
    const scope = encodeURIComponent(baseId);
    const [baseResponse, overviewResponse, documentsResponse, tasksResponse, pagesResponse] = await Promise.all([
      fetch(`${ENDPOINT}bases/${scope}`),
      fetch(`${ENDPOINT}overview?baseId=${scope}`),
      fetch(`${ENDPOINT}documents?baseId=${scope}&query=${encodeURIComponent(term)}`),
      fetch(`${ENDPOINT}tasks?baseId=${scope}`),
      fetch(`${ENDPOINT}pages?baseId=${scope}&query=${encodeURIComponent(term)}`),
    ]);
    if (!overviewResponse.ok) { location.href = "/login"; return; }
    if (!baseResponse.ok) { setMissing(true); setMessage("该知识库不存在，或你无权查看。"); setLoading(false); return; }
    setBase((await baseResponse.json() as { base: Base }).base);
    setOverview((await overviewResponse.json() as { overview: Overview }).overview);
    const documentResult = await documentsResponse.json() as { documents: DocumentRow[]; nextOffset: number | null };
    setDocuments(documentResult.documents);
    setDocumentNextOffset(documentResult.nextOffset);
    setTasks((await tasksResponse.json() as { tasks: TaskRow[] }).tasks);
    const pageResult = await pagesResponse.json() as { pages: PageRow[]; nextOffset: number | null };
    setPages(pageResult.pages);
    setPageNextOffset(pageResult.nextOffset);
  }, [baseId]);

  useEffect(() => { void load(search).catch(() => setMessage("加载失败，请刷新重试。")).finally(() => setLoading(false)); }, [load, search]);  useEffect(() => {
    if (!tasks.some(task => task.state === "queued" || task.state === "running")) return;
    const timer = setInterval(() => { void load(search).catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [tasks, load, search]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const picked = file;
    if (!picked) { setMessage("请选择要上传的材料文件。"); return; }
    setBusy(true);
    setMessage("正在上传…");
    try {
      const data = new FormData(form);
      const response = await fetch(`${ENDPOINT}documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseId,
          fileName: picked.name,
          base64: await fileAsBase64(picked),
          title: String(data.get("title") ?? ""),
          author: String(data.get("author") ?? ""),
          organization: String(data.get("organization") ?? ""),
          date: String(data.get("date") ?? ""),
          kind: String(data.get("kind") ?? ""),
          documentId: String(data.get("documentId") ?? ""),
        }),
      });
      const result = await response.json() as { duplicate?: boolean; message?: string; error?: string };
      if (!response.ok) { setMessage(result.message ?? result.error ?? "上传失败，请重试。"); return; }
      setMessage(result.duplicate ? "这份材料已在共享库中，未重复入库。" : "已进入共享库，正在构建知识页。");
      form.reset();
      setFile(null);
      await load(search);
    } catch { setMessage("上传失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function retry(taskId: string) {
    setBusy(true);
    try {
      const response = await fetch(`${ENDPOINT}tasks/${taskId}/retry`, { method: "POST" });
      setMessage(response.ok ? "已重新提交构建。" : "该任务当前不可重试。");
      await load(search);
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
      await load(search);
    } catch { setMessage("撤回失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim().length < 2) { setMessage("请输入要问的问题。"); return; }
    setBusy(true);
    setAnswer(null);
    setMessage("正在从共享库检索…");
    try {
      const response = await fetch(`${ENDPOINT}answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseId, question }) });
      const result = await response.json() as { answer?: Answer; error?: string; message?: string };
      if (!response.ok) { setMessage(result.message ?? "问答失败，请重试。"); return; }
      if (!result.answer) { setMessage("问答失败，请重试。"); return; }
      setAnswer(result.answer);
      setMessage("");
    } catch { setMessage("问答请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <p className="text-sm text-ink-3" role="status">正在加载知识库…</p>
  </main>;

  if (missing) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">知识库</h1>
    <Alert className="mt-4" role="status">{message}</Alert>
    <p className="mt-4"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
  </main>;

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6">
      <Button asChild variant="outline" size="sm" className="mb-4"><Link to="/knowledge"><ArrowLeft size={14} aria-hidden="true" />知识库</Link></Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold tracking-tight text-ink">{base?.name ?? "知识库"}</h1>
        <Badge variant="secondary">材料 {overview?.documents ?? 0}</Badge>
        <Badge variant="secondary">知识页 {overview?.pages ?? 0}</Badge>
        {(overview?.running ?? 0) + (overview?.queued ?? 0) > 0 && <Badge variant="warning">构建中 {(overview?.running ?? 0) + (overview?.queued ?? 0)}</Badge>}
        {(overview?.failed ?? 0) > 0 && <Badge variant="destructive">失败 {overview?.failed}</Badge>}
        {(overview?.openIssues ?? 0) > 0 && <Badge variant="warning">质量问题 {overview?.openIssues}</Badge>}
      </div>
      {base?.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-3">{base.description}</p>}
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>上传材料</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={upload} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wiki-file">文件</Label>
              <Input id="wiki-file" name="file" type="file" accept=".pdf,.docx,.pptx,.md,.markdown,.txt,application/pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="wiki-title">标题</Label><Input id="wiki-title" name="title" maxLength={200} placeholder="留空则用文件名" /></div>
              <div className="grid gap-2"><Label htmlFor="wiki-kind">材料类型</Label><Input id="wiki-kind" name="kind" maxLength={60} placeholder="研报 / 纪要 / 演示 / 笔记" /></div>
              <div className="grid gap-2"><Label htmlFor="wiki-author">作者</Label><Input id="wiki-author" name="author" maxLength={120} placeholder="未知" /></div>
              <div className="grid gap-2"><Label htmlFor="wiki-organization">机构</Label><Input id="wiki-organization" name="organization" maxLength={120} placeholder="未知" /></div>
              <div className="grid gap-2"><Label htmlFor="wiki-date">材料日期</Label><Input id="wiki-date" name="date" type="date" /></div>
              <div className="grid gap-2">
                <Label htmlFor="wiki-document">更新已有材料</Label>
                <select id="wiki-document" name="documentId" className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink shadow-sm">
                  <option value="">新建材料</option>
                  {documents.filter(document => document.uploaderId === overview?.myId).map(document => <option key={document.id} value={document.id}>{document.title}（v{document.versionNo}）</option>)}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={busy}><FileUp size={16} aria-hidden="true" />{busy ? "处理中…" : "上传并进入共享库"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>构建状态</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => void load(search)}><RefreshCw size={14} aria-hidden="true" />刷新</Button>
        </CardHeader>
        <CardContent>
          {!tasks.length ? <p className="text-sm text-ink-3">暂无构建任务。</p> : <ul className="grid gap-3">{tasks.map(task => <li key={task.id} className="rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{task.documentTitle}</span>
              <Badge variant={STATE_VARIANT[task.state] ?? "secondary"}>{TASK_STATE_LABELS[task.state] ?? task.state}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-3">{TASK_STAGE_LABELS[task.stage] ?? task.stage} · v{task.versionNo} · {task.fileName} · {task.uploaderName} · {new Date(task.createdAt).toLocaleString("zh-CN")} · 尝试 {task.attemptCount} 次</p>
            {task.errorCode && <p className="mt-2 text-sm text-hot">{TASK_ERRORS[task.errorCode] ?? task.errorMessage ?? task.errorCode}</p>}
            {task.state === "failed" && task.attemptCount < 5 && <div className="mt-3"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retry(task.id)}>重试</Button></div>}
          </li>)}</ul>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>共享库</CardTitle>
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
              <p className="mt-1 text-xs text-ink-3">v{page.revision} · 分析师 {page.coverage?.analysts ?? 0} · 机构 {page.coverage?.firms ?? 0} · 引用 {page.citationCount} · 最近材料 {page.coverage?.last_report ?? "日期未知"}</p>
            </li>)}</ul>}
            {pageNextOffset !== null && <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore("pages")}>{loadingMore ? "加载中…" : "加载更多知识页"}</Button>}
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">材料 {documents.length}</h3>
            {!documents.length ? <p className="text-sm text-ink-3">共享库中还没有材料。</p> : <ul className="grid gap-2">{documents.map(document => <li key={document.id} className="rounded-card border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{document.title}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary">v{document.versionNo}</Badge>
                  <Badge variant={STATE_VARIANT[document.taskState ?? ""] ?? "secondary"}>{TASK_STATE_LABELS[document.taskState ?? ""] ?? "未构建"}</Badge>
                  <Badge variant={FRESHNESS_VARIANT[document.freshness] ?? "secondary"}>{FRESHNESS_LABELS[document.freshness] ?? "时效未知"}</Badge>
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-3">{document.sourceOrg ?? "机构未知"} · {document.sourceAuthor ?? "分析师未知"} · {document.sourceDate ?? "材料日期未知"} · {document.sourceKind ?? "类型未知"} · {document.uploaderName} · 入库 {new Date(document.versionCreatedAt).toLocaleString("zh-CN")}</p>
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
      </Card>

      <Card>
        <CardHeader><CardTitle>问答</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={ask} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="wiki-question">问题</Label>
              <Input id="wiki-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder="例如：当前各机构对某标的的评级分歧在哪里？" />
            </div>
            <Button type="submit" variant="outline" disabled={busy}><MessageSquare size={16} aria-hidden="true" />{busy ? "检索中…" : "提问"}</Button>
          </form>
          {answer && <div className="grid gap-3">
            <div className="text-sm leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.answerMd, siteUrl()).html }} />
            <div className="grid gap-1 border-t border-line pt-3">
              <h3 className="text-sm font-semibold text-ink">参考资料</h3>
              {answer.citations.length ? <ul className="grid gap-1 text-xs text-ink-3">{answer.citations.map(citation => <li key={`${citation.pageSlug}-${citation.label}`}>
                [{citation.label}] <Link to={`/knowledge/targets/${encodeURIComponent(citation.pageSlug)}`} className="text-accent underline-offset-4 hover:underline">{citation.title}</Link>
                {citation.analyst ? ` · ${citation.analyst}` : ""}{citation.organization ? ` · ${citation.organization}` : ""}{citation.publishedOn ? ` · ${citation.publishedOn}` : ""}
              </li>)}</ul> : <p className="text-xs text-ink-3">本次回答没有可跳转的引用。</p>}
            </div>
            <p className="text-xs text-ink-4">覆盖：分析师 {answer.coverage.analysts} · 机构 {answer.coverage.firms} · 材料 {answer.coverage.reports} · {answer.coverage.first_report ?? "起始日期未知"} 至 {answer.coverage.last_report ?? "最近日期未知"}</p>
          </div>}
        </CardContent>
      </Card>
    </div>
  </main>;
}
