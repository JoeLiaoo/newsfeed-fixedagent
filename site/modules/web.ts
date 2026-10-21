// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { membershipWebModule } from "@citic/membership/web";

export const WEB_MODULES: readonly WebModule[] = [membershipWebModule];
