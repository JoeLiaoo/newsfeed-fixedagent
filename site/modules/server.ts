// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { registerMembership, cleanupExpertData, recoverExpertTasks, EXPERT_QUEUE, WIKI_QUEUE, recoverWikiTasks } from "@citic/membership/server";
import { GP_QUEUE } from "@citic/membership/gp-queue";
import { syncAllGps,classifyPendingGps } from "@citic/membership/gp-sync";
import { generateDueNotifications,dispatchOutbox,cleanupP3Data } from "@citic/membership/notifications-outbox";
import {pollMemberIlinkInboxes,nudgeNearExpiryIlinkChannels} from "@citic/membership/notifications-inbox";
import {FAST_POLL_QUEUE} from "@citic/membership/notifications-inbox-queue";
import {confirmPendingIlinkBindings} from "@citic/membership/notifications-scan";
import {READING_QUEUE,recoverReadingReplies} from "@citic/membership/conversation-queue";
import {AGENT_QUEUE,recoverAgentRuns} from "@citic/membership/conversation-agent-queue";
import {KB_QUEUE,recoverKnowledgeRuns} from "@citic/membership/conversation-knowledge-queue";
import {recoverExpertTaskEvents} from "@citic/membership/conversation-task-events";
import {EXPERT_EVENT_QUEUE} from "@citic/membership/conversation-expert-event-queue";

const fastPollCanaries=new Set((process.env.P3_ILINK_FAST_POLL_USER_IDS??"").split(",").map(id=>id.trim()).filter(Boolean));
const fastPollQueue={...FAST_POLL_QUEUE,worker:{...FAST_POLL_QUEUE.worker,
  localConcurrency:Math.min(20,fastPollCanaries.size)}};

export const SERVER_MODULES: readonly ServerModule[] = [{
  name: "membership",
  http: registerMembership,
  queues: [EXPERT_QUEUE, GP_QUEUE, WIKI_QUEUE, READING_QUEUE, AGENT_QUEUE, KB_QUEUE,
    ...(process.env.P3_ILINK_EXPERT_EVENT_WAKE_ENABLED==="true"?[EXPERT_EVENT_QUEUE]:[]),
    ...(process.env.P3_ILINK_FAST_POLL_ENABLED==="true" && fastPollCanaries.size?[fastPollQueue]:[])],
  schedules: [
    {name: "membership.notifications-generate",cron:"0 9-23 * * *",missed:"once",run:generateDueNotifications,when:()=>process.env.P3_NOTIFICATIONS_ENABLED==="true"},
    {name: "membership.notifications-dispatch",cron:"*/5 * * * *",run:dispatchOutbox,when:()=>process.env.P3_DELIVERY_ENABLED==="true"},
    {name: "membership.ilink-inbound",cron:"* * * * *",pollingIntervalSeconds:1,run:pollMemberIlinkInboxes,when:()=>process.env.P3_ILINK_BINDING_ENABLED==="true"},
    {name: "membership.ilink-keepalive",cron:"0 * * * *",run:nudgeNearExpiryIlinkChannels,when:()=>process.env.P3_ILINK_BINDING_ENABLED==="true"},
    {name: "membership.ilink-reading-recover",cron:"* * * * *",run:recoverReadingReplies,when:()=>process.env.P3_ILINK_READING_REPLIES_ENABLED==="true"},
    {name: "membership.ilink-agent-recover",cron:"* * * * *",run:recoverAgentRuns,when:()=>process.env.P3_ILINK_AGENT_ENABLED==="true"},
    {name: "membership.ilink-kb-recover",cron:"* * * * *",run:recoverKnowledgeRuns,when:()=>process.env.P3_ILINK_KB_ENABLED==="true"},
    {name: "membership.ilink-expert-events",cron:"* * * * *",run:recoverExpertTaskEvents,when:()=>process.env.P3_ILINK_EXPERTS_ENABLED==="true"},
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
