import { useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card } from "@aihot/web/components/member-ui/card";
import { IntentLink } from "@aihot/web/components/ui/IntentLink";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SECTOR_PEER_EXPERT_SLUG, expertStatusBadge } from "../experts/catalog.ts";

export const handle: Screen = { tab: "me", name: "专家平台" };
export const meta = () => pageMeta({ title: "专家平台", path: "/experts", noindex: true });

type Expert = {
  slug: string; name: string; description: string; version: string; status: string;
  execution_mode: "xinhua_trial" | "xinhua_panorama" | "text_only" | "podcast_search"; missing_dependencies: string[];
};

/** The expert platform: the experts there are, as cards. One card opens the expert. */
export default function ExpertsPage() {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/v1/membership/experts");
        if (!response.ok) { location.href = "/login"; return; }
        const data = await response.json() as { experts: Expert[] };
        setExperts(data.experts);
      } catch { setMessage("加载失败，请刷新重试。"); }
      finally { setLoading(false); }
    })();
  }, []);

  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">专家平台</h1>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><IntentLink to="/tasks">任务记录</IntentLink></Button>
        <Button asChild variant="outline"><IntentLink to="/account/artifacts"><FolderOpen size={16} aria-hidden="true" />我的任务与产物</IntentLink></Button>
        <Button asChild><IntentLink to="/experts/new"><Plus size={16} aria-hidden="true" />新增专家</IntentLink></Button>
      </div>
    </header>
    {message && <Alert className="mb-5" role="status">{message}</Alert>}
    {loading
      ? <p className="text-sm text-ink-3" role="status">正在加载专家目录…</p>
      : experts.length
        ? <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{experts.map(expert => {
          const badge = expertStatusBadge(expert.status);
          return <li key={expert.slug}>
          <Card asChild className="h-full transition-colors hover:bg-bg-sunk">
            <IntentLink to={`/experts/${encodeURIComponent(expert.slug)}`} className="flex h-full flex-col gap-2 p-5">
              <span className="font-semibold text-ink">{expert.name}</span>
              <span className="text-sm leading-relaxed text-ink-3">{expert.description}</span>
              {(expert.status !== "available" || expert.slug === SECTOR_PEER_EXPERT_SLUG) && <span className="mt-auto pt-3"><Badge variant={badge.variant}>{badge.label}</Badge></span>}
              {expert.missing_dependencies.length > 0 && <span className="text-xs text-amber-ink">缺少依赖：{expert.missing_dependencies.join("、")}</span>}
            </IntentLink>
          </Card>
        </li>;
        })}</ul>
        : <p className="text-sm text-ink-3">暂无已发布的专家。</p>}
  </main>;
}
