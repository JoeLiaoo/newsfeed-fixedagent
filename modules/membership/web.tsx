import { defineWebModule } from "@aihot/web/modules";
import { IconPlug, IconUser } from "@aihot/web/components/icons";

export const membershipWebModule = defineWebModule({
  name: "membership",
  sidebar: { section: "内容", items: [
    { to: "/experts", label: "专家", icon: IconPlug },
  ] },
  tools: [{ to: "/settings/interests", label: "关注赛道", icon: <IconUser size={18} /> }, { to: "/settings/sources", label: "资讯信源", icon: <IconPlug size={18} /> }],
});
