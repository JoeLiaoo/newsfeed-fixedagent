import type {Tx} from "@aihot/backend/db";
import {agentEnabled,authorized} from "./authorization.ts";
import {expertsEnabled} from "./experts.ts";
import {checkExpertActor,ExpertServiceError,ilinkExpertActor} from "../experts/service.ts";

export type IlinkCapabilities={reading:boolean;knowledge:boolean;experts:boolean;agent:boolean};

export function capabilitiesHelp(capabilities:IlinkCapabilities):string{
  const directions:string[]=[];
  if(capabilities.reading)directions.push('阅读日报可回复“深读 1”“其他”“全部”“下一页”或“主题：储能”');
  if(capabilities.knowledge)directions.push('知识库可回复“知识库”“查知识库：问题”或“搜知识库：关键词”');
  if(capabilities.experts)directions.push('专家任务可回复“列专家”或“跑同业看板：企业或赛道”');
  if(capabilities.agent)directions.push('自由聊可直接发送问题');
  return directions.length?`可用操作：${directions.join('；')}。`:'当前微信回复暂不可用，请登录网站查看。';
}

export async function currentIlinkCapabilities(tx:Tx,userId:string,bindingVersion:number):Promise<IlinkCapabilities>{
  const reading=process.env.P3_ILINK_READING_REPLIES_ENABLED==="true";
  const agent=reading&&agentEnabled()&&await authorized(tx,userId,bindingVersion);
  let experts=false;
  if(reading&&expertsEnabled()){
    const [grant]=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${userId}`;
    if(grant){
      try{await checkExpertActor(ilinkExpertActor(userId,bindingVersion,grant.grant_id),tx);experts=true;}
      catch(error){if(!(error instanceof ExpertServiceError))throw error;}
    }
  }
  return {reading,knowledge:agent&&process.env.P3_ILINK_KB_ENABLED==="true",experts,agent};
}

export async function availableHelp(tx:Tx,userId:string,bindingVersion:number):Promise<string>{
  return capabilitiesHelp(await currentIlinkCapabilities(tx,userId,bindingVersion));
}

export async function agentUnavailableHelp(tx:Tx,userId:string,bindingVersion:number):Promise<string>{
  return `对话服务暂时不可用。${await availableHelp(tx,userId,bindingVersion)}`;
}
