import type { ModuleQueue } from "@aihot/backend/modules";
import { syncGp } from "./sync.ts";

export const GP_QUEUE: ModuleQueue<{ gpId: string }> = {
  name: "membership.gp-sync",
  options: { policy: "short", retryLimit: 0, expireInSeconds: 1200 },
  worker: { batchSize: 1 },
  run: async jobs => {
    for (const job of jobs) await syncGp(job.gpId);
  },
};
