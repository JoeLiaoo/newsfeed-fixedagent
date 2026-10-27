import assert from "node:assert/strict";
import {test} from "node:test";
import {capabilitiesHelp} from "../conversation/help.ts";

test("iLink help lists only currently available capabilities",()=>{
  const reading=capabilitiesHelp({reading:true,knowledge:false,experts:false,agent:false});
  assert.match(reading,/深读 1/);
  assert.doesNotMatch(reading,/知识库|专家任务|自由聊/);
  const withKnowledge=capabilitiesHelp({reading:true,knowledge:true,experts:true,agent:true});
  assert.match(withKnowledge,/知识库/);
  assert.match(withKnowledge,/查知识库：问题/);
  assert.match(withKnowledge,/列专家/);
  assert.match(withKnowledge,/自由聊/);
});
