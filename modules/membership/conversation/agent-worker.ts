import {sql,type Tx} from "@aihot/backend/db";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {agentEnabled,authorized} from "./authorization.ts";
import {agentUnavailableHelp} from "./help.ts";
import {askHermes} from "./hermes.ts";
import {withinBudget,type AgentUsage} from "./usage.ts";
import {AGENT_QUEUE} from "./agent-queue.ts";
import {dispatchReadingReply} from "./replies.ts";

type Run={id:string;inbound_id:string;user_id:string;binding_version:number;grant_id:string;created_at:Date};
type Count={hour:number;day:number;global_day:number;running:number};

async function counts(tx:Tx,userId:string):Promise<Count>{
  const [row]=await tx<Count[]>`SELECT
    COALESCE(SUM(CASE WHEN user_id=${userId} AND created_at>now()-interval '1 hour' THEN
      COALESCE(api_calls,2) ELSE 0 END),0)::int AS hour,
    COALESCE(SUM(CASE WHEN user_id=${userId} AND created_at>now()-interval '1 day' THEN
      COALESCE(api_calls,2) ELSE 0 END),0)::int AS day,
    COALESCE(SUM(CASE WHEN created_at>now()-interval '1 day' THEN COALESCE(api_calls,2) ELSE 0 END),0)::int AS global_day,
    COUNT(*) FILTER(WHERE status='running')::int AS running
    FROM member_agent_runs WHERE status IN ('pending','running','succeeded','failed','unknown')
      AND created_at>now()-interval '1 day'`;
  return row!;
}

async function reply(tx:Tx,run:Run,body:string){
  await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body,agent_run_id)
    VALUES(${run.id},${run.inbound_id},${run.user_id},${run.binding_version},${body},${run.id}) ON CONFLICT DO NOTHING`;
}

export async function admitAgentRun(tx:Tx,row:{id:string;user_id:string;binding_version:number;body:string}):Promise<"queued"|"unavailable">{
  // The caller already holds this user's transaction lock. Serialize all budgets globally.
  await tx`SELECT pg_advisory_xact_lock(1480112026)`;
  const [grant]=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${row.user_id}`;
  if(!grant||!await authorized(tx,row.user_id,row.binding_version,grant.grant_id))return "unavailable";
  const [waiting]=await tx<{n:number}[]>`SELECT count(*)::int AS n FROM member_agent_runs WHERE user_id=${row.user_id} AND status='pending'`;
  const budget=await counts(tx,row.user_id);
  if(waiting!.n>=3||!withinBudget(budget.hour,budget.day,budget.global_day))return "unavailable";
  const [created]=await tx<{id:string}[]>`INSERT INTO member_agent_runs(id,inbound_id,user_id,binding_version,grant_id,status)
    VALUES(${row.id},${row.id},${row.user_id},${row.binding_version},${grant.grant_id}::uuid,'pending')
    ON CONFLICT(inbound_id) DO NOTHING RETURNING id`;
  if(created)await enqueueOn(AGENT_QUEUE,{runId:created.id},{singletonKey:created.id},tx);
  return "queued";
}

function promptFor(history:Array<{body:string;answer:string}>,question:string):string{
  const lines=["你是员工微信里的简短问答助手。只依据当前文字回答；不知道就明确说不知道。不要执行工具、读取文件或声称已执行外部动作。回答尽量不超过900字。"];
  let size=0;
  for(const turn of history.reverse()){
    const fragment=`员工：${turn.body.slice(0,700)}\n助手：${turn.answer.slice(0,900)}`;
    if(size+fragment.length>4500)break;
    lines.push(fragment);size+=fragment.length;
  }
  lines.push(`员工：${question}\n助手：`);
  return lines.join("\n\n");
}

export async function processAgentRun(id:string):Promise<void>{
  if(!agentEnabled())return;
  const [candidate]=await sql<Run[]>`SELECT id,inbound_id,user_id,binding_version,grant_id,created_at
    FROM member_agent_runs WHERE id=${id} AND status='pending'`;
  if(!candidate)return;
  const claimed=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(1480112026)`;
    const [run]=await tx<Run[]>`SELECT id,inbound_id,user_id,binding_version,grant_id,created_at
      FROM member_agent_runs WHERE id=${id} AND status='pending' FOR UPDATE SKIP LOCKED`;
    if(!run)return null;
    if(!await authorized(tx,run.user_id,run.binding_version,run.grant_id)){
      await tx`UPDATE member_agent_runs SET status='cancelled',finished_at=now() WHERE id=${id}`;return null;
    }
    if(run.created_at.getTime()<Date.now()-600_000){
      await tx`UPDATE member_agent_runs SET status='expired',finished_at=now() WHERE id=${id}`;return null;
    }
    const budget=await counts(tx,run.user_id);
    // A pending run already reserves two calls in counts; do not reserve it twice.
    if(!withinBudget(budget.hour-2,budget.day-2,budget.global_day-2)){
      await tx`UPDATE member_agent_runs SET status='failed',error_code='budget_exhausted',finished_at=now() WHERE id=${id}`;
      await reply(tx,run,await agentUnavailableHelp(tx,run.user_id,run.binding_version));
      return "budget";
    }
    if(budget.running>=2)return null;
    const [sameUser]=await tx`SELECT 1 FROM member_agent_runs WHERE user_id=${run.user_id} AND status='running'`;
    if(sameUser)return null;
    await tx`UPDATE member_agent_runs SET status='running',started_at=now(),lease_expires_at=now()+interval '55 seconds' WHERE id=${id}`;
    return run;
  });
  if(claimed==="budget"){await dispatchReadingReply(id);return;}
  if(!claimed)return;
  const [inbound]=await sql<{body:string}[]>`SELECT body FROM member_ilink_inbound_messages WHERE id=${claimed.inbound_id}`;
  if(!inbound)return;
  const history=await sql<{body:string;answer:string}[]>`SELECT i.body,r.answer FROM member_agent_runs r
    JOIN member_ilink_inbound_messages i ON i.id=r.inbound_id
    WHERE r.user_id=${claimed.user_id} AND r.binding_version=${claimed.binding_version}
      AND r.grant_id=${claimed.grant_id} AND r.status='succeeded' AND r.id<>${id}
    ORDER BY r.created_at DESC LIMIT 6`;
  let answer="",usage:AgentUsage|null=null;
  let errorCode:string|null=null;
  try{
    const result=await askHermes(promptFor(history,inbound.body));
    usage=result.usage;
    answer=result.answer.length>900?result.answer.slice(0,890)+"…（回答已截短）":result.answer;
    answer=answer.slice(0,1400);
  }catch(error){errorCode=error instanceof Error?error.message:"runner_failed";}
  const shouldSend=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${claimed.user_id}))`;
    const [live]=await tx`SELECT 1 FROM member_agent_runs WHERE id=${id} AND status='running' FOR UPDATE`;
    if(!live)return false;
    const allowed=await authorized(tx,claimed.user_id,claimed.binding_version,claimed.grant_id);
    await tx`UPDATE member_agent_runs SET status=${allowed?(errorCode?'failed':'succeeded'):'cancelled'},
      answer=${allowed?answer:null},api_calls=${usage?.apiCalls??null},total_tokens=${usage?.totalTokens??null},
      model=${usage?.model??null},provider=${usage?.provider??null},
      cost_status=${usage?.costStatus??null},estimated_cost_usd=${usage?.estimatedCostUsd??null},
      error_code=${errorCode},finished_at=now(),lease_expires_at=NULL WHERE id=${id}`;
    if(allowed)await reply(tx,claimed,errorCode?await agentUnavailableHelp(tx,claimed.user_id,claimed.binding_version):answer);
    return allowed;
  });
  if(shouldSend)await dispatchReadingReply(id);
}

export async function recoverAgentRuns():Promise<{queued:number}>{
  if(!agentEnabled())return {queued:0};
  // Once a paid call might have started, its outcome is unknown. Never enqueue it again.
  await sql`UPDATE member_agent_runs SET status='unknown',error_code='lease_expired',finished_at=now(),lease_expires_at=NULL
    WHERE status='running' AND lease_expires_at<now()`;
  await sql`UPDATE member_agent_runs SET status='expired',finished_at=now() WHERE status='pending' AND expires_at<now()`;
  const due=await sql<{id:string}[]>`SELECT id FROM member_agent_runs WHERE status='pending' ORDER BY created_at LIMIT 100`;
  for(const run of due)await enqueueOn(AGENT_QUEUE,{runId:run.id},{singletonKey:run.id});
  return {queued:due.length};
}
