import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { PlaceholderPage } from "../placeholder.tsx";

export const handle: Screen = { tab: "me", name: "中信股权联盟直投项目" };
export const meta = () => pageMeta({ title: "中信股权联盟直投项目", path: "/projects/citic-alliance", noindex: true });

export default function CiticAllianceProjectsPage() {
  return <PlaceholderPage title="中信股权联盟直投项目" />;
}
