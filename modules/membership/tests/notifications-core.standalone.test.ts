import assert from "node:assert/strict";
import { test } from "node:test";
import { splitNotificationParts } from "../notifications/outbox.ts";
import {compactItems,renderCompactNewsDigest} from "../notifications/presentation.ts";
import {readingIntent} from "../conversation/intent.ts";

test("notification message parts keep source references attached to their rendered text",()=>{
  const empty=splitNotificationParts("个人资讯日报 2026-10-22",[]);
  assert.equal(empty.length,1);
  assert.match(empty[0]!.payload,/今日无更新/);
  assert.deepEqual(empty[0]!.sources,[]);

  const parts=splitNotificationParts("个人资讯日报 2026-10-22",[
    {key:"story:one",text:"第一条"},
    {key:"story:two",text:"第二条"},
  ]);
  assert.equal(parts.length,1);
  assert.deepEqual(parts[0]!.sources.map(source=>source.key),["story:one","story:two"]);

  const split=splitNotificationParts("日报",[
    {key:"story:long-a",text:"A".repeat(900)},
    {key:"story:long-b",text:"B".repeat(900)},
  ],"今日无更新",1000);
  assert.equal(split.length,2);
  assert.deepEqual(split.map(part=>part.sources.map(source=>source.key)),[["story:long-a","story:long-b"],["story:long-b"]]);
  assert(split.every(part=>part.payload.length<=1000));
});
test("one compact message represents a hundred long sources and keeps a stable order",()=>{
  const items=Array.from({length:100},(_,index)=>({article_id:String(index),source_key:`article:${index}`,
    title:`第 ${index} 条新闻`,summary:"摘要".repeat(1000),url:`https://example.test/${index}`,tags:["光伏"],source_name:"合成源",
    published_at:null,timeline_at:new Date(Date.UTC(2026,9,27,0,index))}));
  const displayed=compactItems(items);
  assert.deepEqual(displayed.map(item=>item.key),["article:99","article:98","article:97"]);
  assert(displayed.every(item=>/^[0-9a-f]{64}$/.test(item.sourceHash)));
  const text=renderCompactNewsDigest("2026-10-27",100,displayed,true);
  assert(text.length<=600);
  assert.match(text,/回复数字看详情/);
  assert.equal((text.match(/\d\. 第/g)??[]).length,3);
  assert.deepEqual(readingIntent("第 2 条"),{kind:"detail",number:2});
  assert.deepEqual(readingIntent("深度1"),{kind:"detail",number:1});
  assert.deepEqual(readingIntent("深度 3"),{kind:"detail",number:3});
  for(const command of ["1","展开1","展开 1","详情1","看第1条","第1条","第一条","深读1"])
    assert.deepEqual(readingIntent(command),{kind:"detail",number:1});
  assert.deepEqual(readingIntent("第五条"),{kind:"detail",number:5});
  for(const [command,kind] of [["其它","other"],["剩下的","other"],["完整","all"],["目录","all"],["下页","next"],["怎么用","help"]] as const)
    assert.equal(readingIntent(command).kind,kind);
  assert.equal(readingIntent("我有1个问题").kind,"unknown");
  assert.equal(readingIntent("深度6").kind,"unknown");
  assert.equal(readingIntent("你好").kind,"unknown");
  assert.equal(readingIntent("嗨").kind,"unknown");
  assert.deepEqual(readingIntent("在"),{kind:"ping"});
  assert.deepEqual(readingIntent("主题：储能"),{kind:"topic",topic:"储能"});
});

test("compact news preserves complete long titles before spending space on summaries",()=>{
  const titles=["新能源企业完成最新一轮融资并公布储能项目建设计划".repeat(2),"半导体设备产业链公布新的产能与订单进展".repeat(2),"机器人公司发布年度研发与商业化进展".repeat(2)];
  const items=titles.map((title,index)=>({key:String(index),title,summary:"摘要".repeat(300),source:"来源",url:"https://example.test",tags:[],timeline:"2026-10-28T00:00:00Z",sourceHash:"hash"}));
  const output=renderCompactNewsDigest("2026-10-28",3,items,true);
  assert(output.length<=700);
  for(const title of titles)assert(output.includes(title));
  assert(!output.includes("深读"));
  assert(!output.includes("摘要"),"a long unpunctuated summary is omitted instead of cut mid-line");
});

test("compact news does not treat a comma as a complete summary sentence",()=>{
  const items=Array.from({length:3},(_,index)=>({key:String(index),title:`资讯 ${index+1}`,
    summary:"公司完成新一轮融资，"+"后续计划".repeat(100),source:"来源",url:"https://example.test",tags:[],
    timeline:"2026-10-28T00:00:00Z",sourceHash:"hash"}));
  const output=renderCompactNewsDigest("2026-10-28",3,items,true);
  assert(output.length<=700);
  assert(!output.includes("公司完成新一轮融资，"));
  assert.equal((output.match(/\d\. 资讯/g)??[]).length,3);
});

test("long source text keeps contiguous per-part offsets without header-only parts",()=>{
  const longText="A".repeat(2300)+"😀"+"B".repeat(500);
  const shortText="short item";
  const parts=splitNotificationParts("日报",[
    {key:"story:long",text:longText},
    {key:"story:short",text:shortText},
  ],"今日无更新",1000);
  assert(parts.length>=3);
  assert(parts.every(part=>part.payload.length<=1000));
  assert(parts.every(part=>part.sources.length>0));
  const longSegments=parts.flatMap(part=>part.sources.filter(source=>source.key==="story:long"));
  assert.deepEqual(longSegments.map(({start,end})=>longText.slice(start,end)).join(""),longText);
  assert.equal(longSegments[0]?.start,0);
  assert.equal(longSegments.at(-1)?.end,longText.length);
  assert(parts.flatMap(part=>part.sources).some(source=>source.key==="story:short"));
});
