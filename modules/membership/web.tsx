import { defineWebModule } from "@aihot/web/modules";
import { Bell, BriefcaseBusiness, Rss, UserRound } from "lucide-react";

export const membershipWebModule = defineWebModule({
  name: "membership",
  sidebar: { section: "内容", items: [
    { to: "/experts", label: "专家", icon: BriefcaseBusiness },
    { to: "/settings/sources", label: "资讯信源", icon: Rss },
  ] },
  tools: [{ to: "/settings/interests", label: "关注赛道", icon: <UserRound size={18} aria-hidden="true" /> }, { to: "/settings/notifications", label: "微信通知", icon: <Bell size={18} aria-hidden="true" /> }, { to: "/settings/sources", label: "资讯信源", icon: <Rss size={18} aria-hidden="true" /> }],
});
