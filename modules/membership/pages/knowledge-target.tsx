import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Download } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { renderMarkdown } from "@aihot/web/lib/markdown";
import { pageMeta, siteUrl } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "me", name: "知识页" };
export const meta = () => pageMeta({ title: "知识页", path: "/knowledge", noindex: true });

const ENDPOINT = "/api/v1/membership/knowledge/";
const PAGE_TYPE_LABEL: Record<string, string> = { view: "观点页", query: "预编译问答", concept: "判断框架", monitor: "监测指标" };
const FRESHNESS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { fresh: "success", semi: "warning", stale: "destructive", undated: "secondary" };

type Citation = { label: string; anchor: string | null; analyst: string | null; organization: string | null; publishedOn: string | null; sourceTitle: string | null; versionId: string; fileName: string; format: string; documentId: string; documentTitle: string };
type Issue = { level: string; category: string; target: string | null; message: string; evidence: string | null; detectedAt: string };
type PageDetail = {
  id: string; slug: string; pageType: string; targetType: string | null; targetName: string | null; track: string | null; status: string;
  revision: number; bodyMd: string; publishedAt: string; updatedAt: string; freshness: string; freshnessLabel: string;
  coverage: { analysts: number; firms: number; reports: number; first_report: string | null; last_report: string | null } | null;
};

/** The page body without its frontmatter, which the page shows as fields. */
function body(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  return end < 0 ? markdown : markdown.slice(end + 4);
}

export default function KnowledgeTargetPage() {
  const { slug } = useParams();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`${ENDPOINT}pages/${encodeURIComponent(slug ?? "")}`);
    if (!response.ok) { setMessage("知识页不存在或已下架。"); return; }
    const result = await response.json() as { page: PageDetail; citations: Citation[]; issues: Issue[] };
    setPage(result.page);
    setCitations(result.citations);
    setIssues(result.issues);
  }, [slug]);

  useEffect(() => { void load().catch(() => setMessage("加载失败，请刷新重试。")); }, [load]);

  if (!page) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">知识页</h1>
    {message && <Alert className="mt-4" role="status">{message}</Alert>}
    <p className="mt-4"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
  </main>;

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">{page.targetName ?? page.slug}</h1>
        <Badge variant="secondary">{PAGE_TYPE_LABEL[page.pageType] ?? page.pageType}</Badge>
        <Badge variant={FRESHNESS_VARIANT[page.freshness] ?? "secondary"}>{page.freshnessLabel}</Badge>
        {page.track && <Badge variant="outline">{page.track}</Badge>}
      </div>
      <p className="mt-2 text-xs text-ink-3">修订 {page.revision} · 分析师 {page.coverage?.analysts ?? 0} · 机构 {page.coverage?.firms ?? 0} · 材料 {page.coverage?.reports ?? 0} · {page.coverage?.first_report ?? "起始日期未知"} 至 {page.coverage?.last_report ?? "最近日期未知"} · 更新于 {new Date(page.updatedAt).toLocaleString("zh-CN")}</p>
      <p className="mt-1"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <Card className="mb-6">
      <CardContent className="pt-5">
        <div className="text-sm leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(body(page.bodyMd), siteUrl()).html }} />
      </CardContent>
    </Card>

    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>来源</CardTitle></CardHeader>
        <CardContent>
          {!citations.length ? <p className="text-sm text-ink-3">本页没有可跳转的来源。</p> : <ul className="grid gap-2">{citations.map(citation => <li key={`${citation.versionId}-${citation.label}-${citation.analyst ?? ""}`} className="rounded-card border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink">[{citation.label}] {citation.sourceTitle ?? citation.documentTitle}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Link to={`/knowledge/documents/${citation.documentId}`} className="text-sm text-accent underline-offset-4 hover:underline">材料</Link>
                <Button asChild variant="outline" size="sm"><a href={`${ENDPOINT}versions/${citation.versionId}/original`}><Download size={14} aria-hidden="true" />原件</a></Button>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">{citation.analyst ?? "分析师未知"}{citation.organization ? ` · ${citation.organization}` : ""}{citation.publishedOn ? ` · ${citation.publishedOn}` : ""}{citation.anchor ? ` · ${citation.anchor}` : ""} · {citation.fileName}</p>
          </li>)}</ul>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>质量问题</CardTitle></CardHeader>
        <CardContent>
          {!issues.length ? <p className="text-sm text-ink-3">本页没有未决的质量问题。</p> : <ul className="grid gap-2">{issues.map((issue, index) => <li key={`${issue.target ?? "issue"}-${index}`} className="rounded-card border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={issue.level === "P0" ? "destructive" : issue.level === "P1" ? "warning" : "secondary"}>{issue.level}</Badge><span className="text-ink-3">{issue.category}</span></div>
            <p className="mt-1 text-ink">{issue.message}</p>
            {issue.evidence && <p className="mt-1 text-xs text-ink-3">{issue.evidence}</p>}
          </li>)}</ul>}
        </CardContent>
      </Card>
    </div>
  </main>;
}
