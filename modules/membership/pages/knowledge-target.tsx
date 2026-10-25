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
import { KnowledgeDetailSkeleton } from "./knowledge-detail-skeleton.tsx";
import { FRESHNESS_LABELS, type FreshnessTier } from "../knowledge/catalog.ts";

export const handle: Screen = { tab: "me", name: "知识页" };
export const meta = () => pageMeta({ title: "知识页", path: "/knowledge", noindex: true });

const ENDPOINT = "/api/v1/membership/knowledge/";
const PAGE_TYPE_LABEL: Record<string, string> = { view: "观点页", query: "预编译问答", concept: "判断框架", monitor: "监测指标" };
const FRESHNESS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { fresh: "success", semi: "warning", stale: "destructive", undated: "secondary" };

type Citation = { label: string; anchor: string | null; analyst: string | null; organization: string | null; publishedOn: string | null; sourceTitle: string | null; versionId: string; fileName: string; format: string; documentId: string; documentTitle: string };
type Material = { documentId: string; documentTitle: string; versionId: string; versionNo: number; fileName: string; sourceTitle: string | null; sourceAuthor: string | null; sourceOrg: string | null; sourceDate: string | null; sourceKind: string | null; versionCreatedAt: string; freshness: FreshnessTier };
type Revision = { revision: number; publishedAt: string; coverage: PageDetail["coverage"] };
type Issue = { level: string; category: string; target: string | null; message: string; evidence: string | null; detectedAt: string };
type RelatedPage = { slug: string; localSlug: string; targetName: string | null };
type PageDetail = {
  id: string; slug: string; pageType: string; targetType: string | null; targetName: string | null; track: string | null; status: string;
  baseId: string; revision: number; bodyMd: string; publishedAt: string; updatedAt: string; freshness: FreshnessTier; freshnessLabel: string;
  coverage: { analysts: number; firms: number; reports: number; first_report: string | null; last_report: string | null } | null;
};

/** The page body without its frontmatter, which the page shows as fields. */
function body(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  return end < 0 ? markdown : markdown.slice(end + 4);
}

function resolvedBody(markdown: string, related: RelatedPage[]): string {
  const bySlug = new Map(related.flatMap(page => [[page.slug, page], [page.localSlug, page]] as const));
  return body(markdown).replace(/\[([^\]]+)\]\(\/knowledge\/targets\/([^)]+)\)/g, (link, _label: string, slug: string) => {
    const page = bySlug.get(slug);
    if (!page) return link;
    const title = (page.targetName?.trim() || page.localSlug).replace(/[\[\]]/g, "");
    return `[${title}](/knowledge/targets/${encodeURIComponent(page.slug)})`;
  });
}

export default function KnowledgeTargetPage() {
  const { slug } = useParams();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [related, setRelated] = useState<RelatedPage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`${ENDPOINT}pages/${encodeURIComponent(slug ?? "")}`);
    if (!response.ok) { setMessage("知识页不存在或已下架。"); return; }
    const result = await response.json() as { page: PageDetail; citations: Citation[]; materials: Material[]; revisions: Revision[]; issues: Issue[]; related?: RelatedPage[] };
    setPage(result.page);
    setCitations(result.citations);
    setMaterials(result.materials);
    setRevisions(result.revisions);
    setIssues(result.issues);
    setRelated(result.related ?? []);
  }, [slug]);

  useEffect(() => { void load().catch(() => setMessage("加载失败，请刷新重试。")).finally(() => setLoading(false)); }, [load]);

  if (!page) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">知识页</h1>
    {loading && <KnowledgeDetailSkeleton kind="target" />}
    {message && <Alert className="mt-4" role="status">{message}</Alert>}
    <p className="mt-4"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
  </main>;

  const back = `/knowledge/bases/${encodeURIComponent(page.baseId)}`;

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">{page.targetName ?? page.slug}</h1>
        <Badge variant="secondary">{PAGE_TYPE_LABEL[page.pageType] ?? page.pageType}</Badge>
        <Badge variant={FRESHNESS_VARIANT[page.freshness] ?? "secondary"}>{page.freshnessLabel}</Badge>
        {page.track && <Badge variant="outline">{page.track}</Badge>}
      </div>
      <p className="mt-2 text-xs text-ink-3">修订 {page.revision} · 分析师 {page.coverage?.analysts ?? 0} · 机构 {page.coverage?.firms ?? 0} · 来源 {citations.length} · {page.coverage?.first_report ?? "起始日期未知"} 至 {page.coverage?.last_report ?? "最近日期未知"} · 更新于 {new Date(page.updatedAt).toLocaleString("zh-CN")}</p>
      <p className="mt-1"><Link to={back} className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <Card className="mb-6">
      <CardContent className="pt-5">
        <p className="mb-4 rounded-control border border-line bg-surface px-3 py-2 text-xs text-ink-3">观点按各份材料并列保留；质量问题仅提示归因或结构缺口，不代表观点对错，也不选出单一结论。</p>
        <div className="text-sm leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(resolvedBody(page.bodyMd, related), siteUrl()).html }} />
      </CardContent>
    </Card>

    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>材料时间线</CardTitle></CardHeader>
        <CardContent>
          {!materials.length ? <p className="text-sm text-ink-3">暂无有效材料。</p> : <ol className="grid gap-3">
            {materials.map(material => <li key={material.versionId} className="rounded-card border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{material.sourceTitle ?? material.documentTitle} · v{material.versionNo}</span>
                <Badge variant={FRESHNESS_VARIANT[material.freshness] ?? "secondary"}>{FRESHNESS_LABELS[material.freshness] ?? "时效未知"}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-3">{material.sourceOrg ?? "机构未知"} · {material.sourceAuthor ?? "分析师未知"} · {material.sourceDate ?? "材料日期未知"} · {material.sourceKind ?? "类型未知"}</p>
              <p className="mt-1 text-xs text-ink-4">{material.fileName} · 入库 {new Date(material.versionCreatedAt).toLocaleString("zh-CN")}</p>
              <Link to={`/knowledge/documents/${material.documentId}`} className="mt-2 inline-block text-sm text-accent underline-offset-4 hover:underline">查看材料版本</Link>
            </li>)}
          </ol>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>页面修订</CardTitle></CardHeader>
        <CardContent>
          {!revisions.length ? <p className="text-sm text-ink-3">暂无修订记录。</p> : <ol className="grid gap-2">{revisions.map(revision => <li key={revision.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line p-3 text-sm">
            <span className="font-medium text-ink">修订 {revision.revision}</span>
            <span className="text-xs text-ink-3">发布于 {new Date(revision.publishedAt).toLocaleString("zh-CN")} · 材料 {revision.coverage?.reports ?? 0} · 最近材料 {revision.coverage?.last_report ?? "日期未知"}</span>
          </li>)}</ol>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>观点来源</CardTitle></CardHeader>
        <CardContent>
          {!citations.length ? <p className="text-sm text-ink-3">本页没有可跳转的来源。</p> : <ul className="grid gap-2">{citations.map(citation => <li key={`${citation.versionId}-${citation.label}-${citation.analyst ?? ""}`} className="rounded-card border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink">[{citation.label}] {citation.sourceTitle ?? citation.documentTitle}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Link to={`/knowledge/documents/${citation.documentId}`} className="text-sm text-accent underline-offset-4 hover:underline">材料</Link>
                <Button asChild variant="outline" size="sm"><a href={`${ENDPOINT}versions/${citation.versionId}/original`}><Download size={14} aria-hidden="true" />原件</a></Button>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">{citation.analyst ?? "分析师未知"} · {citation.organization ?? "机构未知"} · {citation.publishedOn ?? "材料日期未知"}{citation.anchor ? ` · ${citation.anchor}` : ""} · {citation.fileName}</p>
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
