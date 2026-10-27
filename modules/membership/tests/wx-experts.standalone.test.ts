import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseExpertIntent,validateExpertAction} from '../conversation/experts.ts';
import {taskSummary,resultSummary} from '../conversation/task-summary.ts';

test('WX-C2 accepts only bounded expert actions and renders structured summaries',()=>{
  assert.deepEqual(parseExpertIntent('跑同业看板：机器人赛道'),{action:'expert.create',slug:'sector-peer-landscape',input:'机器人赛道'});
  assert.deepEqual(parseExpertIntent('任务 A 选 2'),{action:'expert.confirm_entity',task:'A',selection:2});
  assert.equal(parseExpertIntent('2'),null);
  assert.equal(validateExpertAction({action:'expert.create',slug:'sector-peer-landscape',input:'机器人',user_id:'other'}),null);
  assert.equal(validateExpertAction({action:'expert.create',slug:'sector-peer-landscape',input:'机器人',url:'https://outside.test'}),null);
  assert.equal(parseExpertIntent('跑同业看板：https://outside.test'),null);
  const summary=resultSummary('outbound-investment-panorama',{companyName:'测试公司'},{incomplete:true,gapCount:3,limits:['budget']},null);
  assert.match(summary,/未处理范围/);
  assert.match(resultSummary('frontier-podcast',{query:'机器人'},null,{episodes:2,partial:true}),/未逐条核验/);
  const rendered=taskSummary({id:'a'.repeat(32),expert_slug:'sector-peer-landscape',state:'succeeded',stage:'complete',input:{},result:{html:'<h1>PRIVATE REPORT</h1>'},error_code:null},'A');
  assert.doesNotMatch(rendered,/PRIVATE REPORT|<h1>/);
});
