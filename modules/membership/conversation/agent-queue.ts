import type {ModuleQueue} from "@aihot/backend/modules";
import {processAgentRun,recoverAgentRuns} from "./agent-worker.ts";
export const AGENT_QUEUE:ModuleQueue<{runId:string}>={
  name:"membership.ilink-agent",options:{policy:"short",retryLimit:0,expireInSeconds:600},
  worker:{batchSize:2},run:async jobs=>{await Promise.all(jobs.map(job=>processAgentRun(job.runId)));},
};
export {recoverAgentRuns};
