// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { registerMembership, cleanupExpertData, recoverExpertTasks, EXPERT_QUEUE } from "@citic/membership/server";
import { GP_QUEUE } from "@citic/membership/gp-queue";
import { syncAllGps,classifyPendingGps } from "@citic/membership/gp-sync";
import { generateDueNotifications,dispatchOutbox,cleanupP3Data } from "@citic/membership/notifications-outbox";

export const SERVER_MODULES: readonly ServerModule[] = [{
  name: "membership",
  http: registerMembership,
  queues: [EXPERT_QUEUE, GP_QUEUE],
  schedules: [
    {name: "membership.notifications-generate",cron:"0 9-23 * * *",missed:"once",run:generateDueNotifications,when:()=>process.env.P3_NOTIFICATIONS_ENABLED==="true"},
    {name: "membership.notifications-dispatch",cron:"*/5 * * * *",run:dispatchOutbox,when:()=>process.env.P3_DELIVERY_ENABLED==="true"},
    { name: "membership.gp-sync", cron: "0 * * * *", when: () => process.env.P3_GP_SYNC_ENABLED === "true", run: syncAllGps },
    { name: "membership.gp-classify", cron: "*/5 * * * *", when: () => process.env.P3_GP_SYNC_ENABLED === "true" && process.env.MODEL_CALLS_ENABLED === "true", run: classifyPendingGps }, {
    name: "membership.expert-recover",
    cron: "*/5 * * * *",
    run: async () => {
      const taskIds = await recoverExpertTasks();
      for (const taskId of taskIds) await enqueueOn(EXPERT_QUEUE, { taskId }, { singletonKey: taskId });
      return { recovered: taskIds.length };
    },
  }],
  retention: async now => ({...await cleanupExpertData(now),...await cleanupP3Data()}),
}];
