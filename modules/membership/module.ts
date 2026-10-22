import type { ModuleDeclaration } from "@aihot/contracts/modules";

export const membershipModule: ModuleDeclaration = {
  name: "membership",
  pages: [
    { path: "login", file: "pages/login.tsx" },
    { path: "register", file: "pages/register.tsx" },
    { path: "settings/profile", file: "pages/profile.tsx" },
    { path: "settings/interests", file: "pages/interests.tsx" },
    { path: "settings/sources", file: "pages/sources.tsx" },
    { path: "experts", file: "pages/experts.tsx" },
    { path: "settings/admin-members", file: "pages/admin-members.tsx" },
    { path: "settings/admin-gps", file: "pages/gp-admin.tsx" },
    { path: "settings/notifications", file: "pages/notifications.tsx" },
  ],
  apiPaths: [/^\/api\/v1\/membership(?:\/|$)/],
};
