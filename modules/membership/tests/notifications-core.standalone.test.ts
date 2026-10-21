import assert from "node:assert/strict";
import { test } from "node:test";
import { splitNotificationParts } from "../notifications/outbox.ts";

test("notification message parts keep source references attached to their rendered text",()=>{
  const empty=splitNotificationParts("个人资讯日报 2026-10-22",[]);
  assert.equal(empty.length,1);
  assert.match(empty[0]!.payload,/今日无更新/);
  assert.deepEqual(empty[0]!.sourceKeys,[]);

  const parts=splitNotificationParts("个人资讯日报 2026-10-22",[
    {key:"story:one",text:"第一条"},
    {key:"story:two",text:"第二条"},
  ]);
  assert.equal(parts.length,1);
  assert.deepEqual(parts[0]!.sourceKeys,["story:one","story:two"]);

  const split=splitNotificationParts("日报",[
    {key:"story:long-a",text:"A".repeat(900)},
    {key:"story:long-b",text:"B".repeat(900)},
  ],"今日无更新",1000);
  assert.equal(split.length,2);
  assert.deepEqual(split.map(part=>part.sourceKeys),[["story:long-a"],["story:long-b"]]);
  assert(split.every(part=>part.payload.length<=1000));
});
