import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";
import { PlaceholderPage } from "./placeholder.tsx";

export const handle: Screen = { tab: "me", name: "知识库" };
export const meta = () => pageMeta({ title: "知识库", path: "/knowledge", noindex: true });

export default function KnowledgePage() {
  return <PlaceholderPage title="知识库" />;
}
