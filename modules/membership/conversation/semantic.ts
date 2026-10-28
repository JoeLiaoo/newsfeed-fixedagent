import {z} from "zod";
import {chatJson} from "@aihot/backend/providers/llm";
import type {ReadingIntent} from "./intent.ts";

const schema=z.object({
  kind:z.enum(["detail","other","all","next","topic","help","unknown"]),
  number:z.number().int().min(1).max(5).optional(),
  topic:z.string().trim().min(1).max(30).optional(),
  confidence:z.number().min(0).max(1),
}).strict();

/** Only a short classification is returned; no model text is ever sent to the employee. */
export async function classifyReadingIntent(input:string,inboundId:string,userId:string):Promise<ReadingIntent>{
  if(input.length>300)return {kind:"unknown"};
  try{
    const {data}=await chatJson({
      model:"default",purpose:"wx_reading_intent",subject:`wx-reading:${inboundId}`,memberUserId:userId,
      promptVersion:"wx-reading-intent-v1",temperature:0,maxTokens:512,timeoutMs:4000,maxRequestBytes:4000,
      system:"你只把员工对已收到的微信短日报的回复分类为阅读操作。只返回 JSON：kind 为 detail、other、all、next、topic、help 或 unknown，confidence 为 0 到 1。detail 还要有 number（1 到 5）；topic 还要有 topic（用户原话中的细分主题）。不回答问题，不创造新闻内容。无法确定意图、闲聊、知识库或专家任务请求都选 unknown。",
      user:input,schema,
    });
    if(data.confidence<0.8)return {kind:"unknown"};
    if(data.kind==="detail")return data.number?{kind:"detail",number:data.number}:{kind:"unknown"};
    if(data.kind==="topic")return data.topic&&input.includes(data.topic)?{kind:"topic",topic:data.topic}:{kind:"unknown"};
    return {kind:data.kind};
  }catch{return {kind:"unknown"};}
}
