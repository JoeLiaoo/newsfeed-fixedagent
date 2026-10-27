import type {ModuleQueue} from "@aihot/backend/modules";
import {processKnowledgeRun,recoverKnowledgeRuns} from "./knowledge.ts";
export const KB_QUEUE:ModuleQueue<{runId:string}>={
  name:"membership.ilink-kb",options:{policy:"short",retryLimit:0,expireInSeconds:600},
  worker:{batchSize:1,pollingIntervalSeconds:1},run:async jobs=>{for(const job of jobs)await processKnowledgeRun(job.runId);},
};
export {recoverKnowledgeRuns};
