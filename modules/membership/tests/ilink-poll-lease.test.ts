import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {after,test} from "node:test";
import {sql,closeDb} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {installModules} from "@aihot/backend/modules";
import {SERVER_MODULES} from "../../../site/modules/server.ts";
import {claimIlinkPoll,pollMemberIlinkInboxes,settleIlinkPoll} from "../notifications/inbox.ts";
import {decryptSecret,encryptSecret} from "../notifications/ilink.ts";

const key="a".repeat(64);
after(async()=>{await stopBossNow();await closeDb();});
function response(bot:string,id:string,cursor:string){
  return {cursor,contextToken:"context-"+cursor,receivedAt:new Date(),pollDurationMs:1,hadInbound:true,
    messages:[{id,seq:"1",text:"帮助",contextToken:"context-"+cursor}]};
}
async function fixture(){
  const user=randomUUID(),bot="bot-"+user,recipient="recipient-"+user;
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status)
    VALUES(${user},${"lease-"+user},'合成员工','fixture','active')`;
  await sql`INSERT INTO member_notification_settings(user_id) VALUES(${user})`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${user},${recipient},${bot})`;
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url)
    VALUES(${user},${recipient},${bot},${encryptSecret("fixture")},'https://ilinkai.weixin.qq.com')`;
  return {user,bot,recipient};
}

test("poll lease fences racing workers, expired responses, crash replay and duplicate IDs",async t=>{
  installModules(SERVER_MODULES);
  const old=Object.fromEntries(["P3_ILINK_CREDENTIAL_KEY","P3_ILINK_READING_REPLIES_ENABLED","P3_DELIVERY_ENABLED"].map(k=>[k,process.env[k]]));
  process.env.P3_ILINK_CREDENTIAL_KEY=key;
  process.env.P3_ILINK_READING_REPLIES_ENABLED="true";
  process.env.P3_DELIVERY_ENABLED="false";
  t.after(async()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  });
  const {user,bot}=await fixture();
  const [first,loser]=await Promise.all([claimIlinkPoll(user),claimIlinkPoll(user)]);
  assert.equal([first,loser].filter(Boolean).length,1,"only one worker owns the Bot");
  const held=first??loser!;
  assert.equal(await claimIlinkPoll(user),null);
  // The upstream response arrives, then the process dies before committing it.
  const replay=response(bot,"crash-id","cursor-1");
  await sql`UPDATE member_ilink_accounts SET poll_lease_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${user}`;
  const replacement=await claimIlinkPoll(user);
  assert(replacement&&replacement.generation>held.generation);
  assert.equal((await settleIlinkPoll(held,replay)).committed,false,"expired generation cannot write");
  const commitStarted=performance.now();
  assert.equal((await settleIlinkPoll(replacement,replay)).committed,true);
  console.log(`synthetic iLink poll commit ${Math.round(performance.now()-commitStarted)}ms (21s lease headroom)`);
  const [saved]=await sql<{cursor_ciphertext:string}[]>`SELECT cursor_ciphertext FROM member_ilink_accounts WHERE user_id=${user}`;
  assert.equal(decryptSecret(saved!.cursor_ciphertext),"cursor-1");
  assert.equal((await settleIlinkPoll(held,response(bot,"late-id","stale-cursor"))).committed,false);
  const duplicate=await claimIlinkPoll(user);assert(duplicate);
  const same=response(bot,"crash-id","cursor-2");
  same.messages.push({...same.messages[0]!});
  assert.equal((await settleIlinkPoll(duplicate,same)).committed,true);
  const [count]=await sql<{count:number}[]>`SELECT count(*)::integer AS count FROM member_ilink_inbound_messages WHERE user_id=${user}`;
  assert.equal(count!.count,1,"duplicate upstream IDs enqueue only one inbound");
  const [job]=await sql`SELECT j.id FROM pgboss.job j JOIN member_ilink_inbound_messages i
    ON j.singleton_key=i.id WHERE i.user_id=${user} AND i.upstream_id='crash-id'`;
  assert(job,"inbound and business enqueue commit together");
  const [latest]=await sql<{cursor_ciphertext:string}[]>`SELECT cursor_ciphertext FROM member_ilink_accounts WHERE user_id=${user}`;
  assert.equal(decryptSecret(latest!.cursor_ciphertext),"cursor-2");
  const slow=await claimIlinkPoll(user);assert(slow);
  await sql`UPDATE member_ilink_accounts SET poll_lease_expires_at=clock_timestamp()+interval '50 milliseconds'
    WHERE user_id=${user}`;
  await sql.unsafe("CREATE FUNCTION test_delay_ilink_inbound() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$");
  await sql.unsafe("CREATE TRIGGER test_delay_ilink_inbound BEFORE INSERT ON member_ilink_inbound_messages FOR EACH ROW EXECUTE FUNCTION test_delay_ilink_inbound()");
  try{
    await assert.rejects(settleIlinkPoll(slow,response(bot,"expired-during-commit","bad-cursor")),/ilink_poll_lease_expired_before_commit/);
  }finally{
    await sql.unsafe("DROP TRIGGER test_delay_ilink_inbound ON member_ilink_inbound_messages");
    await sql.unsafe("DROP FUNCTION test_delay_ilink_inbound()");
  }
  assert.equal((await sql`SELECT id FROM member_ilink_inbound_messages WHERE user_id=${user} AND upstream_id='expired-during-commit'`).length,0);
  const [afterRollback]=await sql<{cursor_ciphertext:string}[]>`SELECT cursor_ciphertext FROM member_ilink_accounts WHERE user_id=${user}`;
  assert.equal(decryptSecret(afterRollback!.cursor_ciphertext),"cursor-2");
});

test("unbind and rebind can complete during a pending getupdates; old response cannot cross binding versions",async t=>{
  const old=Object.fromEntries(["P3_ILINK_CREDENTIAL_KEY","P3_ILINK_BINDING_ENABLED","P3_ILINK_READING_REPLIES_ENABLED","P3_DELIVERY_ENABLED"].map(k=>[k,process.env[k]]));
  const oldFetch=globalThis.fetch;
  process.env.P3_ILINK_CREDENTIAL_KEY=key;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_READING_REPLIES_ENABLED="false";
  process.env.P3_DELIVERY_ENABLED="false";
  t.after(async()=>{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  });
  const {user,bot,recipient}=await fixture();
  let release!:(value:Response)=>void;
  const waiting=new Promise<Response>(resolve=>{release=resolve;});
  let started!:()=>void;
  const sent=new Promise<void>(resolve=>{started=resolve;});
  globalThis.fetch=(async(_input,init)=>{
    const request=JSON.parse(String(init?.body)) as {get_updates_buf:string};
    if(request.get_updates_buf)return new Response(JSON.stringify({ret:0,get_updates_buf:request.get_updates_buf,msgs:[]}),{status:200});
    started();return waiting;
  }) as typeof fetch;
  const running=pollMemberIlinkInboxes();
  await sent;
  // This transaction uses the same lock order as the actual unbind and binding paths.
  await Promise.race([sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${user}))`;
    await tx`DELETE FROM member_weixin_bindings WHERE user_id=${user}`;
    await tx`DELETE FROM member_ilink_accounts WHERE user_id=${user}`;
    await tx`UPDATE member_notification_settings SET binding_version=binding_version+1 WHERE user_id=${user}`;
    await tx`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
      VALUES(${user},${recipient},${bot})`;
    await tx`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url,cursor_ciphertext)
      VALUES(${user},${recipient},${bot},${encryptSecret("new-token")},'https://ilinkai.weixin.qq.com',${encryptSecret("new-cursor")})`;
  }),new Promise((_,reject)=>setTimeout(()=>reject(new Error("binding blocked by network poll")),1000))]);
  release(new Response(JSON.stringify({ret:0,get_updates_buf:"stale-cursor",msgs:[{
    message_id:"old-message",seq:"1",from_user_id:recipient,to_user_id:bot,
    message_type:1,message_state:2,context_token:"old-context",item_list:[{type:1,text_item:{text:"帮助"}}],
  }]}),{status:200}));
  await running;
  const [current]=await sql<{cursor_ciphertext:string;context_ciphertext:string|null}[]>`
    SELECT cursor_ciphertext,context_ciphertext FROM member_ilink_accounts WHERE user_id=${user}`;
  assert.equal(decryptSecret(current!.cursor_ciphertext),"new-cursor");
  assert.equal(current!.context_ciphertext,null);
  assert.equal((await sql`SELECT id FROM member_ilink_inbound_messages WHERE user_id=${user} AND upstream_id='old-message'`).length,0);
  const fresh=await claimIlinkPoll(user);assert(fresh);
  assert.equal(fresh.row.binding_version,2);
  assert.equal((await settleIlinkPoll(fresh,response(bot,"new-message","fresh-cursor"))).committed,true);
  const [inbound]=await sql<{binding_version:number}[]>`SELECT binding_version FROM member_ilink_inbound_messages WHERE user_id=${user}`;
  assert.equal(inbound!.binding_version,2);
});
