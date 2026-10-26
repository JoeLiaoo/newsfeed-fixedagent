import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { ProjectList, type ProjectCollection } from "./project-list.tsx";

const collection:ProjectCollection={title:"已投GP直投项目",path:"/projects/invested-gp"};
export const handle: Screen = { tab: "me", name: collection.title };
export const meta = () => pageMeta({ title: collection.title, path: collection.path, noindex: true });
export default function InvestedGpProjectsPage() { return <ProjectList collection={collection}/>; }
