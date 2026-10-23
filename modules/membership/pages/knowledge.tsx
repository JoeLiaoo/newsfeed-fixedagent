import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "me", name: "知识库" };
export const meta = () => pageMeta({ title: "知识库", path: "/knowledge", noindex: true });

type Base = {
  id: string; name: string; description: string; status: string;
  createdAt: string; updatedAt: string; documents: number; pages: number; building: number; failed: number;
};

/** The knowledge bases: what each of them holds, as cards. One card opens the base. */
export default function KnowledgePage() {
  const [bases, setBases] = useState<Base[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/v1/membership/knowledge/bases");
        if (!response.ok) { location.href = "/login"; return; }
        const data = await response.json() as { bases: Base[] };
        setBases(data.bases);
      } catch { setMessage("加载失败，请刷新重试。"); }
      finally { setLoading(false); }
    })();
  }, []);

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">知识库</h1>
      <Button asChild><IntentLink to="/knowledge/bases/new"><Plus size={16} aria-hidden="true" />新增知识库</IntentLink></Button>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载知识库…</p>
      : bases.length
        ? <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{bases.map(base => <li key={base.id}>
          <Card asChild className="h-full transition-colors hover:bg-bg-sunk">
            <IntentLink to={`/knowledge/bases/${encodeURIComponent(base.id)}`} className="flex h-full flex-col gap-2 p-5">
              <span className="font-semibold text-ink">{base.name}</span>
              {base.description && <span className="text-sm leading-relaxed text-ink-3">{base.description}</span>}
              <span className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs text-ink-3">
                <Badge variant="secondary">材料 {base.documents}</Badge>
                <Badge variant="secondary">知识页 {base.pages}</Badge>
                {base.building > 0 && <Badge variant="warning">构建中 {base.building}</Badge>}
                {base.failed > 0 && <Badge variant="destructive">失败 {base.failed}</Badge>}
              </span>
            </IntentLink>
          </Card>
        </li>)}</ul>
        : <p className="text-sm text-ink-3">暂无知识库。</p>}
  </main>;
}
