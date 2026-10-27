// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { registerMembership, cleanupExpertData, recoverExpertTasks, EXPERT_QUEUE, WIKI_QUEUE, recoverWikiTasks } from "@citic/membership/server";
import { GP_QUEUE } from "@citic/membership/gp-queue";
import { syncAllGps,classifyPendingGps } from "@citic/membership/gp-sync";
import { generateDueNotifications,dispatchOutbox,cleanupP3Data } from "@citic/membership/notifications-outbox";
import {pollMemberIlinkInboxes} from "@citic/membership/notifications-inbox";
import {confirmPendingIlinkBindings} from "@citic/membership/notifications-scan";
import {READING_QUEUE,recoverReadingReplies} from "@citic/membership/conversation-queue";

export const SERVER_MODULES: readonly ServerModule[] = [{
  name: "membership",
  http: registerMembership,
  queues: [EXPERT_QUEUE, GP_QUEUE, WIKI_QUEUE, READING_QUEUE],
  schedules: [
    {name: "membership.notifications-generate",cron:"0 9-23 * * *",missed:"once",run:generateDueNotifications,when:()=>process.env.P3_NOTIFICATIONS_ENABLED==="true"},
    {name: "membership.notifications-dispatch",cron:"*/5 * * * *",run:dispatchOutbox,when:()=>process.env.P3_DELIVERY_ENABLED==="true"},
    {name: "membership.ilink-inbound",cron:"* * * * *",run:pollMemberIlinkInboxes,when:()=>process.env.P3_ILINK_BINDING_ENABLED==="true"},
    {name: "membership.ilink-reading-recover",cron:"* * * * *",run:recoverReadingReplies,when:()=>process.env.P3_ILINK_READING_REPLIES_ENABLED==="true"},
    // The page may be hidden while the phone confirms the QR; the server finishes the scan itself.
    {name: "membership.ilink-scan",cron:"* * * * *",run:confirmPendingIlinkBindings,when:()=>process.env.P3_ILINK_BINDING_ENABLED==="true"},
    { name: "membership.gp-sync", cron: "0 * * * *", when: () => process.env.P3_GP_SYNC_ENABLED === "true", run: syncAllGps },
    { name: "membership.gp-classify", cron: "*/5 * * * *", when: () => process.env.P3_GP_SYNC_ENABLED === "true" && process.env.MODEL_CALLS_ENABLED === "true", run: classifyPendingGps }, {
    name: "membership.expert-recover",
    cron: "*/5 * * * *",
    run: () => recoverExpertTasks((taskId, tx) => enqueueOn(EXPERT_QUEUE, { taskId }, { singletonKey: taskId }, tx)),
  }, {
    // A build whose worker stopped is picked up again and resumes from the stage it reached.
    name: "membership.knowledge-recover",
    cron: "*/5 * * * *",
    run: () => recoverWikiTasks((taskId, tx) => enqueueOn(WIKI_QUEUE, { taskId }, { singletonKey: taskId }, tx)),
  }],
  retention: async now => ({...await cleanupExpertData(now),...await cleanupP3Data()}),
}];
