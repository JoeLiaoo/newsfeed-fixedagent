import {createHash} from 'node:crypto';
import {sql,type Tx} from '@aihot/backend/db';
import {enqueueOn} from '@aihot/backend/jobs/queue';
import {ilinkExpertActor,checkExpertActor} from '../experts/service.ts';
import {taskSummary} from './task-summary.ts';
import {dispatchReadingReply} from './replies.ts';
import {expertsEnabled} from './experts.ts';
import {EXPERT_EVENT_QUEUE} from './task-event-queue.ts';

/** The job and the status change share a commit; the minute scan remains the fallback. */
export async function enqueueExpertTaskEventWake(taskId:string,tx:Tx){
  if(process.env.P3_ILINK_EXPERT_EVENT_WAKE_ENABLED!=='true')return;
  const [watch]=await tx<{state:string;updated_at:Date}[]>`SELECT t.state,t.updated_at FROM member_ilink_task_watches w JOIN member_expert_tasks t ON t.id=w.task_id WHERE w.task_id=${taskId} AND w.reminders_enabled=true`;
  if(watch)await enqueueOn(EXPERT_EVENT_QUEUE,{taskId},{singletonKey:`${taskId}:${watch.state}:${watch.updated_at.toISOString()}`},tx);
}

export async function processExpertTaskEvent(taskId:string){
  if(!expertsEnabled())return false;
  const [watch]=await sql<{task_id:string;user_id:string}[]>`SELECT task_id,user_id FROM member_ilink_task_watches WHERE task_id=${taskId}`;
  if(!watch)return false;
  return emitExpertTaskEvent(watch);
}

export async function recoverExpertTaskEvents(){
  if(!expertsEnabled())return {events:0};
  const watches=await sql<{task_id:string;user_id:string}[]>`SELECT w.task_id,w.user_id FROM member_ilink_task_watches w JOIN member_expert_tasks t ON t.id=w.task_id WHERE t.expires_at>now() AND w.reminders_enabled=true AND (
    (t.state='waiting_input' AND w.last_event_version IS DISTINCT FROM t.updated_at AND NOT EXISTS(SELECT 1 FROM member_ilink_task_events e WHERE e.task_id=t.id AND e.state='waiting_input'))
    OR (t.state IN ('succeeded','failed','cancelled') AND w.last_event_version IS DISTINCT FROM t.updated_at AND NOT EXISTS(SELECT 1 FROM member_ilink_task_events e WHERE e.task_id=t.id AND e.state IN ('succeeded','failed','cancelled')))
    OR (t.state='running' AND w.long_notice_sent=false AND t.created_at<now()-interval '15 minutes')
  ) ORDER BY t.updated_at LIMIT 100`;
  let events=0;
  for(const watch of watches){
    if(await emitExpertTaskEvent(watch))events++;
  }
  return {events};
}

async function emitExpertTaskEvent(watch:{task_id:string;user_id:string}){
  const id=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${watch.user_id}))`;
      const [row]=await tx<{task_id:string;user_id:string;binding_version:number;grant_id:string;alias:string;last_event_version:Date|null;long_notice_sent:boolean;reminders_enabled:boolean;created_at:Date;state:string;stage:string;result:Record<string,unknown>|null;error_code:string|null;updated_at:Date;expires_at:Date;expert_slug:string;input:Record<string,unknown>;id:string}[]>`
        SELECT w.task_id,w.user_id,w.binding_version,w.grant_id,w.alias,w.last_event_version,w.long_notice_sent,w.created_at,w.reminders_enabled,t.id,t.state,t.stage,t.result,t.error_code,t.updated_at,t.expires_at,t.expert_slug,t.input
        FROM member_ilink_task_watches w JOIN member_expert_tasks t ON t.id=w.task_id WHERE w.task_id=${watch.task_id} AND w.user_id=${watch.user_id} AND t.expires_at>now() FOR UPDATE OF w`;
      if(!row||!row.reminders_enabled)return null;
      try{await checkExpertActor(ilinkExpertActor(row.user_id,row.binding_version,row.grant_id),tx);}catch{return null;}
      const terminal=['succeeded','failed','cancelled'].includes(row.state);
      const waiting=row.state==='waiting_input';
      const long=row.state==='running'&&!row.long_notice_sent&&Date.now()-row.created_at.getTime()>15*60_000;
      if(!terminal&&!waiting&&!long)return null;
      if(waiting||terminal){const [prior]=await tx`SELECT 1 FROM member_ilink_task_events WHERE task_id=${row.id} AND state=ANY(${sql.array(waiting?['waiting_input']:['succeeded','failed','cancelled'])}::text[]) LIMIT 1`;if(prior)return null;}
      if(row.last_event_version?.getTime()===row.updated_at.getTime()&&!long)return null;
      const version=row.updated_at;
      const eventId='expert-event-'+createHash('sha256').update(`${row.id}:${row.state}:${version.toISOString()}:${long?'long':''}`).digest('hex').slice(0,32);
      const [account]=await tx<{channel_account_id:string}[]>`SELECT channel_account_id FROM member_ilink_accounts WHERE user_id=${row.user_id}`;
      if(!account)return null;
      await tx`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body,status,expires_at)
        VALUES(${eventId},${row.user_id},${row.binding_version},${account.channel_account_id},${eventId},'','processed',${row.expires_at}) ON CONFLICT DO NOTHING`;
      const [event]=await tx<{id:string}[]>`INSERT INTO member_ilink_task_events(id,task_id,state,version) VALUES(${eventId},${row.id},${long?'long_running':row.state},${version}) ON CONFLICT DO NOTHING RETURNING id`;
      if(!event)return null;
      const body=long?`任务 ${row.alias} 仍在处理。可回复“进度 ${row.alias}”；完成后会回报。`:taskSummary(row,row.alias);
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body,task_watch_id,expert_grant_id,expires_at)
        VALUES(${eventId},${eventId},${row.user_id},${row.binding_version},${body},${row.id},${row.grant_id}::uuid,${row.expires_at}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_task_watches SET last_event_version=${version},long_notice_sent=long_notice_sent OR ${long} WHERE task_id=${row.id}`;
      return eventId;
  });
  if(id)await dispatchReadingReply(id);
  return Boolean(id);
}
