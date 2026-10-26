import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { ProjectDetail } from "./project-detail.tsx";
import type { ProjectCollection } from "./project-list.tsx";
const collection:ProjectCollection={title:"已投GP直投项目",path:"/projects/invested-gp"};

export const handle: Screen = { tab: "me", name: collection.title };
export const meta = () => pageMeta({ title: "已核实直投项目", path: collection.path, noindex: true });
export default function InvestedGpDetailPage() { return <ProjectDetail collection={collection}/>; }
