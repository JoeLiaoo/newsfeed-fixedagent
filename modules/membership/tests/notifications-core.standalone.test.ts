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
  assert(text.length>=350&&text.length<=600);
  assert.match(text,/深读 2/);
  assert.equal((text.match(/\d\. 第/g)??[]).length,3);
  assert.deepEqual(readingIntent("第 2 条"),{kind:"detail",number:2});
  assert.deepEqual(readingIntent("深度1"),{kind:"detail",number:1});
  assert.deepEqual(readingIntent("深度 3"),{kind:"detail",number:3});
  assert.equal(readingIntent("深度6").kind,"unknown");
  assert.deepEqual(readingIntent("主题：储能"),{kind:"topic",topic:"储能"});
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
