import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const prompt=(name:string)=>readFileSync(new URL(`../../../industry/prompts/${name}.md`,import.meta.url),"utf8");

test("industry prompts preserve platform-wide non-AI coverage through prefiltering and understanding",()=>{
  const prefilter=prompt("prefilter");
  const structure=prompt("structure");
  const understanding=prompt("content-understanding");
  const domains=prompt("rules-domain");
  for(const direction of ["新能源","新一代信息技术","新材料","先进制造","战略配售"]){
    assert(prefilter.includes(direction));
    assert(structure.includes(direction));
    assert(understanding.includes(direction));
  }
  assert.match(prefilter,/行业内容不要求提及 AI/);
  assert.match(prefilter,/不能仅以“未提及 AI”作为依据/);
  assert.match(structure,/内容无需与 AI 有关/);
  assert.match(understanding,/不假定资料必须涉及 AI/);
  assert.doesNotMatch(domains,/本平台 100% 是 AI\/ML\/LLM 行业内容/);
});
