import type {ModuleQueue} from "@aihot/backend/modules";
import {processReadingInbound,recoverReadingReplies} from "./replies.ts";

export const READING_QUEUE:ModuleQueue<{inboundId:string}>={
  name:"membership.ilink-reading",options:{policy:"short",retryLimit:2,retryDelay:15,expireInSeconds:600},
  worker:{batchSize:1},run:async jobs=>{for(const job of jobs)await processReadingInbound(job.inboundId);},
};
export {recoverReadingReplies};
