import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseExpertIntent,validateExpertAction,isExpertCommand} from '../conversation/experts.ts';
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

test('WX-C2 accepts polite prefixes around the fixed create and list grammar',()=>{
  assert.deepEqual(parseExpertIntent('帮我跑同业看板：宁德时代'),{action:'expert.create',slug:'sector-peer-landscape',input:'宁德时代'});
  assert.deepEqual(parseExpertIntent('跑同业看板：宁德时代'),{action:'expert.create',slug:'sector-peer-landscape',input:'宁德时代'});
  assert.deepEqual(parseExpertIntent('请帮我跑同业看板：宁德时代'),{action:'expert.create',slug:'sector-peer-landscape',input:'宁德时代'});
  assert.deepEqual(parseExpertIntent('麻烦跑同业看板：宁德时代'),{action:'expert.create',slug:'sector-peer-landscape',input:'宁德时代'});
  assert.deepEqual(parseExpertIntent('帮我跑全景图：测试企业'),{action:'expert.create',slug:'outbound-investment-panorama',input:'测试企业'});
  assert.deepEqual(parseExpertIntent('请帮我跑全景图：测试企业'),{action:'expert.create',slug:'outbound-investment-panorama',input:'测试企业'});
  assert.deepEqual(parseExpertIntent('帮我跑前沿播客：具身智能'),{action:'expert.create',slug:'frontier-podcast',input:'具身智能'});
  assert.deepEqual(parseExpertIntent('帮我跑一个储能赛道同业看板'),{action:'expert.create',slug:'sector-peer-landscape',input:'储能'});
  assert.deepEqual(parseExpertIntent('请帮我跑一个储能赛道同业看板'),{action:'expert.create',slug:'sector-peer-landscape',input:'储能'});
  assert.deepEqual(parseExpertIntent('请列专家'),{action:'experts.list'});
  assert.equal(parseExpertIntent('帮我'),null);
  assert.equal(parseExpertIntent('帮我跑同业看板：https://outside.test'),null);
  assert.equal(isExpertCommand('帮我跑同业看板：宁德时代'),true);
  assert.equal(isExpertCommand('请帮我跑'),true);
  assert.equal(isExpertCommand('这周储能市场有什么变化？'),false);
});
