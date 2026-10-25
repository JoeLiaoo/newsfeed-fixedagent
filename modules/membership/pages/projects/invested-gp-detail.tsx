import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ExternalLink } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Card } from "@aihot/web/components/member-ui/card";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "me", name: "已投GP直投项目" };
export const meta = () => pageMeta({ title: "已核实直投项目", path: "/projects/invested-gp", noindex: true });

type Investment = { id: string; gp_name: string; investee_name: string; sector_tags: string[]; event_date: string | null; source_url: string | null; source_placeholder: boolean };

export default function InvestedGpDetailPage() {
  const { id } = useParams();
  const [investment, setInvestment] = useState<Investment | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    setInvestment(null);
    void fetch(`/api/v1/membership/gp-projects/${encodeURIComponent(id ?? "")}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { location.href = "/login"; return; }
        if (response.status === 404) { setMessage("项目不存在或尚未核实。"); return; }
        if (!response.ok) throw new Error("request_failed");
        const result = await response.json() as { investment: Investment };
        setInvestment(result.investment);
      })
      .catch(error => { if (!controller.signal.aborted) setMessage("项目暂时无法加载，请重试。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  return <main className="mx-auto w-full max-w-4xl px-5 py-8">
    <Link to="/projects/invested-gp" className="text-sm text-accent underline-offset-4 hover:underline">返回已投GP直投项目</Link>
    {loading ? <p className="mt-6 text-sm text-ink-3" role="status">正在加载项目…</p>
      : !investment ? <Alert className="mt-6" role="status">{message}</Alert>
      : <>
        <h1 className="mt-5 break-words text-2xl font-semibold tracking-tight text-ink">{investment.investee_name}</h1>
        <p className="mt-2 text-sm text-ink-3">已核实直投项目</p>
        <Card className="mt-6 grid gap-5 p-6">
          <div><h2 className="text-sm text-ink-3">投资 GP</h2><p className="mt-1 break-words text-ink">{investment.gp_name}</p></div>
          <div><h2 className="text-sm text-ink-3">审核赛道</h2><div className="mt-2 flex flex-wrap gap-2">{investment.sector_tags.length ? investment.sector_tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>) : <span>暂无赛道标签</span>}</div></div>
          <div><h2 className="text-sm text-ink-3">投资日期</h2><p className="mt-1">{investment.event_date ?? "日期未知"}</p></div>
          <div><h2 className="text-sm text-ink-3">核对来源</h2><p className="mt-1">{investment.source_url ? <a className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline" href={investment.source_url} target="_blank" rel="noreferrer">查看来源<ExternalLink size={14} aria-hidden="true" /></a> : investment.source_placeholder ? "演示/导入占位 · 无可核对来源" : "来源待补充"}</p></div>
        </Card>
      </>}
  </main>;
}
