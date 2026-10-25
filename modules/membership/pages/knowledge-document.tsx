import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Download } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@aihot/web/components/member-ui/card";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { TASK_ERRORS, TASK_STAGE_LABELS, TASK_STATE_LABELS } from "../knowledge/catalog.ts";
import { KnowledgeDetailSkeleton } from "./knowledge-detail-skeleton.tsx";

export const handle: Screen = { tab: "me", name: "材料" };
export const meta = () => pageMeta({ title: "材料", path: "/knowledge", noindex: true });

const ENDPOINT = "/api/v1/membership/knowledge/";
const STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { queued: "warning", running: "default", succeeded: "success", failed: "destructive", cancelled: "secondary" };

type Version = {
  id: string; versionNo: number; fileName: string; format: string; byteSize: number; sha256: string;
  sourceTitle: string | null; sourceAuthor: string | null; sourceOrg: string | null; sourceDate: string | null; sourceKind: string | null;
  extractionStatus: string; extractionNote: string | null; createdAt: string; uploaderName: string;
  taskId: string | null; taskState: string | null; taskStage: string | null; errorCode: string | null; errorMessage: string | null; attemptCount: number | null;
};
type DocumentDetail = { id: string; title: string; status: string; baseId: string; uploaderId: string; createdAt: string; withdrawnAt: string | null };

export default function KnowledgeDocumentPage() {
  const { id } = useParams();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`${ENDPOINT}documents/${encodeURIComponent(id ?? "")}`);
    if (!response.ok) { setMessage("材料不存在。"); return; }
    const result = await response.json() as { document: DocumentDetail; versions: Version[] };
    setDocument(result.document);
    setVersions(result.versions);
  }, [id]);

  useEffect(() => { void load().catch(() => setMessage("加载失败，请刷新重试。")).finally(() => setLoading(false)); }, [load]);

  if (!document) return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-ink">材料</h1>
    {loading && <KnowledgeDetailSkeleton kind="document" />}
    {message && <Alert className="mt-4" role="status">{message}</Alert>}
    <p className="mt-4"><Link to="/knowledge" className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
  </main>;

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight text-ink">{document.title}</h1>
        {document.status !== "active" && <Badge variant="destructive">已撤回</Badge>}
      </div>
      <p className="mt-2 text-xs text-ink-3">入库于 {new Date(document.createdAt).toLocaleString("zh-CN")} · 版本 {versions.length}</p>
      <p className="mt-1"><Link to={`/knowledge/bases/${encodeURIComponent(document.baseId)}`} className="text-sm text-accent underline-offset-4 hover:underline">返回知识库</Link></p>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}

    <Card>
      <CardHeader><CardTitle>版本</CardTitle></CardHeader>
      <CardContent>
        {!versions.length ? <p className="text-sm text-ink-3">没有版本记录。</p> : <ul className="grid gap-3">{versions.map(version => <li key={version.id} className="rounded-card border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">v{version.versionNo} · {version.fileName}</span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{version.format}</Badge>
              <Badge variant={STATE_VARIANT[version.taskState ?? ""] ?? "secondary"}>{TASK_STATE_LABELS[version.taskState ?? ""] ?? "未构建"}</Badge>
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-3">{version.sourceOrg ?? "机构未知"} · {version.sourceAuthor ?? "作者未知"} · {version.sourceDate ?? "日期未知"}{version.sourceKind ? ` · ${version.sourceKind}` : ""} · {version.uploaderName} · {new Date(version.createdAt).toLocaleString("zh-CN")} · {Math.round(version.byteSize / 1024)} KB</p>
          <p className="mt-1 break-all text-xs text-ink-4">校验和 {version.sha256}</p>
          {version.extractionStatus === "unavailable" && <p className="mt-1 text-xs text-hot">{version.extractionNote ?? "未能提取文本"}</p>}
          {version.errorCode && <p className="mt-1 text-xs text-hot">{TASK_ERRORS[version.errorCode] ?? version.errorMessage ?? version.errorCode}</p>}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button asChild variant="outline" size="sm"><a href={`${ENDPOINT}versions/${version.id}/original`}><Download size={14} aria-hidden="true" />下载原件</a></Button>
            {version.taskStage && <span className="self-center text-xs text-ink-3">{TASK_STAGE_LABELS[version.taskStage] ?? version.taskStage}</span>}
          </div>
        </li>)}</ul>}
      </CardContent>
    </Card>
  </main>;
}
