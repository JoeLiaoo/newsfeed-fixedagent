import type {ModuleQueue} from "@aihot/backend/modules";
import {processAgentRun,recoverAgentRuns} from "./agent-worker.ts";
export const AGENT_QUEUE:ModuleQueue<{runId:string}>={
  name:"membership.ilink-agent",options:{policy:"short",retryLimit:0,expireInSeconds:600},
  worker:{batchSize:1,localConcurrency:2,pollingIntervalSeconds:1},run:async jobs=>{for(const job of jobs)await processAgentRun(job.runId);},
};
export {recoverAgentRuns};
