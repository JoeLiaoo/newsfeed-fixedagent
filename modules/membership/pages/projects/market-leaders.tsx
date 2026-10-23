import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { PlaceholderPage } from "../placeholder.tsx";

export const handle: Screen = { tab: "me", name: "市场头部机构直投项目" };
export const meta = () => pageMeta({ title: "市场头部机构直投项目", path: "/projects/market-leaders", noindex: true });

export default function MarketLeadersProjectsPage() {
  return <PlaceholderPage title="市场头部机构直投项目" />;
}
