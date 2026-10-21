// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { registerMembership, cleanupExpertData, recoverExpertTasks, EXPERT_QUEUE } from "@citic/membership/server";

export const SERVER_MODULES: readonly ServerModule[] = [{
  name: "membership",
  http: registerMembership,
  queues: [EXPERT_QUEUE],
  schedules: [{
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
