import type { ModuleQueue } from "@aihot/backend/modules";
import { runExpertTask } from "./worker.ts";

export type ExpertTaskJob = { taskId: string };
export const EXPERT_QUEUE: ModuleQueue<ExpertTaskJob> = {
  name: "membership.expert",
  options: { policy: "short", retryLimit: 0, expireInSeconds: 3600 },
  worker: { batchSize: 1 },
  run: async jobs => { await Promise.all(jobs.map(job => runExpertTask(job.taskId))); },
};
