import {createHash} from "node:crypto";
import type {DigestItem} from "./digest.ts";

export type CompactItem={key:string;title:string;summary:string|null;source:string;url:string;tags:string[];timeline:string;sourceHash:string};
export const COMPACT_LIMIT=700;
const clip=(value:string,max:number)=>{
  if(value.length<=max)return value;
  let end=max-1;
  if(end>0&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;
  return value.slice(0,end).trimEnd()+"…";
};
export const compactSourceHash=(item:Pick<CompactItem,"title"|"summary"|"source"|"url">)=>
  createHash("sha256").update(JSON.stringify([item.title,item.summary,item.source,item.url])).digest("hex");
export function compactItems(items:readonly DigestItem[]):CompactItem[]{
  return [...items].sort((a,b)=>new Date(b.timeline_at).getTime()-new Date(a.timeline_at).getTime()||a.source_key.localeCompare(b.source_key))
    .slice(0,3).map(item=>({key:item.source_key,title:item.title,summary:item.summary,source:item.source_name,url:item.url,tags:item.tags,
      timeline:new Date(item.timeline_at).toISOString(),sourceHash:compactSourceHash({...item,source:item.source_name})}));
}
export function renderCompactNewsDigest(day:string,total:number,items:readonly CompactItem[],replies:boolean):string{
  const heading=`今日资讯｜${day}\n本期共 ${total} 条${items.length?`，先看这 ${items.length} 条：`:"。"}`;
  if(!items.length)return heading+"\n本期暂无匹配更新"+(replies?"\n回复“帮助”查看可用操作。":"");
  const tail=replies?"\n想展开哪条？回复“深读 2”；看其他主题回复“其他”；看完整日报回复“全部”。":"\n完整日报请到网站查看。";
  const budget=Math.max(40,Math.floor((600-heading.length-tail.length-8)/items.length));
  const lines=items.map((item,index)=>{
    const lead=`${index+1}. ${clip(item.title,Math.min(70,Math.floor(budget*.55)))}`;
    const summary=item.summary?.replace(/\s+/g," ").trim();
    return lead+(summary?`——${clip(summary,Math.max(10,budget-lead.length-1))}`:`（${clip(item.source,24)}）`);
  });
  return clip([heading,...lines].join("\n")+tail,COMPACT_LIMIT);
}
