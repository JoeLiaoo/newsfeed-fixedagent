import {createHash} from "node:crypto";
import {type Tx} from "@aihot/backend/db";
import {z} from "zod";
import {ilinkExpertActor,listAvailableExperts,createExpertTask,getExpertTask,confirmExpertEntity,cancelExpertTask,watchExpertTask,checkExpertActor,ExpertServiceError,WECHAT_EXPERT_SLUGS} from "../experts/service.ts";
import {taskSummary} from "./task-summary.ts";

export const expertsEnabled=()=>process.env.P3_ILINK_EXPERTS_ENABLED==='true'&&process.env.P3_ILINK_READING_REPLIES_ENABLED==='true'&&process.env.P3_DELIVERY_ENABLED==='true';
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('experts.list')}).strict(),
  z.object({action:z.literal('expert.create'),slug:z.enum(WECHAT_EXPERT_SLUGS),input:z.string().min(2).max(200)}).strict(),
  z.object({action:z.literal('expert.status'),task:z.string().regex(/^(?:[A-Z]{1,4}|[a-f0-9]{32})$/),mute:z.boolean().optional()}).strict(),
  z.object({action:z.literal('expert.confirm_entity'),task:z.string().regex(/^[A-Z]{1,4}$/),selection:z.number().int().min(1).max(10)}).strict(),
  z.object({action:z.literal('expert.cancel'),task:z.string().regex(/^(?:[A-Z]{1,4}|[a-f0-9]{32})$/)}).strict(),
]);
export type ExpertIntent=z.infer<typeof schema>;
export function validateExpertAction(value:unknown):ExpertIntent|null{const parsed=schema.safeParse(value);return parsed.success?parsed.data:null;}
const unsafeInput=(input:string)=>/https?:\/\/|(?:^|\s)(?:SELECT|DROP|INSERT)\s|\.\.\/|\/etc\/|API_KEY|token=/i.test(input);
export const isExpertCommand=(body:string)=>/^(列专家|专家列表|跑|创建专家任务|进度\s|取消\s|任务\s|跟踪任务\s|停止任务\s)/.test(body.trim());
export function parseExpertIntent(body:string):ExpertIntent|null{
  const text=body.trim();if(text.length>230)return null;
  if(/^(列专家|专家列表)$/.test(text))return {action:'experts.list'};
  const natural=/^帮我跑一个(.{2,80})赛道同业看板[。.]?$/.exec(text);
  if(natural)return unsafeInput(natural[1]!)?null:validateExpertAction({action:'expert.create',slug:WECHAT_EXPERT_SLUGS[1],input:natural[1]!.trim()});
  const create=/^跑\s*(全景图|对外投资全景图|同业看板|赛道同业竞争看板|前沿播客)\s*[:：]\s*(.{2,200})$/.exec(text);
  if(create){if(unsafeInput(create[2]!))return null;const slug=create[1]!.includes('全景')?WECHAT_EXPERT_SLUGS[0]:create[1]!.includes('同业')?WECHAT_EXPERT_SLUGS[1]:WECHAT_EXPERT_SLUGS[2];return validateExpertAction({action:'expert.create',slug,input:create[2]!.trim()});}
  const confirm=/^任务\s+([A-Z]{1,4})\s+选\s*([1-9]|10)$/.exec(text);
  if(confirm)return validateExpertAction({action:'expert.confirm_entity',task:confirm[1],selection:Number(confirm[2])});
  const mute=/^停止任务\s+([A-Z]{1,4}|[a-f0-9]{32})\s+提醒$/.exec(text);
  if(mute)return validateExpertAction({action:'expert.status',task:mute[1],mute:true});
  const status=/^(?:进度|跟踪任务)\s+([A-Z]{1,4}|[a-f0-9]{32})$/.exec(text);
  if(status)return validateExpertAction({action:'expert.status',task:status[1]});
  const cancel=/^取消\s+([A-Z]{1,4}|[a-f0-9]{32})$/.exec(text);
  return cancel?validateExpertAction({action:'expert.cancel',task:cancel[1]}):null;
}
type Inbound={id:string;user_id:string;binding_version:number;body:string};
async function resolveTask(tx:Tx,userId:string,reference:string){
  if(/^[a-f0-9]{32}$/.test(reference))return reference;
  const [watch]=await tx<{task_id:string}[]>`SELECT task_id FROM member_ilink_task_watches WHERE user_id=${userId} AND alias=${reference}`;
  if(!watch)throw new ExpertServiceError('task_not_found');
  return watch.task_id;
}
export async function handleExpertInbound(tx:Tx,row:Inbound,intent:ExpertIntent){
  const [grant]=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${row.user_id}`;
  if(!grant)return '专家任务暂不可用，请检查微信授权。';
  const actor=ilinkExpertActor(row.user_id,row.binding_version,grant.grant_id);
  try{
    await checkExpertActor(actor,tx);
    if(intent.action==='experts.list'){
      const available=await listAvailableExperts(actor,tx);
      return available.length?`可用专家：\n${available.map((e,i)=>`${i+1}. ${e.name}`).join('\n')}\n可回复“跑同业看板：企业或赛道”“跑全景图：企业名称”或“跑前沿播客：话题”。`:'当前没有可用的微信专家。';
    }
    if(intent.action==='expert.create'){
      const input=intent.slug===WECHAT_EXPERT_SLUGS[0]?{slug:intent.slug,companyName:intent.input,notes:''}:{slug:intent.slug,query:intent.input,notes:''};
      const key=createHash('sha256').update(`${row.id}:expert.create`).digest('hex');
      const task=await createExpertTask(actor,input,{idempotencyKey:key,watchInboundId:row.id,tx});
      const [watch]=await tx<{alias:string}[]>`SELECT alias FROM member_ilink_task_watches WHERE task_id=${task.id} AND user_id=${row.user_id}`;
      return {body:`任务 ${watch!.alias} 已创建，稍后在这里回报结果。可回复“进度 ${watch!.alias}”或“取消 ${watch!.alias}”。`,watchId:task.id};
    }
    const id=await resolveTask(tx,row.user_id,intent.task);
    const task=await getExpertTask(actor,id,tx);
    let [watch]=await tx<{alias:string}[]>`SELECT alias FROM member_ilink_task_watches WHERE task_id=${id} AND user_id=${row.user_id} AND binding_version=${row.binding_version} AND grant_id=${grant.grant_id}::uuid`;
    if(intent.action==='expert.status'){
      if(intent.mute){if(watch)await tx`UPDATE member_ilink_task_watches SET reminders_enabled=false WHERE task_id=${id} AND user_id=${row.user_id}`;return {body:`已停止任务 ${watch?.alias??intent.task} 的后续提醒。`,watchId:watch?id:undefined};}
      if(!watch){await watchExpertTask(actor,id,row.id,tx);[watch]=await tx<{alias:string}[]>`SELECT alias FROM member_ilink_task_watches WHERE task_id=${id} AND user_id=${row.user_id}`;}
      return {body:taskSummary(task,watch!.alias),watchId:id};
    }
    if(!watch)throw new ExpertServiceError('task_not_found');
    if(intent.action==='expert.cancel'){
      await cancelExpertTask(actor,id,tx);return {body:`任务 ${watch.alias} 已取消。`,watchId:id};
    }
    if(task.state!=='waiting_input'||task.expert_slug!==WECHAT_EXPERT_SLUGS[0])throw new ExpertServiceError('task_or_entity_not_found');
    const candidates=Array.isArray(task.result?.candidates)?task.result.candidates as Array<{id?:unknown}>:[];
    const candidate=candidates[intent.selection-1];
    if(typeof candidate?.id!=='string')throw new ExpertServiceError('task_or_entity_not_found');
    const confirmed=await confirmExpertEntity(actor,id,candidate.id,{tx,expectedVersion:task.updated_at});
    if(confirmed.state==='failed')return {body:'确认后的执行次数已用尽，请重新提交。',watchId:id};
    return {body:`任务 ${watch.alias} 已选择主体并重新排队。完成后会回报。`,watchId:id};
  }catch(error){
    const code=error instanceof ExpertServiceError?error.code:'expert_action_failed';
    const words:Record<string,string>={expert_task_rate_limited:'任务并发或每小时创建额度已满，请稍后在网站查看已有任务。',task_not_found:'未找到本人有效任务，请核对任务编号。',task_or_entity_not_found:'任务不在等待选主体状态，或该编号已失效。请回复“进度 A”查看当前候选。',entity_version_changed:'候选已更新，请重新查看任务进度后选择。',expert_not_found:'该专家当前不可用。请回复“列专家”查看。',expert_forbidden:'专家任务暂不可用，请检查微信授权。',task_not_cancellable:'任务已结束或不可取消，请查看进度。',expert_retry_exhausted:'确认后的执行次数已用尽，请重新提交。',idempotency_conflict:'同一消息的任务输入发生冲突，未创建新任务。'};
    return words[code]??'这次专家操作未完成，请稍后查看本人任务页。';
  }
}
