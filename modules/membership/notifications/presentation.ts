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
const completeSummary=(summary:string,limit:number):string=>{
  if(summary.length<=limit)return summary;
  const boundary=[...summary.slice(0,limit).matchAll(/[。！？；.!?;，]/g)].at(-1);
  return boundary&&boundary.index!>=12?summary.slice(0,boundary.index!+1):"";
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
  const tail=replies?"\n回复数字看详情（如 1）；其他主题回“其他”；完整日报回“全部”。":"\n完整日报请到网站查看。";
  const titles=items.map(item=>item.title.replace(/\s+/g," ").trim());
  const prefixes=items.map((_,index)=>`${index+1}. `);
  const fixed=heading.length+tail.length+items.length+prefixes.reduce((sum,value)=>sum+value.length,0);
  const titleRoom=COMPACT_LIMIT-fixed;
  const lengths=titles.map(title=>title.length);
  // A genuinely overlong set of titles cannot fit. Shorten only then, taking from the longest first.
  while(lengths.reduce((sum,value)=>sum+value,0)>titleRoom){
    const longest=lengths.indexOf(Math.max(...lengths));
    lengths[longest]=lengths[longest]!-1;
  }
  const leads=titles.map((title,index)=>prefixes[index]+(lengths[index]<title.length?clip(title,lengths[index]!):title));
  // Summaries use only the space left after every title and the action line are reserved.
  let remaining=Math.min(600,COMPACT_LIMIT)-heading.length-tail.length-items.length-leads.reduce((sum,line)=>sum+line.length,0);
  const lines=leads.map((lead,index)=>{
    const summary=items[index]!.summary?.replace(/\s+/g," ").trim();
    const allowance=Math.min(110,Math.floor(remaining/(items.length-index))-2);
    if(!summary||allowance<12)return lead;
    const complete=completeSummary(summary,allowance);
    if(!complete)return lead;
    const suffix=`——${complete}`;
    remaining-=suffix.length;
    return lead+suffix;
  });
  return [heading,...lines].join("\n")+tail;
}
