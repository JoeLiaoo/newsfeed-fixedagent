import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { PlaceholderPage } from "../placeholder.tsx";

export const handle: Screen = { tab: "me", name: "已投GP直投项目" };
export const meta = () => pageMeta({ title: "已投GP直投项目", path: "/projects/invested-gp", noindex: true });

export default function InvestedGpProjectsPage() {
  return <PlaceholderPage title="已投GP直投项目" />;
}
