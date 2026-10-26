import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { ProjectList, type ProjectCollection } from "./project-list.tsx";

export const collection:ProjectCollection={title:"市场头部机构直投项目",path:"/projects/market-leaders",group:"market-leaders"};
export const handle: Screen = { tab: "me", name: collection.title };
export const meta = () => pageMeta({ title: collection.title, path: collection.path, noindex: true });
export default function MarketLeadersProjectsPage() { return <ProjectList collection={collection}/>; }
