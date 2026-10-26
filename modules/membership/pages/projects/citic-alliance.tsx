import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { ProjectList, type ProjectCollection } from "./project-list.tsx";

export const collection:ProjectCollection={title:"中信股权联盟直投项目",path:"/projects/citic-alliance",group:"citic-alliance"};
export const handle: Screen = { tab: "me", name: collection.title };
export const meta = () => pageMeta({ title: collection.title, path: collection.path, noindex: true });
export default function CiticAllianceProjectsPage() { return <ProjectList collection={collection}/>; }
