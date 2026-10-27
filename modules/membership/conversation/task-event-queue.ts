import type {ModuleQueue} from '@aihot/backend/modules';
import {processExpertTaskEvent} from './task-events.ts';

export const EXPERT_EVENT_QUEUE:ModuleQueue<{taskId:string}>={
  name:'membership.ilink-expert-event',
  options:{policy:'short',retryLimit:2,retryDelay:15,expireInSeconds:600},
  worker:{batchSize:1,pollingIntervalSeconds:1},
  run:async jobs=>{
    if(process.env.P3_ILINK_EXPERT_EVENT_WAKE_ENABLED!=='true')return;
    for(const job of jobs)await processExpertTaskEvent(job.taskId);
  },
};
