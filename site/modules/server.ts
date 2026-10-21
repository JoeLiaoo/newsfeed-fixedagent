// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { registerMembership, cleanupExpertData, recoverExpertTasks, EXPERT_QUEUE } from "@citic/membership/server";
import { GP_QUEUE } from "@citic/membership/gp-queue";
import { syncAllGps } from "@citic/membership/gp-sync";

export const SERVER_MODULES: readonly ServerModule[] = [{
  name: "membership",
  http: registerMembership,
  queues: [EXPERT_QUEUE, GP_QUEUE],
  schedules: [{ name: "membership.gp-sync", cron: "0 * * * *", when: () => process.env.P3_GP_SYNC_ENABLED === "true", run: syncAllGps }, {
    name: "membership.expert-recover",
    cron: "*/5 * * * *",
    run: async () => {
      const taskIds = await recoverExpertTasks();
      for (const taskId of taskIds) await enqueueOn(EXPERT_QUEUE, { taskId }, { singletonKey: taskId });
      return { recovered: taskIds.length };
    },
  }],
  retention: cleanupExpertData,
}];
