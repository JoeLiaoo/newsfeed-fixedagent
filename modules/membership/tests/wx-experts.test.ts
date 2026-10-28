import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {installModules} from '@aihot/backend/modules';
import {closeDb,sql} from '@aihot/backend/db';
import {stopBossNow} from '@aihot/backend/jobs/queue';
import {buildApp} from '../../../apps/api/src/app.ts';
import {SERVER_MODULES} from '../../../site/modules/server.ts';
import {tag} from '../../../tests/setup.ts';
import {processReadingInbound} from '../conversation/replies.ts';
import {enqueueExpertTaskEventWake,recoverExpertTaskEvents} from '../conversation/task-events.ts';
import {EXPERT_EVENT_QUEUE} from '../conversation/task-event-queue.ts';
import {ilinkExpertActor,getExpertTask,checkExpertActor,createExpertTask,cancelExpertTask,ExpertServiceError} from '../experts/service.ts';
import {runExpertTask} from '../experts/worker.ts';

test('WX-C2 creates once, isolates owners, confirms stored entity and recovers unique events',async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();t.after(async()=>{await app.close();await stopBossNow();await closeDb();});
  const flags=['P3_ILINK_EXPERTS_ENABLED','P3_ILINK_EXPERT_EVENT_WAKE_ENABLED','P3_ILINK_READING_REPLIES_ENABLED','P3_DELIVERY_ENABLED','P3_ILINK_AGENT_ENABLED','P3_ILINK_BINDING_ENABLED','SITE_URL'];
  const previous=Object.fromEntries(flags.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  Object.assign(process.env,{P3_ILINK_EXPERTS_ENABLED:'false',P3_ILINK_EXPERT_EVENT_WAKE_ENABLED:'false',P3_ILINK_READING_REPLIES_ENABLED:'true',P3_DELIVERY_ENABLED:'true',P3_ILINK_AGENT_ENABLED:'false',P3_ILINK_BINDING_ENABLED:'false',SITE_URL:'https://site.example.test'});
  const suffix=tag(),users:string[]=[];
  for(const label of ['a','b']){
    const username=`wx-c2-${label}-${suffix}`;
    assert.equal((await app.inject({method:'POST',url:'/api/v1/membership/register',headers:{host:'newsfeed.test',origin:'http://newsfeed.test'},payload:{username,realName:'专家测试',password:'long-test-password-123'}})).statusCode,201);
    const [user]=await sql<{id:string}[]>`UPDATE member_users SET status='active' WHERE username=${username} RETURNING id`;users.push(user!.id);
    await sql`INSERT INTO member_notification_settings(user_id) VALUES(${user!.id}) ON CONFLICT(user_id) DO NOTHING`;
    await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id) VALUES(${user!.id},${`recipient-${user!.id}`},${`bot-${user!.id}`})`;
    await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url) VALUES(${user!.id},${`recipient-${user!.id}`},${`bot-${user!.id}`},'fixture','https://example.test')`;
    await sql`INSERT INTO member_agent_grants(user_id) VALUES(${user!.id})`;
  }
  async function inbound(userId:string,body:string){const id=randomUUID();await sql`INSERT INTO member_ilink_inbound_messages(id,user_id,binding_version,bot_id,upstream_id,body) VALUES(${id},${userId},1,${`bot-${userId}`},${id},${body})`;await processReadingInbound(id);return id;}
  const helpOff=await inbound(users[0]!,'帮助');
  assert.doesNotMatch((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${helpOff}`)[0]!.body,/专家任务/);
  const off=await inbound(users[0]!,'跑同业看板：机器人赛道');
  assert.equal((await sql`SELECT 1 FROM member_expert_tasks WHERE user_id=${users[0]}`).length,0);
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${off}`)[0]!.body,/展开 1/);
  process.env.P3_ILINK_EXPERTS_ENABLED='true';
  const helpOn=await inbound(users[0]!,'帮助');
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${helpOn}`)[0]!.body,/列专家/);
  assert.doesNotMatch((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${helpOn}`)[0]!.body,/自由聊/);
  const list=await inbound(users[0]!,'列专家');assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${list}`)[0]!.body,/同业/);
  const create=await inbound(users[0]!,'跑全景图：测试企业');await processReadingInbound(create);
  const [watch]=await sql<{task_id:string;alias:string}[]>`SELECT task_id,alias FROM member_ilink_task_watches WHERE created_inbound_id=${create}`;
  assert.equal(watch?.alias,'A');
  assert.equal((await sql`SELECT 1 FROM member_expert_tasks WHERE id=${watch!.task_id}`).length,1);
  const [grant]=await sql<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${users[0]}`;
  const reusedKey=createHash('sha256').update(`${create}:expert.create`).digest('hex');
  await assert.rejects(createExpertTask(ilinkExpertActor(users[0]!,1,grant!.grant_id),{slug:'outbound-investment-panorama',companyName:'另一家企业',notes:''},{idempotencyKey:reusedKey}),error=>error instanceof ExpertServiceError&&error.code==='idempotency_conflict');
  const secondCreate=await inbound(users[0]!,'跑同业看板：机器人赛道');
  const [secondWatch]=await sql<{task_id:string;alias:string}[]>`SELECT task_id,alias FROM member_ilink_task_watches WHERE created_inbound_id=${secondCreate}`;
  assert.equal(secondWatch!.alias,'B');
  const overLimit=await inbound(users[0]!,'跑前沿播客：具身智能');
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${overLimit}`)[0]!.body,/额度已满/);
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_expert_tasks WHERE user_id=${users[0]}`)[0]!.count,2);

  await assert.rejects(getExpertTask(ilinkExpertActor(users[1]!,1,(await sql<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${users[1]}`)[0]!.grant_id),watch!.task_id),error=>error instanceof ExpertServiceError&&error.code==='task_not_found');
  const foreignStatus=await inbound(users[1]!,`进度 ${watch!.task_id}`);
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${foreignStatus}`)[0]!.body,/未找到本人/);
  const otherCreate=await inbound(users[1]!,'跑前沿播客：具身智能');
  const [otherWatch]=await sql<{task_id:string}[]>`SELECT task_id FROM member_ilink_task_watches WHERE created_inbound_id=${otherCreate}`;
  await inbound(users[1]!,'取消 A');
  assert.equal((await sql<{state:string}[]>`SELECT state FROM member_expert_tasks WHERE id=${otherWatch!.task_id}`)[0]!.state,'cancelled');
  const politeCreate=await inbound(users[1]!,'帮我跑同业看板：宁德时代');
  const [politeWatch]=await sql<{task_id:string;alias:string}[]>`SELECT task_id,alias FROM member_ilink_task_watches WHERE created_inbound_id=${politeCreate}`;
  assert.equal(politeWatch!.alias,'B');
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${politeCreate}`)[0]!.body,/任务 B 已创建/);
  const [politeTask]=await sql<{expert_slug:string;input:{query:string}}[]>`SELECT expert_slug,input FROM member_expert_tasks WHERE id=${politeWatch!.task_id}`;
  assert.equal(politeTask!.expert_slug,'sector-peer-landscape');
  assert.equal(politeTask!.input.query,'宁德时代');
  const politeList=await inbound(users[1]!,'请列专家');
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${politeList}`)[0]!.body,/同业/);
  const bare=await inbound(users[0]!,'2');assert.equal((await sql<{state:string}[]>`SELECT state FROM member_expert_tasks WHERE id=${watch!.task_id}`)[0]!.state,'queued');
  assert.equal((await sql`SELECT 1 FROM member_ilink_reply_outbox WHERE id=${bare}`).length,1);
  await sql`UPDATE member_expert_tasks SET state='waiting_input',stage='choose_entity',result=${sql.json({candidates:[{id:'company-1',name:'企业一'},{id:'company-2',name:'企业二'}]})},updated_at=now()+interval '1 second' WHERE id=${watch!.task_id}`;
  await recoverExpertTaskEvents();await recoverExpertTaskEvents();
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_task_events WHERE task_id=${watch!.task_id}`)[0]!.count,1);
  const [event]=await sql<{body:string}[]>`SELECT o.body FROM member_ilink_reply_outbox o JOIN member_ilink_task_events e ON e.id=o.id WHERE e.task_id=${watch!.task_id}`;
  assert.match(event!.body,/企业二/);
  const confirm=await inbound(users[0]!,'任务 A 选 2');await processReadingInbound(confirm);
  const [confirmed]=await sql<{state:string;selected_entity:{id:string}}[]>`SELECT state,selected_entity FROM member_expert_tasks WHERE id=${watch!.task_id}`;
  assert.equal(confirmed!.state,'queued');assert.equal(confirmed!.selected_entity.id,'company-2');
  await sql`UPDATE member_expert_tasks SET state='succeeded',stage='complete',result=${sql.json({summary:'有限覆盖；有未核事项',html:'<h1>private</h1>'})},updated_at=now()+interval '2 second' WHERE id=${watch!.task_id}`;
  await recoverExpertTaskEvents();await recoverExpertTaskEvents();
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_task_events WHERE task_id=${watch!.task_id}`)[0]!.count,2);
  const [terminal]=await sql<{body:string}[]>`SELECT o.body FROM member_ilink_reply_outbox o JOIN member_ilink_task_events e ON e.id=o.id WHERE e.task_id=${watch!.task_id} AND e.state='succeeded'`;
  assert.match(terminal!.body,/有限覆盖/);assert.doesNotMatch(terminal!.body,/private/);
  const mute=await inbound(users[0]!,'停止任务 A 提醒');
  assert.match((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${mute}`)[0]!.body,/已停止/);
  await sql`UPDATE member_expert_tasks SET state='failed',updated_at=now()+interval '3 second' WHERE id=${watch!.task_id}`;
  await recoverExpertTaskEvents();
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_task_events WHERE task_id=${watch!.task_id}`)[0]!.count,2,'mute stops further events');
  await sql`DELETE FROM member_agent_grants WHERE user_id=${users[0]}`;
  const helpRevoked=await inbound(users[0]!,'帮助');
  assert.doesNotMatch((await sql<{body:string}[]>`SELECT body FROM member_ilink_reply_outbox WHERE id=${helpRevoked}`)[0]!.body,/专家任务/);
  await assert.rejects(checkExpertActor(ilinkExpertActor(users[0]!,1,grant!.grant_id)),/expert_forbidden/);
  await sql`UPDATE member_expert_tasks SET state='failed',stage='failed',updated_at=now()+interval '3 second' WHERE id=${secondWatch!.task_id}`;
  await recoverExpertTaskEvents();
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_task_events WHERE task_id=${secondWatch!.task_id}`)[0]!.count,0,'revocation stops further events');
  await sql`INSERT INTO member_agent_grants(user_id) VALUES(${users[0]})`;
  const [newGrant]=await sql<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${users[0]}`;
  await sql`UPDATE member_weixin_bindings SET recipient_id='unbound-fixture' WHERE user_id=${users[0]}`;
  await assert.rejects(checkExpertActor(ilinkExpertActor(users[0]!,1,newGrant!.grant_id)),/expert_forbidden/,'binding mismatch stops new actions');

  // The status and wake job commit together. Simulate process death after commit by consuming the
  // durable job later, then replaying it and the minute scan.
  process.env.P3_ILINK_EXPERT_EVENT_WAKE_ENABLED='true';
  const [otherGrant]=await sql<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${users[1]}`;
  await cancelExpertTask(ilinkExpertActor(users[1]!,1,otherGrant!.grant_id),politeWatch!.task_id);
  const [queuedWake]=await sql`SELECT id FROM pgboss.job WHERE name=${EXPERT_EVENT_QUEUE.name} AND data->>'taskId'=${politeWatch!.task_id}`;
  assert.ok(queuedWake,'cancel commit persists the wake job');
  await EXPERT_EVENT_QUEUE.run([{taskId:politeWatch!.task_id}]);
  await EXPERT_EVENT_QUEUE.run([{taskId:politeWatch!.task_id}]);
  await recoverExpertTaskEvents();
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_task_events WHERE task_id=${politeWatch!.task_id}`)[0]!.count,1);
  assert.equal((await sql<{count:number}[]>`SELECT count(*)::int AS count FROM member_ilink_reply_outbox WHERE task_watch_id=${politeWatch!.task_id} AND id LIKE 'expert-event-%'`)[0]!.count,1);

  async function stagedFailure(alias:string,grantId:string){
    const id=randomUUID();
    await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES(${id},${users[1]},'sector-peer-landscape','queued','{}'::jsonb)`;
    await sql`INSERT INTO member_ilink_task_watches(task_id,user_id,binding_version,grant_id,alias,sequence,last_event_version)
      VALUES(${id},${users[1]},1,${grantId}::uuid,${alias},${alias.charCodeAt(0)-65},(SELECT updated_at FROM member_expert_tasks WHERE id=${id}))`;
    await sql.begin(async tx=>{
      await tx`UPDATE member_expert_tasks SET state='failed',stage='failed',updated_at=now()+interval '1 second' WHERE id=${id}`;
      await enqueueExpertTaskEventWake(id,tx);
    });
    return id;
  }
  const muted=await stagedFailure('C',otherGrant!.grant_id);
  await sql`UPDATE member_ilink_task_watches SET reminders_enabled=false WHERE task_id=${muted}`;
  await EXPERT_EVENT_QUEUE.run([{taskId:muted}]);
  assert.equal((await sql`SELECT 1 FROM member_ilink_task_events WHERE task_id=${muted}`).length,0,'stop-remind blocks queued wake');
  const revoked=await stagedFailure('D',otherGrant!.grant_id);
  await sql`DELETE FROM member_agent_grants WHERE user_id=${users[1]}`;
  await EXPERT_EVENT_QUEUE.run([{taskId:revoked}]);
  assert.equal((await sql`SELECT 1 FROM member_ilink_task_events WHERE task_id=${revoked}`).length,0,'revocation blocks queued wake');
  const [replacement]=await sql<{grant_id:string}[]>`INSERT INTO member_agent_grants(user_id) VALUES(${users[1]}) RETURNING grant_id`;
  const workerFailed=randomUUID();
  await sql`INSERT INTO member_expert_tasks(id,user_id,expert_slug,state,input) VALUES(${workerFailed},${users[1]},'frontier-podcast','queued',${sql.json({query:'x'})})`;
  await sql`INSERT INTO member_ilink_task_watches(task_id,user_id,binding_version,grant_id,alias,sequence,last_event_version)
    VALUES(${workerFailed},${users[1]},1,${replacement!.grant_id}::uuid,'E',4,(SELECT updated_at FROM member_expert_tasks WHERE id=${workerFailed}))`;
  await runExpertTask(workerFailed);
  assert.equal((await sql<{state:string}[]>`SELECT state FROM member_expert_tasks WHERE id=${workerFailed}`)[0]!.state,'failed');
  assert.equal((await sql`SELECT 1 FROM receipts WHERE member_task_id=${workerFailed}`).length,0,'event wake makes no paid model request');
  assert.ok((await sql`SELECT 1 FROM pgboss.job WHERE name=${EXPERT_EVENT_QUEUE.name} AND data->>'taskId'=${workerFailed}`).length,'worker failure commits its wake');
  await EXPERT_EVENT_QUEUE.run([{taskId:workerFailed}]);
  assert.equal((await sql`SELECT 1 FROM member_ilink_task_events WHERE task_id=${workerFailed}`).length,1);
  const rebound=await stagedFailure('F',replacement!.grant_id);
  await sql`UPDATE member_notification_settings SET binding_version=binding_version+1 WHERE user_id=${users[1]}`;
  await EXPERT_EVENT_QUEUE.run([{taskId:rebound}]);
  assert.equal((await sql`SELECT 1 FROM member_ilink_task_events WHERE task_id=${rebound}`).length,0,'rebind blocks queued wake');
});
