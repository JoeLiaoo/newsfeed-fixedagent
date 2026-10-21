import { defineWebModule } from "@aihot/web/modules";
import { BriefcaseBusiness, UserRound } from "lucide-react";

export const membershipWebModule = defineWebModule({
  name: "membership",
  sidebar: { section: "内容", items: [
    { to: "/experts", label: "专家", icon: BriefcaseBusiness },
  ] },
  tools: [{ to: "/settings/interests", label: "关注赛道", icon: <UserRound size={18} aria-hidden="true" /> }, { to: "/settings/sources", label: "资讯信源", icon: <BriefcaseBusiness size={18} aria-hidden="true" /> }],
});
