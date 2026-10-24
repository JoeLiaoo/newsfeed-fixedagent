import { defineWebModule } from "@aihot/web/modules";
import { Bell, FolderOpen, Rss, UserRound } from "lucide-react";

export const membershipWebModule = defineWebModule({
  name: "membership",
  sidebar: [
    // The site's 资讯平台 group: the employee's own sources are the seventh of its entries.
    { group: "news", items: [{ to: "/settings/sources", label: "资讯信源", icon: Rss }] },
    // The 专家平台 group leads to the expert platform itself.
    { group: "experts", link: { to: "/experts" } },
    // The 知识库 group leads to the shared knowledge base (its own page, issue #27).
    { group: "knowledge", link: { to: "/knowledge" } },
  ],
  tools: [{ to: "/settings/interests", label: "关注赛道", icon: <UserRound size={18} aria-hidden="true" /> }, { to: "/settings/notifications", label: "微信通知", icon: <Bell size={18} aria-hidden="true" /> }, { to: "/account/artifacts", label: "我的任务与产物", icon: <FolderOpen size={18} aria-hidden="true" /> }],
});
