import assert from "node:assert/strict";
import { test } from "node:test";
import { splitNotificationParts } from "../notifications/outbox.ts";

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
