import {sql,type Tx} from "@aihot/backend/db";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {authorized,agentEnabled} from "./authorization.ts";
import {dispatchReadingReply} from "./replies.ts";
import {knowledgeIlinkActor,listKnowledgeBases,searchKnowledgePages,answerKnowledgeQuestion,KnowledgeError} from "../knowledge/service.ts";
import {KB_QUEUE} from "./knowledge-queue.ts";
import {z} from "zod";

type Action="knowledge.list_bases"|"knowledge.search"|"knowledge.answer";
type Run={id:string;inbound_id:string;user_id:string;binding_version:number;grant_id:string;action:Action;base_id:string|null;query:string|null};
export const kbEnabled=()=>process.env.P3_ILINK_KB_ENABLED==="true"&&agentEnabled()&&process.env.P3_ILINK_READING_REPLIES_ENABLED==="true";
export const isKnowledgeCommand=(body:string)=>/^(?:(?:查|问|搜|搜索|选|选择|列)?知识库)/.test(body.trim());
export type KnowledgeIntent={action:Action;query?:string;selection?:string};
const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("knowledge.list_bases"),selection:z.string().min(1).max(80).optional()}).strict(),
  z.object({action:z.literal("knowledge.search"),query:z.string().min(2).max(400)}).strict(),
  z.object({action:z.literal("knowledge.answer"),query:z.string().min(2).max(400)}).strict(),
]);
export function validateKnowledgeAction(value:unknown):KnowledgeIntent|null{
  const parsed=actionSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}
/** A deliberately small grammar. No model output or arbitrary object can choose an actor or endpoint. */
export function parseKnowledgeIntent(body:string):KnowledgeIntent|null{
  const input=body.trim();
  if(input.length>500)return null;
  if(/^(?:知识库|列知识库|知识库列表)$/.test(input))return {action:"knowledge.list_bases"};
  const select=/^(?:选知识库|选择知识库)\s*[:：]?\s*([^\s:：]{1,80})$/.exec(input);
  if(select)return {action:"knowledge.list_bases",selection:select[1]};
  const search=/^(?:搜知识库|搜索知识库)\s*[:：]\s*(.{2,400})$/.exec(input);
  if(search)return {action:"knowledge.search",query:search[1]};
  const ask=/^(?:查知识库|问知识库)\s*[:：]\s*(.{2,400})$/.exec(input);
  if(ask)return {action:"knowledge.answer",query:ask[1]};
  return null;
}
export async function admitKnowledgeRun(tx:Tx,row:{id:string;user_id:string;binding_version:number},intent:KnowledgeIntent){
  if(!kbEnabled())return false;
  const validated=validateKnowledgeAction(intent);
  if(!validated)return false;
  const [grant]=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${row.user_id}`;
  if(!grant||!await authorized(tx,row.user_id,row.binding_version,grant.grant_id))return false;
  const [created]=await tx<{id:string}[]>`INSERT INTO member_ilink_kb_runs(id,inbound_id,user_id,binding_version,grant_id,action,query,status)
    VALUES(${row.id},${row.id},${row.user_id},${row.binding_version},${grant.grant_id}::uuid,${validated.action},${validated.selection?`@select:${validated.selection}`:validated.query??null},'pending')
    ON CONFLICT(inbound_id) DO NOTHING RETURNING id`;
  if(created)await enqueueOn(KB_QUEUE,{runId:created.id},{singletonKey:created.id},tx);
  return true;
}
const words={
  knowledge_no_coverage:"这个库暂时没有足够材料回答。可以换一个库，或到网站补充材料。",
  knowledge_answer_unverified:"这次回答未通过来源核对，未返回结论。",
  knowledge_answer_conflict:"依据材料刚发生变化，请重新查询。",
  knowledge_answer_failed:"知识库回答暂时失败；可先查看相关知识页。",
  knowledge_base_not_found:"所选知识库已归档或不可用。请回复“知识库”重新选择。",
  knowledge_forbidden:"知识库暂时不可用，请检查微信授权。",
  knowledge_question_required:"请用“查知识库：问题”提问。",
} as const;
function link(slug:string){try{const url=new URL(process.env.SITE_URL??"");if(!["http:","https:"].includes(url.protocol)||!url.host)throw new Error("invalid_site_url");return `${url.origin}/knowledge/targets/${encodeURIComponent(slug)}`;}catch{return "请登录网站查看来源";}}
async function choose(run:Run,bases:Array<{id:string;name:string}>,selection?:string){
  const [current]=await sql<{base_id:string|null;binding_version:number}[]>`SELECT base_id,binding_version FROM member_ilink_kb_conversations WHERE user_id=${run.user_id}`;
  if(selection){
    const index=/^\d+$/.test(selection)?Number(selection)-1:-1;
    const found=bases.find(base=>base.id===selection||base.name===selection)??bases[index];
    if(!found)return {base:null,reply:"这个编号或库名不可用。请回复“知识库”查看当前列表。"};
    await sql`INSERT INTO member_ilink_kb_conversations(user_id,binding_version,base_id) VALUES(${run.user_id},${run.binding_version},${found.id})
      ON CONFLICT(user_id) DO UPDATE SET binding_version=excluded.binding_version,base_id=excluded.base_id,updated_at=now()`;
    return {base:found,reply:`已选择“${found.name}”。可回复“查知识库：问题”或“搜知识库：关键词”。`};
  }
  if(current?.binding_version===run.binding_version&&current.base_id){
    const found=bases.find(base=>base.id===current.base_id);
    if(!found)return {base:null,reply:words.knowledge_base_not_found};
    return {base:found,reply:null};
  }
  if(bases.length===1){
    const found=bases[0]!;
    await sql`INSERT INTO member_ilink_kb_conversations(user_id,binding_version,base_id) VALUES(${run.user_id},${run.binding_version},${found.id})
      ON CONFLICT(user_id) DO UPDATE SET binding_version=excluded.binding_version,base_id=excluded.base_id,updated_at=now()`;
    return {base:found,reply:null};
  }
  return {base:null,reply:bases.length?`请先选知识库：\n${bases.slice(0,20).map((base,i)=>`${i+1}. ${base.name}`).join("\n")}\n回复“选知识库 1”，再重发问题。`:"当前没有可用的知识库。"};
}
export async function processKnowledgeRun(id:string){
  if(!kbEnabled())return;
  const [run]=await sql<Run[]>`UPDATE member_ilink_kb_runs SET status='running' WHERE id=${id} AND status='pending' RETURNING id,inbound_id,user_id,binding_version,grant_id,action,base_id,query`;
  if(!run)return;
  if(!await sql.begin(tx=>authorized(tx,run.user_id,run.binding_version,run.grant_id))){await sql`UPDATE member_ilink_kb_runs SET status='cancelled',finished_at=now() WHERE id=${id}`;return;}
  let body="",baseId:string|null=null,answerId:string|null=null,errorCode:string|null=null;
  try{
    const actor=knowledgeIlinkActor(run.user_id,run.binding_version,run.grant_id);
    const bases=await listKnowledgeBases(actor);
    const selection=run.query?.startsWith("@select:")?run.query.slice(8):undefined;
    const picked=await choose(run,bases,selection);
    baseId=picked.base?.id??null;
    if(selection)body=picked.reply??"";
    else if(run.action==="knowledge.list_bases")body=`当前知识库：\n${bases.slice(0,20).map((b,i)=>`${i+1}. ${b.name}${b.id===baseId?"（已选）":""}`).join("\n")||"暂无"}\n回复“选知识库 1”。`;
    else if(picked.reply)body=picked.reply;
    else if(baseId&&run.query){
      if(run.action==="knowledge.search"){
        const found=await searchKnowledgePages(actor,baseId,run.query,"",3,0);
        body=found.pages.length?`找到的知识页：\n${found.pages.map((p,i)=>`${i+1}. ${p.targetName??p.slug}\n${link(String(p.slug))}`).join("\n")}`:words.knowledge_no_coverage;
      }else{
        const answer=await answerKnowledgeQuestion(actor,baseId,run.query,{short:true});
        answerId=answer.id;
        if(answer.citations.length>3)throw new KnowledgeError("knowledge_answer_unverified");
        const sourceLines=answer.citations.slice(0,3).map((c,i)=>`${i+1}. ${(c.documentTitle??"材料标题未知").slice(0,80)} · ${c.publishedOn??"日期未知"}\n${link(c.pageSlug)}`).join("\n");
        const sourceBlock=`\n来源：\n${sourceLines}`;
        const room=Math.max(250,1500-sourceBlock.length);
        body=answer.answerMd.replace(/\[([^\]]+)\]\(\/knowledge\/targets\/[^)]+\)/g,"[$1]").slice(0,room);
        body+=sourceBlock;
      }
    }
  }catch(error){errorCode=error instanceof KnowledgeError?error.code:"knowledge_answer_failed";body=words[errorCode as keyof typeof words]??words.knowledge_answer_failed;}
  body=body.slice(0,1500);
  const allowed=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${run.user_id}))`;
    if(!await authorized(tx,run.user_id,run.binding_version,run.grant_id)){
      await tx`UPDATE member_ilink_kb_runs SET status='cancelled',finished_at=now() WHERE id=${id}`;return false;
    }
    await tx`UPDATE member_ilink_kb_runs SET status=${errorCode?'failed':'succeeded'},base_id=${baseId},answer_id=${answerId},error_code=${errorCode},finished_at=now() WHERE id=${id} AND status='running'`;
    await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body,kb_run_id)
      VALUES(${id},${run.inbound_id},${run.user_id},${run.binding_version},${body},${id}) ON CONFLICT DO NOTHING`;
    return true;
  });
  if(allowed)await dispatchReadingReply(id);
}
/** A started run may already have paid the model. Never automatically repeat it. */
export async function recoverKnowledgeRuns(){
  if(!kbEnabled())return {queued:0};
  await sql`UPDATE member_ilink_kb_runs SET status='unknown',error_code='worker_interrupted',finished_at=now() WHERE status='running' AND created_at<now()-interval '10 minutes'`;
  const pending=await sql<{id:string}[]>`SELECT id FROM member_ilink_kb_runs WHERE status='pending' ORDER BY created_at LIMIT 100`;
  for(const row of pending)await enqueueOn(KB_QUEUE,{runId:row.id},{singletonKey:row.id});
  return {queued:pending.length};
}
export async function knowledgeReplyVisible(tx:Tx,runId:string){
  const [run]=await tx<{user_id:string;binding_version:number;grant_id:string;base_id:string|null;answer_id:string|null}[]>`SELECT user_id,binding_version,grant_id,base_id,answer_id FROM member_ilink_kb_runs WHERE id=${runId} AND status IN ('succeeded','failed')`;
  if(!run||!kbEnabled()||!await authorized(tx,run.user_id,run.binding_version,run.grant_id))return false;
  if(!run.base_id)return true;
  const [base]=await tx`SELECT 1 FROM member_wiki_bases WHERE id=${run.base_id} AND status='active'`;
  if(!base)return false;
  if(!run.answer_id)return true;
  const [answer]=await tx<{citations:Array<{pageSlug:string;versionId:string;citationId:string}>}[]>`SELECT citations FROM member_wiki_answers WHERE id=${run.answer_id} AND asked_by=${run.user_id}`;
  if(!answer||!Array.isArray(answer.citations)||!answer.citations.length)return false;
  for(const citation of answer.citations){
    const [visible]=await tx`SELECT 1 FROM member_wiki_pages p JOIN member_wiki_page_revisions r ON r.page_id=p.id AND r.revision=(SELECT max(revision) FROM member_wiki_page_revisions WHERE page_id=p.id)
      JOIN member_wiki_citations c ON c.page_id=p.id AND c.revision=r.revision
      JOIN member_wiki_document_versions v ON v.id=c.version_id JOIN member_wiki_documents d ON d.id=v.document_id
      WHERE p.slug=${citation.pageSlug} AND p.base_id=${run.base_id} AND p.status='published' AND c.id=${citation.citationId} AND c.version_id=${citation.versionId} AND d.status='active' AND d.base_id=${run.base_id} LIMIT 1`;
    if(!visible)return false;
  }
  return true;
}
