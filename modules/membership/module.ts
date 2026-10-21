import type { ModuleDeclaration } from "@aihot/contracts/modules";

export const membershipModule: ModuleDeclaration = {
  name: "membership",
  pages: [
    { path: "login", file: "pages/login.tsx" },
    { path: "register", file: "pages/register.tsx" },
    { path: "settings/interests", file: "pages/interests.tsx" },
    { path: "settings/sources", file: "pages/sources.tsx" },
    { path: "experts", file: "pages/experts.tsx" },
    { path: "settings/admin-members", file: "pages/admin-members.tsx" },
  ],
  apiPaths: [/^\/api\/v1\/membership(?:\/|$)/],
};
