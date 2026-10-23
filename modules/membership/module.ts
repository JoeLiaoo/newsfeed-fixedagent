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
    { path: "projects/invested-gp", file: "pages/projects/invested-gp.tsx" },
    { path: "projects/citic-alliance", file: "pages/projects/citic-alliance.tsx" },
    { path: "projects/market-leaders", file: "pages/projects/market-leaders.tsx" },
    { path: "knowledge", file: "pages/knowledge.tsx" },
    { path: "knowledge/targets/:slug", file: "pages/knowledge-target.tsx" },
    { path: "knowledge/documents/:id", file: "pages/knowledge-document.tsx" },
    { path: "settings/admin-members", file: "pages/admin-members.tsx" },
    { path: "settings/admin-gps", file: "pages/gp-admin.tsx" },
    { path: "settings/notifications", file: "pages/notifications.tsx" },
  ],
  apiPaths: [/^\/api\/v1\/membership(?:\/|$)/],
};
