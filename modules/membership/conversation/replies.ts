import {sql} from "@aihot/backend/db";
import {listedCondition} from "@aihot/backend/publication/scope";
import {enqueueOn} from "@aihot/backend/jobs/queue";
import {decryptSecret,ilinkConfigured,ilinkErrorKind,sendIlinkText} from "../notifications/ilink.ts";
import type {CompactItem} from "../notifications/presentation.ts";
import {readingIntent} from "./intent.ts";
import {READING_QUEUE} from "./queue.ts";
import {agentEnabled,authorized} from "./authorization.ts";
import {agentUnavailableHelp,capabilitiesHelp,currentIlinkCapabilities} from "./help.ts";
import {admitAgentRun} from "./agent-worker.ts";
import {kbEnabled,parseKnowledgeIntent,admitKnowledgeRun,knowledgeReplyVisible,isKnowledgeCommand} from "./knowledge.ts";
import {expertsEnabled,parseExpertIntent,isExpertCommand,handleExpertInbound} from "./experts.ts";
import {ilinkExpertActor,checkExpertActor} from "../experts/service.ts";

type Inbound={id:string;user_id:string;binding_version:number;body:string;status:string};
type SnapshotItem={source_key:string;title:string;tags:string[]};
function siteHome(){const value=process.env.SITE_URL??"";try{return new URL(value).origin+"/";}catch{return "请登录网站首页查看。";}}
type ReadingAnswer=string|{body:string;page:number;editionId:string};
async function answer(row:Inbound,help:string):Promise<ReadingAnswer>{
  if(!row.body)return `当前支持文字消息。${help}`;
  if(row.body.length>1000)return `消息较长，请缩短到 1000 字以内。${help}`;
  const intent=readingIntent(row.body);
  if(intent.kind==="help")return help;
  if(intent.kind==="unknown")return help;
  const [edition]=await sql<{outbox_id:string;local_date:string;preference_version:number;displayed_items:CompactItem[];page:number}[]>`
    SELECT e.outbox_id,e.local_date::text AS local_date,e.preference_version,e.displayed_items,c.page
    FROM member_ilink_conversations c JOIN member_news_compact_editions e ON e.outbox_id=c.outbox_id
    WHERE c.user_id=${row.user_id} AND c.binding_version=${row.binding_version} AND e.binding_version=${row.binding_version}`;
  if(!edition)return intent.kind==="ping"?"通道已恢复。近期暂无可展开的短日报，请登录网站查看。":
    "近期暂无可展开的短日报，请登录网站查看。";
  if(intent.kind==="ping")return "通道已恢复。"+help;
  if(intent.kind==="detail"){
    const item=edition.displayed_items[intent.number-1];
    if(!item)return `本期只有 ${edition.displayed_items.length} 条编号资讯。`;
    const [current]=await sql<{title:string;summary:string|null;url:string;source_name:string}[]>`SELECT p.title,p.summary,p.url,s.name AS source_name
      FROM publications p JOIN sources s ON s.id=p.source_id
      WHERE COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id)=${item.key}
        AND ${listedCondition(new Date())}
        AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${row.user_id} AND t.tag=ANY(p.tags))
      ORDER BY p.timeline_at DESC LIMIT 1`;
    if(!current)return "这条内容已撤回或不再对你可见。";
    return `${intent.number}. ${current.title}\n${current.summary??"暂无摘要"}\n来源：${current.source_name}\n${current.url}`.slice(0,1500);
  }
  const [digest]=await sql<{items:SnapshotItem[]}[]>`SELECT items FROM member_daily_digests
    WHERE user_id=${row.user_id} AND local_date=${edition.local_date}::date AND preference_version=${edition.preference_version}`;
  const snapshot=digest?.items??[];
  const visible=snapshot.length?await sql<SnapshotItem[]>`SELECT DISTINCT ON (COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id))
    COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id) AS source_key,p.title,p.tags
    FROM publications p WHERE COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id)=ANY(${sql.array(snapshot.map(item=>item.source_key))}::text[])
      AND ${listedCondition(new Date())}
      AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${row.user_id} AND t.tag=ANY(p.tags))
    ORDER BY COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id),p.timeline_at DESC`:[];
  const byKey=new Map(visible.map(item=>[item.source_key,item]));
  const all=snapshot.map(item=>byKey.get(item.source_key)).filter((item):item is SnapshotItem=>!!item);
  const displayed=new Set(edition.displayed_items.map(item=>item.key));
  if(intent.kind==="other"){
    const rest=all.filter(item=>!displayed.has(item.source_key));
    const counts=new Map<string,number>();
    for(const item of rest)for(const tag of item.tags)counts.set(tag,(counts.get(tag)??0)+1);
    return rest.length?`本期另有 ${rest.length} 条。其他主题：${[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([tag,n])=>`${tag} ${n} 条`).join("、")}。\n回复“主题：主题名”查看。`:
      "本期没有其他匹配资讯。";
  }
  if(intent.kind==="topic"){
    const matches=all.filter(item=>item.tags.includes(intent.topic));
    return matches.length?`本期“${intent.topic}”共 ${matches.length} 条：\n${matches.slice(0,8).map(item=>`• ${item.title}`).join("\n")}\n完整日报：${siteHome()}`:
      `本期没有“${intent.topic}”的匹配资讯。`;
  }
  if(intent.kind==="all"||intent.kind==="next"){
    const page=intent.kind==="all"?0:edition.page+1;
    if(page*8>=all.length)return "本期目录已到末页。完整内容请登录："+siteHome();
    return {page,editionId:edition.outbox_id,body:`本期完整日报共 ${all.length} 条（第 ${page+1} 页）：\n${all.slice(page*8,page*8+8).map((item,i)=>`${page*8+i+1}. ${item.title}`).join("\n")}\n${(page+1)*8<all.length?'回复“下一页”；':''}完整内容请登录：${siteHome()}`.slice(0,1500)};
  }
  return help;
}

export async function processReadingInbound(id:string):Promise<void>{
  if(process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true")return;
  const [owner]=await sql<{user_id:string}[]>`SELECT user_id FROM member_ilink_inbound_messages WHERE id=${id}`;
  if(!owner)return;
  let produced=false;
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner.user_id}))`;
    const [row]=await tx<Inbound[]>`SELECT id,user_id,binding_version,body,status FROM member_ilink_inbound_messages
      WHERE id=${id} AND expires_at>now() FOR UPDATE SKIP LOCKED`;
    if(!row||row.status!=="pending")return;
    const [valid]=await tx`SELECT 1 FROM member_ilink_accounts a JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
      AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
      JOIN member_notification_settings s ON s.user_id=a.user_id
      WHERE a.user_id=${row.user_id} AND s.binding_version=${row.binding_version}`;
    if(!valid){await tx`UPDATE member_ilink_inbound_messages SET status='cancelled' WHERE id=${id}`;return;}
    const intent=readingIntent(row.body);
    const needsHelp=!row.body||row.body.length>1000||intent.kind==="help"||intent.kind==="unknown"||intent.kind==="ping";
    const capabilities=needsHelp?await currentIlinkCapabilities(tx,row.user_id,row.binding_version):null;
    const help=capabilities?capabilitiesHelp(capabilities):"";
    if(!row.body||intent.kind==="help"||row.body.length>2000||row.body.length>1000&&!agentEnabled()){
      const result=await answer(row,help);
      const body=(typeof result==="string"?result:result.body).slice(0,1500);
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
        VALUES(${id},${id},${row.user_id},${row.binding_version},${body}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
      produced=true;return;
    }
    const kbIntent=intent.kind==="unknown"&&kbEnabled()?parseKnowledgeIntent(row.body):null;
    if(kbIntent){
      if(await admitKnowledgeRun(tx,row,kbIntent)){
        await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
        return;
      }
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
        VALUES(${id},${id},${row.user_id},${row.binding_version},${'知识库暂时不可用，请检查微信授权。'+help}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
      produced=true;return;
    }
    if(intent.kind==="unknown"&&kbEnabled()&&isKnowledgeCommand(row.body)){
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
        VALUES(${id},${id},${row.user_id},${row.binding_version},${(capabilities?.knowledge?'请用“查知识库：问题”“搜知识库：关键词”或“知识库”查看库列表。':'知识库暂时不可用，请检查微信授权。')+help}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
      produced=true;return;
    }
    if(intent.kind==="unknown"&&expertsEnabled()&&(parseExpertIntent(row.body)||isExpertCommand(row.body))){
      const expertIntent=parseExpertIntent(row.body);
      const result=expertIntent?await handleExpertInbound(tx,row,expertIntent):
        capabilities?.experts?'请用“列专家”“跑同业看板：企业或赛道”“进度 A”“任务 A 选 1”或“取消 A”。':help;
      const expertGrant=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_grants WHERE user_id=${row.user_id}`;
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body,task_watch_id,expert_grant_id)
        VALUES(${id},${id},${row.user_id},${row.binding_version},${typeof result==='string'?result:result.body},${typeof result==='string'?null:result.watchId??null},${expertGrant[0]?.grant_id??null}::uuid) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
      produced=true;return;
    }
    if(intent.kind==="unknown"&&agentEnabled()){
      const admission=await admitAgentRun(tx,row);
      if(admission==="queued"){
        await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
        return;
      }
      await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
        VALUES(${id},${id},${row.user_id},${row.binding_version},${await agentUnavailableHelp(tx,row.user_id,row.binding_version)}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
      produced=true;return;
    }
    const result=await answer(row,help);
    const body=(typeof result==="string"?result:result.body).slice(0,1500);
    await tx`INSERT INTO member_ilink_reply_outbox(id,inbound_id,user_id,binding_version,body)
      VALUES(${id},${id},${row.user_id},${row.binding_version},${body}) ON CONFLICT DO NOTHING`;
    if(typeof result!=="string")await tx`UPDATE member_ilink_conversations SET page=${result.page},updated_at=now()
      WHERE user_id=${row.user_id} AND binding_version=${row.binding_version} AND outbox_id=${result.editionId}`;
    await tx`UPDATE member_ilink_inbound_messages SET status='processed' WHERE id=${id} AND status='pending'`;
    produced=true;
  });
  if(produced)await dispatchReadingReply(id);
}

export async function dispatchReadingReply(id:string):Promise<void>{
  if(process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true"||process.env.P3_DELIVERY_ENABLED!=="true"||!ilinkConfigured())return;
  const [owner]=await sql<{user_id:string}[]>`SELECT user_id FROM member_ilink_reply_outbox WHERE id=${id}`;
  if(!owner)return;
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner.user_id}))`;
    const [reply]=await tx<{id:string;user_id:string;binding_version:number;body:string;status:string;agent_run_id:string|null;kb_run_id:string|null;expert_grant_id:string|null;task_watch_id:string|null}[]>`SELECT id,user_id,binding_version,body,status,agent_run_id,kb_run_id,expert_grant_id,task_watch_id
      FROM member_ilink_reply_outbox WHERE id=${id} AND status IN ('pending','failed') AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED`;
    if(!reply)return;
    if(reply.agent_run_id){
      const [run]=await tx<{grant_id:string}[]>`SELECT grant_id FROM member_agent_runs
        WHERE id=${reply.agent_run_id} AND status IN ('succeeded','failed')`;
      if(!run||!await authorized(tx,reply.user_id,reply.binding_version,run.grant_id)){
        await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='agent_grant_changed' WHERE id=${id}`;
        return;
      }
    }
    if(reply.kb_run_id&&!await knowledgeReplyVisible(tx,reply.kb_run_id)){
      await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='kb_source_or_grant_changed' WHERE id=${id}`;
      return;
    }
    if(reply.expert_grant_id){
      try{await checkExpertActor(ilinkExpertActor(reply.user_id,reply.binding_version,reply.expert_grant_id),tx);
        if(reply.task_watch_id){const [watch]=await tx`SELECT 1 FROM member_ilink_task_watches w JOIN member_expert_tasks t ON t.id=w.task_id AND t.user_id=w.user_id
          WHERE w.task_id=${reply.task_watch_id} AND w.user_id=${reply.user_id} AND w.binding_version=${reply.binding_version} AND w.grant_id=${reply.expert_grant_id}::uuid AND t.expires_at>now()`;
          if(!watch)throw Error('watch_revoked');
          const [event]=await tx`SELECT 1 FROM member_ilink_task_events WHERE id=${id}`;
          if(event){const [enabled]=await tx`SELECT 1 FROM member_ilink_task_watches WHERE task_id=${reply.task_watch_id} AND reminders_enabled=true`;
            if(!enabled)throw Error('reminders_disabled');}
        }
      }catch{await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='expert_grant_or_binding_changed' WHERE id=${id}`;return;}
    }
    const [recipient]=await tx<{recipient_id:string;channel_account_id:string;token_ciphertext:string;api_url:string;context_ciphertext:string|null;channel_state:string}[]>`
      SELECT a.recipient_id,a.channel_account_id,a.token_ciphertext,a.api_url,a.context_ciphertext,a.channel_state
      FROM member_ilink_accounts a JOIN member_weixin_bindings b ON b.user_id=a.user_id AND b.status='active'
        AND b.recipient_id=a.recipient_id AND b.channel_account_id=a.channel_account_id
      JOIN member_users u ON u.id=a.user_id AND u.status='active'
      JOIN member_notification_settings s ON s.user_id=a.user_id AND s.binding_version=${reply.binding_version}
      WHERE a.user_id=${reply.user_id}`;
    if(!recipient){await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='binding_changed' WHERE id=${id}`;return;}
    const [fresh]=await tx`SELECT 1 FROM member_ilink_reply_outbox WHERE id=${id} AND expires_at>now()`;
    if(!fresh){await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='expired' WHERE id=${id}`;return;}
    if(recipient.channel_state!=='active'||!recipient.context_ciphertext){
      await tx`UPDATE member_ilink_reply_outbox SET status='cancelled',error_code='channel_unavailable' WHERE id=${id}`;return;
    }
    await tx`UPDATE member_ilink_reply_outbox SET status='sending',attempts=attempts+1,lease_expires_at=now()+interval '2 minutes' WHERE id=${id}`;
    try{
      await sendIlinkText({botId:recipient.channel_account_id,recipientId:recipient.recipient_id,
        token:decryptSecret(recipient.token_ciphertext),base:recipient.api_url,
        contextToken:decryptSecret(recipient.context_ciphertext)},reply.body,id);
      await tx`UPDATE member_ilink_reply_outbox SET status='accepted',lease_expires_at=NULL,error_code=NULL WHERE id=${id}`;
    }catch(error){
      const kind=ilinkErrorKind(error);
      if(kind==='rate_limited')await tx`UPDATE member_ilink_reply_outbox SET status='failed',lease_expires_at=NULL,
        next_attempt_at=now()+interval '1 minute',error_code='rate_limited' WHERE id=${id}`;
      else{
        await tx`UPDATE member_ilink_reply_outbox SET status=${kind==='unknown'?'unknown':'cancelled'},lease_expires_at=NULL,error_code=${kind} WHERE id=${id}`;
        if(kind==='requires_rebind'||kind==='needs_interaction')await tx`UPDATE member_ilink_accounts SET channel_state=${kind} WHERE user_id=${reply.user_id}`;
      }
    }
  });
}
export async function recoverReadingReplies():Promise<{queued:number}>{
  if(process.env.P3_ILINK_READING_REPLIES_ENABLED!=="true")return {queued:0};
  await sql`UPDATE member_ilink_reply_outbox SET status='unknown',error_code='send_lease_expired',lease_expires_at=NULL
    WHERE status='sending' AND lease_expires_at<now()`;
  const inbound=await sql<{id:string}[]>`SELECT id FROM member_ilink_inbound_messages WHERE status='pending' AND expires_at>now() ORDER BY created_at LIMIT 100`;
  for(const row of inbound)await enqueueOn(READING_QUEUE,{inboundId:row.id},{singletonKey:row.id});
  const replies=await sql<{id:string}[]>`SELECT id FROM member_ilink_reply_outbox WHERE status IN ('pending','failed') AND next_attempt_at<=now() AND expires_at>now() LIMIT 100`;
  for(const row of replies)await dispatchReadingReply(row.id);
  return {queued:inbound.length};
}
