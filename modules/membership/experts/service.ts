import {createHash,randomBytes} from "node:crypto";
import {sql,type Db,type Tx} from "@aihot/backend/db";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {EXPERT_QUEUE} from "./queue.ts";
import {PANORAMA_EXPERT_SLUG,SECTOR_PEER_EXPERT_SLUG,FRONTIER_PODCAST_EXPERT_SLUG,EXPERT_SLUG,LISTED_FUND_PARTICIPATION_EXPERT_SLUG,XINHUA_ALLOWED_TOOLS,XINHUA_BASE_TOOLS,COMING_SOON_EXPERT_STATUS,HIDDEN_EXPERT_STATUS} from "./catalog.ts";
import {seedBuiltinExperts} from "./seed.ts";

const token=Symbol("expert-actor");
export type ExpertActor={readonly userId:string;readonly channel:"web"|"ilink";readonly bindingVersion?:number;readonly grantId?:string;readonly [token]:true};
export const webExpertActor=(userId:string):ExpertActor=>({userId,channel:"web",[token]:true});
export const ilinkExpertActor=(userId:string,bindingVersion:number,grantId:string):ExpertActor=>({userId,channel:"ilink",bindingVersion,grantId,[token]:true});
export class ExpertServiceError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code;}}
export const WECHAT_EXPERT_SLUGS=[PANORAMA_EXPERT_SLUG,SECTOR_PEER_EXPERT_SLUG,FRONTIER_PODCAST_EXPERT_SLUG] as const;
export async function checkExpertActor(actor:ExpertActor,db:Db|Tx=sql){
  if(actor?.[token]!==true)throw new ExpertServiceError("expert_forbidden");
  const [active]=await db`SELECT 1 FROM member_users WHERE id=${actor.userId} AND status='active' FOR SHARE`;
  if(!active)throw new ExpertServiceError("expert_forbidden");
  if(actor.channel==='ilink'){
    if(process.env.P3_ILINK_EXPERTS_ENABLED!=="true"||process.env.P3_DELIVERY_ENABLED!=="true"||process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true")throw new ExpertServiceError("expert_forbidden");
    const [valid]=await db`SELECT 1 FROM member_agent_grants g
      JOIN member_weixin_bindings b ON b.user_id=g.user_id AND b.status='active'
      JOIN member_ilink_accounts a ON a.user_id=g.user_id AND a.recipient_id=b.recipient_id AND a.channel_account_id=b.channel_account_id
      JOIN member_notification_settings s ON s.user_id=g.user_id AND s.binding_version=${actor.bindingVersion??null}
      WHERE g.user_id=${actor.userId} AND g.grant_id=${actor.grantId??null}::uuid FOR SHARE OF g,b,s`;
    if(!valid)throw new ExpertServiceError("expert_forbidden");
  }
}
export async function listExpertCatalog(actor:ExpertActor,admin=false,db:Db|Tx=sql){
  await checkExpertActor(actor,db);
  await seedBuiltinExperts();
  return db<{slug:string;name:string;description:string;version:string;status:string;missing_dependencies:string[];execution_mode:string;created_at:Date}[]>`
    SELECT slug,name,description,version,status,missing_dependencies,
      CASE WHEN slug=${PANORAMA_EXPERT_SLUG} OR manifest->'tools' @> ${sql.json([...XINHUA_ALLOWED_TOOLS])}::jsonb THEN 'xinhua_panorama'
        WHEN slug=${FRONTIER_PODCAST_EXPERT_SLUG} THEN 'podcast_search'
        WHEN slug=${LISTED_FUND_PARTICIPATION_EXPERT_SLUG} THEN 'listed_fund_participation'
        WHEN slug=${EXPERT_SLUG} OR manifest->'tools' @> ${sql.json([...XINHUA_BASE_TOOLS])}::jsonb THEN 'xinhua_trial'
        ELSE 'text_only' END AS execution_mode,created_at FROM member_experts
    WHERE status<>${HIDDEN_EXPERT_STATUS} AND (status IN ('available',${COMING_SOON_EXPERT_STATUS}) OR owner_id=${actor.userId} OR ${admin})
    ORDER BY (status='available') DESC,(slug=${PANORAMA_EXPERT_SLUG}) DESC,(slug=${SECTOR_PEER_EXPERT_SLUG}) DESC,(slug=${FRONTIER_PODCAST_EXPERT_SLUG}) DESC,created_at DESC`;
}
export async function listAvailableExperts(actor:ExpertActor,db:Db|Tx=sql){
  const catalog=await listExpertCatalog(actor,false,db);
  return catalog.filter(expert=>expert.status==='available'&&WECHAT_EXPERT_SLUGS.includes(expert.slug as typeof WECHAT_EXPERT_SLUGS[number])).map(({slug,name})=>({slug,name}));
}
function stable(value:unknown):string{if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;return JSON.stringify(value);}
export type CreateInput={slug:string;companyName?:string;query?:string;notes?:string};
export type TaskMaterial={id:string;filename:string;format:string;contentType:string;bytes:Buffer;sha256:string};
export async function createExpertTask(actor:ExpertActor,input:CreateInput,opts:{idempotencyKey?:string|null;materials?:TaskMaterial[];tx?:Tx;watchInboundId?:string}={}){
  const work=async(tx:Tx)=>{
    await tx`SELECT id FROM member_users WHERE id=${actor.userId} FOR UPDATE`;
    await checkExpertActor(actor,tx);
    const [expert]=await tx<{status:string}[]>`SELECT status FROM member_experts WHERE slug=${input.slug}`;
    if(!expert||expert.status!=='available')throw new ExpertServiceError("expert_not_found");
    if(actor.channel==='ilink'&&!WECHAT_EXPERT_SLUGS.includes(input.slug as typeof WECHAT_EXPERT_SLUGS[number]))throw new ExpertServiceError("expert_not_found");
    const materials=opts.materials??[];
    const {slug:_,...data}=input;
    const hash=createHash('sha256').update(JSON.stringify({slug:input.slug,input:data,materials:materials.map(m=>m.sha256)})).digest('hex');
    if(opts.idempotencyKey){
      const [existing]=await tx<{id:string;state:string;input_hash:string|null;input:Record<string,unknown>;expert_slug:string}[]>`SELECT id,state,input_hash,input,expert_slug FROM member_expert_tasks WHERE user_id=${actor.userId} AND idempotency_key=${opts.idempotencyKey}`;
      if(existing){
        if(existing.input_hash!==null){if(existing.input_hash!==hash)throw new ExpertServiceError('idempotency_conflict');}
        else {
          const oldMaterials=await tx<{sha256:string}[]>`SELECT sha256 FROM member_expert_task_materials WHERE task_id=${existing.id} ORDER BY created_at,id`;
          if(existing.expert_slug!==input.slug||stable(existing.input)!==stable(data)||stable(oldMaterials.map(m=>m.sha256))!==stable(materials.map(m=>m.sha256)))throw new ExpertServiceError('idempotency_conflict');
        }
        return {id:existing.id,state:existing.state,created:false};
      }
    }
    const [active]=await tx<{count:number}[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${actor.userId} AND state IN ('queued','running','waiting_input') AND expires_at>now()`;
    const [recent]=await tx<{count:number}[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${actor.userId} AND created_at>now()-interval '1 hour'`;
    if((active?.count??0)>=2||(recent?.count??0)>=10)throw new ExpertServiceError("expert_task_rate_limited");
    const id=randomBytes(16).toString('hex');
    await tx`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input,idempotency_key,input_hash) VALUES(${id},${actor.userId},${input.slug},'queued',${tx.json(data)},${opts.idempotencyKey??null},${hash})`;
    for(const m of materials)await tx`INSERT INTO member_expert_task_materials(id,task_id,user_id,filename,format,content_type,byte_size,sha256,body) VALUES(${m.id},${id},${actor.userId},${m.filename},${m.format},${m.contentType},${m.bytes.length},${m.sha256},${m.bytes})`;
    if(opts.watchInboundId)await watchExpertTask(actor,id,opts.watchInboundId,tx);
    await enqueueOn(EXPERT_QUEUE,{taskId:id},{singletonKey:id},tx);
    return {id,state:'queued',created:true};
  };
  return opts.tx?work(opts.tx):sql.begin(work);
}
export async function getExpertTask(actor:ExpertActor,id:string,db:Db|Tx=sql){
  await checkExpertActor(actor,db);
  const [task]=await db<{id:string;expert_slug:string;state:string;stage:string;result:Record<string,unknown>|null;error_code:string|null;updated_at:Date;created_at:Date;expires_at:Date;input:Record<string,unknown>}[]>`SELECT id,expert_slug,state,stage,result,error_code,updated_at,created_at,expires_at,input FROM member_expert_tasks t WHERE t.id=${id} AND t.user_id=${actor.userId} AND GREATEST(t.expires_at,COALESCE((SELECT max(a.expires_at) FROM member_expert_artifacts a WHERE a.task_id=t.id),t.expires_at))>now()`;
  if(!task)throw new ExpertServiceError('task_not_found');
  return task;
}
export async function confirmExpertEntity(actor:ExpertActor,id:string,companyId:string,opts:{tx?:Tx;expectedVersion?:Date}={}){
  const work=async(tx:Tx)=>{
    await checkExpertActor(actor,tx);
    const [task]=await tx<{state:string;expert_slug:string;result:{candidates?:Array<{id:string;name?:string}>}|null;confirmed_attempts:number;updated_at:Date;selected_entity:{id:string}|null}[]>`SELECT state,expert_slug,result,confirmed_attempts,updated_at,selected_entity FROM member_expert_tasks WHERE id=${id} AND user_id=${actor.userId} AND expires_at>now() FOR UPDATE`;
    if(!task)throw new ExpertServiceError('task_or_entity_not_found');
    if(task.state!=='waiting_input')throw new ExpertServiceError('task_or_entity_not_found');
    if(opts.expectedVersion&&task.updated_at.getTime()!==opts.expectedVersion.getTime())throw new ExpertServiceError('entity_version_changed');
    const entity=task.result?.candidates?.find(candidate=>candidate.id===companyId);
    if(!entity)throw new ExpertServiceError('task_or_entity_not_found');
    if(task.confirmed_attempts>=3){await tx`UPDATE member_expert_tasks SET state='failed',stage='failed',error_code='expert_retry_exhausted',error_message='确认后的执行次数已用尽，请重新提交。',finished_at=now(),updated_at=now() WHERE id=${id}`;return {id,state:'failed'};}
    await tx`UPDATE member_expert_tasks SET selected_entity=${tx.json(entity)},state='queued',stage='queued',result=NULL,updated_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=${id}`;
    await enqueueOn(EXPERT_QUEUE,{taskId:id},{singletonKey:id},tx);
    return {id,state:'queued'};
  };
  return opts.tx?work(opts.tx):sql.begin(work);
}
export async function cancelExpertTask(actor:ExpertActor,id:string,db:Db|Tx=sql){
  await checkExpertActor(actor,db);
  const rows=await db`UPDATE member_expert_tasks SET state='cancelled',stage='cancelled',updated_at=now(),finished_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=${id} AND user_id=${actor.userId} AND state IN ('queued','waiting_input','running') RETURNING id`;
  if(!rows.length)throw new ExpertServiceError('task_not_cancellable');
  return {id,state:'cancelled'};
}
function aliasFor(sequence:number){let n=sequence,s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
export async function watchExpertTask(actor:ExpertActor,id:string,inboundId:string,tx:Tx){
  await checkExpertActor(actor,tx);
  const [existing]=await tx<{alias:string}[]>`SELECT alias FROM member_ilink_task_watches WHERE task_id=${id} AND user_id=${actor.userId}`;
  if(existing){
    await tx`UPDATE member_ilink_task_watches SET binding_version=${actor.bindingVersion??0},grant_id=${actor.grantId??null}::uuid,reminders_enabled=true,
      last_event_version=(SELECT updated_at FROM member_expert_tasks WHERE id=${id}) WHERE task_id=${id} AND user_id=${actor.userId}`;
    return existing.alias;
  }
  const [next]=await tx<{next:number}[]>`SELECT COALESCE(max(sequence)+1,0)::int AS next FROM member_ilink_task_watches WHERE user_id=${actor.userId}`;
  const sequence=next?.next??0,alias=aliasFor(sequence);
  await tx`INSERT INTO member_ilink_task_watches(task_id,user_id,binding_version,grant_id,alias,sequence,created_inbound_id,last_event_version) VALUES(${id},${actor.userId},${actor.bindingVersion??0},${actor.grantId??null}::uuid,${alias},${sequence},${inboundId},(SELECT updated_at FROM member_expert_tasks WHERE id=${id}))`;
  return alias;
}
