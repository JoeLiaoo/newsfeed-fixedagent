import {PANORAMA_EXPERT_SLUG,SECTOR_PEER_EXPERT_SLUG,FRONTIER_PODCAST_EXPERT_SLUG,EXPERT_TASK_ERROR_LABELS} from "../experts/catalog.ts";

type Task={id:string;expert_slug:string;state:string;stage:string;input:Record<string,unknown>;result:Record<string,unknown>|null;error_code:string|null};
function clipped(value:unknown,max=80){return typeof value==='string'?value.replace(/[\r\n\t]+/g,' ').slice(0,max):'';}
export function taskLink(id:string){try{const url=new URL(process.env.SITE_URL??'');if(!['http:','https:'].includes(url.protocol)||!url.host)throw Error();return `${url.origin}/tasks/${encodeURIComponent(id)}`;}catch{return '请登录网站查看本人任务页';}}
export function taskSummary(task:Task,alias:string){
  const head=`任务 ${alias}｜`;
  if(task.state==='waiting_input'){
    const candidates=Array.isArray(task.result?.candidates)?task.result.candidates.slice(0,10) as Array<Record<string,unknown>>:[];
    if(!candidates.length)return `${head}等待主体候选，请到网站查看。`;
    const lines=candidates.map((candidate,i)=>{const detail=clipped(candidate.creditCode??candidate.unifiedSocialCreditCode,24)||clipped(candidate.address,60)||clipped(candidate.status,20);return `${i+1}. ${clipped(candidate.name,70)||'名称未知'}${detail?`（${detail}）`:''}`;}).join('\n');
    return `${head}请选择真实主体：\n${lines}\n回复“任务 ${alias} 选 1”。不要只回复编号。`.slice(0,1400);
  }
  if(task.state==='queued')return `${head}已排队。可回复“进度 ${alias}”查看。`;
  if(task.state==='running')return `${head}仍在处理。完成后会回报；可回复“进度 ${alias}”。`;
  if(task.state==='cancelled')return `${head}已取消。`;
  if(task.state==='failed')return `${head}未完成。${EXPERT_TASK_ERROR_LABELS[task.error_code??'']??'原因请在任务页核对。'} 本人任务页：${taskLink(task.id)}`;
  if(task.state==='succeeded'){
    const detail=clipped(task.result?.summary,450);
    const fallback=task.expert_slug===PANORAMA_EXPERT_SLUG?'全景报告已生成；实际覆盖层级和未核范围请看报告。':task.expert_slug===SECTOR_PEER_EXPERT_SLUG?'同业看板已生成；资料来自有限次公开检索，未检索到不等于不存在。':task.expert_slug===FRONTIER_PODCAST_EXPERT_SLUG?'播客摘要已生成；这是来源库整理稿，未逐条核验。':'产物已生成，请核对覆盖与来源。';
    return `${head}${detail||fallback}\n本人任务页（下载需登录）：${taskLink(task.id)}`.slice(0,1400);
  }
  return `${head}状态暂不可用，请稍后查询。`;
}
export function resultSummary(slug:string,input:Record<string,unknown>,panorama:{incomplete:boolean;gapCount:number;limits:string[];coverage?:{depth:number;nodes:number;calls:number;untreated:number}}|null,podcast:{episodes:number;partial:boolean}|null){
  if(slug===PANORAMA_EXPERT_SLUG)return `“${clipped(input.companyName)}”全景报告已生成；已读取 ${panorama?.coverage?.nodes??'未知'} 个主体、最深 ${panorama?.coverage?.depth??'未知'} 层，未处理 ${panorama?.coverage?.untreated??'未知'} 项，缺口 ${panorama?.gapCount??'未知'} 项。${panorama?.incomplete?'存在截断或未处理范围，不能视为完整穿透。':'未报告预算截断，仍不能据此认定工商关系已完整穿透。'}`.slice(0,450);
  if(slug===SECTOR_PEER_EXPERT_SLUG)return `“${clipped(input.query)}”同业看板已生成。按有限次公开检索整理，报告列来源、日期和检索缺口；未检索到不等于不存在。`;
  if(slug===FRONTIER_PODCAST_EXPERT_SLUG)return `“${clipped(input.query)}”播客摘要已生成，收录 ${podcast?.episodes??'未知'} 集${podcast?.partial?'，检索覆盖不完整':''}。内容是来源库整理稿，平台未逐条核验。`;
  return '产物已生成；请到本人任务页查看实际覆盖、来源与限制。';
}
