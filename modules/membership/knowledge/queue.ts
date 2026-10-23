import type { ModuleQueue } from "@aihot/backend/modules";
import { runWikiTask } from "./worker.ts";

export type WikiTaskJob = { taskId: string };

/** The build queue of the shared library. A build is a sequence of paid steps, so it is not retried by the queue. */
export const WIKI_QUEUE: ModuleQueue<WikiTaskJob> = {
  name: "membership.knowledge",
  options: { policy: "short", retryLimit: 0, expireInSeconds: 7200 },
  worker: { batchSize: 1 },
  run: async jobs => { await Promise.all(jobs.map(job => runWikiTask(job.taskId))); },
};
