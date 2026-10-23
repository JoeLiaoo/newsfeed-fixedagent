import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {after,test} from "node:test";
import {installModules} from "@aihot/backend/modules";
import {closeDb,sql} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {buildApp} from "../../../apps/api/src/app.ts";
import {SERVER_MODULES} from "../../../site/modules/server.ts";
import {completeIlinkBinding} from "../notifications/binding.ts";
import {encryptSecret} from "../notifications/ilink.ts";
import {pollMemberIlinkInboxes} from "../notifications/inbox.ts";
import {confirmPendingIlinkBindings} from "../notifications/scan.ts";

after(async()=>{await stopBossNow();await closeDb();});

type Upstream={
  qrStatus:"wait"|"confirmed"|"expired";
  qrBroken:boolean;
  inbound:boolean;
  recipient:string;
  bot:string;
  sent:Array<{recipient:string;authorization:string;text:string;clientId:string}>;
};

test("the server finishes a scan on its own, and the page and the worker cannot bind twice",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  const oldDelivery=process.env.P3_DELIVERY_ENABLED;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="c".repeat(64);
  const upstream:Upstream={qrStatus:"wait",qrBroken:false,inbound:false,recipient:"",bot:"",sent:[]};
  let sequence=0;
  globalThis.fetch=(async(input,init)=>{
    const url=String(input);
    const headers=new Headers(init?.headers);
    const authorization=headers.get("authorization")??"";
    if(url.includes("/sendmessage")){
      const body=init?.body?JSON.parse(String(init.body)) as {msg:{to_user_id:string;client_id:string;item_list:Array<{text_item:{text:string}}>}}:null;
      upstream.sent.push({recipient:body?.msg.to_user_id??"",authorization,text:body?.msg.item_list[0]?.text_item.text??"",clientId:body?.msg.client_id??""});
      return new Response(JSON.stringify({ret:0}),{status:200});
    }
    if(url.includes("get_bot_qrcode"))
      return new Response(JSON.stringify({qrcode:"qr-"+(++sequence),qrcode_img_content:"https://liteapp.weixin.qq.com/q/test?qrcode="+sequence}),{status:200});
    if(url.includes("get_qrcode_status")){
      if(upstream.qrBroken)return new Response(JSON.stringify({ret:-1,errmsg:"upstream unavailable"}),{status:200});
      if(upstream.qrStatus==="confirmed")return new Response(JSON.stringify({status:"confirmed",
        ilink_user_id:upstream.recipient,ilink_bot_id:upstream.bot,bot_token:"token-"+upstream.bot,baseurl:"https://ilinkai.weixin.qq.com"}),{status:200});
      return new Response(JSON.stringify({status:upstream.qrStatus}),{status:200});
    }
    if(url.includes("getupdates")){
      const body=init?.body?JSON.parse(String(init.body)) as {get_updates_buf?:string}:null;
      const fresh=!body?.get_updates_buf;
      const msgs=fresh&&upstream.inbound?
        [{from_user_id:upstream.recipient,to_user_id:upstream.bot,context_token:"ctx-1"}]:[];
      return new Response(JSON.stringify({ret:0,get_updates_buf:"cursor-"+(fresh?1:2),msgs}),{status:200});
    }
    return new Response(JSON.stringify({ret:0}),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
    if(oldDelivery===undefined)delete process.env.P3_DELIVERY_ENABLED;else process.env.P3_DELIVERY_ENABLED=oldDelivery;
    await app.close();
  });
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  const username="scan-"+randomUUID().slice(0,8);
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,payload:{username,realName:"扫码员工",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,payload:{username,password:"long-test-password-123"}});
  assert.equal(login.statusCode,200);
  const cookieHeader=login.headers["set-cookie"];
  const cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(";",1)[0]!;
  const session={...origin,cookie};
  const [user]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${username}`;
  const userId=user!.id;

  // The page starts a scan and never polls it again: the worker has to finish it.
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session})).statusCode,200);
  const [startedScan]=await sql<{qr_secret:string}[]>`SELECT qr_secret FROM member_ilink_logins WHERE user_id=${userId}`;
  upstream.recipient="user-scan";upstream.bot="bot-scan";upstream.qrStatus="confirmed";
  const confirmed=await confirmPendingIlinkBindings();
  assert.equal(confirmed.bound,1);
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${userId}`).length,1);
  assert.equal((await sql`SELECT user_id FROM member_ilink_accounts WHERE user_id=${userId}`).length,1);
  assert.equal((await sql`SELECT user_id FROM member_ilink_logins WHERE user_id=${userId}`).length,0);
  const [account]=await sql<{recipient_id:string;channel_account_id:string;token_ciphertext:string}[]>
    `SELECT recipient_id,channel_account_id,token_ciphertext FROM member_ilink_accounts WHERE user_id=${userId}`;
  assert.equal(account!.recipient_id,"user-scan");
  assert.equal(account!.channel_account_id,"bot-scan");
  assert.notEqual(account!.token_ciphertext,"token-bot-scan");
  // The page sees the binding the worker wrote.
  const status=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:session});
  assert.equal(status.statusCode,200);
  assert.equal((await status.json() as {status:string}).status,"bound");
  // A second run finds no scan left and writes nothing.
  const again=await confirmPendingIlinkBindings();
  assert.equal(again.bound,0);
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${userId}`).length,1);

  // The same confirmation twice keeps one binding and one account.
  const [sessionRow]=await sql<{token_hash:string}[]>`SELECT token_hash FROM member_sessions WHERE user_id=${userId}`;
  const repeat=await completeIlinkBinding(userId,sessionRow!.token_hash,startedScan!.qr_secret,{
    recipientId:"user-scan",channelAccountId:"bot-scan",botToken:"token-bot-scan",base:"https://ilinkai.weixin.qq.com"});
  assert.equal(repeat,"already_bound");
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${userId}`).length,1);
  assert.equal((await sql`SELECT user_id FROM member_ilink_accounts WHERE user_id=${userId}`).length,1);
});

test("a failed scan is reported as an error and can be replaced, and an expired scan binds nothing",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="d".repeat(64);
  let sequence=0,broken=true;
  globalThis.fetch=(async(input)=>{
    const url=String(input);
    if(url.includes("get_bot_qrcode"))
      return new Response(JSON.stringify({qrcode:"qr-"+(++sequence),qrcode_img_content:"https://liteapp.weixin.qq.com/q/test?qrcode="+sequence}),{status:200});
    if(url.includes("get_qrcode_status"))
      return new Response(JSON.stringify(broken?{ret:-1,errmsg:"upstream unavailable"}:{status:"expired"}),{status:200});
    return new Response(JSON.stringify({ret:0}),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
    await app.close();
  });
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  const username="scan-"+randomUUID().slice(0,8);
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,payload:{username,realName:"扫码员工",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,payload:{username,password:"long-test-password-123"}});
  const cookieHeader=login.headers["set-cookie"];
  const cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(";",1)[0]!;
  const session={...origin,cookie};
  const [user]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${username}`;
  const userId=user!.id;

  const first=await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session});
  assert.equal(first.statusCode,200);
  const firstQr=(await first.json() as {qrUrl:string}).qrUrl;
  // The channel fails: the status says so instead of pretending the scan is still waiting.
  const failed=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:session});
  assert.equal(failed.statusCode,502);
  assert.equal((await failed.json() as {status:string}).status,"error");
  const [marked]=await sql<{status:string}[]>`SELECT status FROM member_ilink_logins WHERE user_id=${userId}`;
  assert.equal(marked!.status,"error");
  // A failed scan can be replaced by a new QR.
  const second=await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session});
  assert.equal(second.statusCode,200);
  assert.notEqual((await second.json() as {qrUrl:string}).qrUrl,firstQr);
  const [waiting]=await sql<{status:string}[]>`SELECT status FROM member_ilink_logins WHERE user_id=${userId}`;
  assert.equal(waiting!.status,"wait");
  // The channel reports the scan as expired: nothing is bound and the scan is marked expired.
  broken=false;
  const expired=await confirmPendingIlinkBindings();
  assert.equal(expired.bound,0);
  assert.equal(expired.expired,1);
  const [gone]=await sql<{status:string;expires_at:Date}[]>`SELECT status,expires_at FROM member_ilink_logins WHERE user_id=${userId}`;
  assert.equal(gone!.status,"expired");
  assert(gone!.expires_at.getTime()<=Date.now());
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${userId}`).length,0);
  const expiredStatus=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:session});
  assert.equal(expiredStatus.statusCode,200);
  assert.equal((await expiredStatus.json() as {status:string}).status,"expired");
});

test("an in-flight result from a replaced QR cannot change or bind its successor",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="f".repeat(64);
  let sequence=0;
  let signalPoll:(()=>void)|undefined;
  let releasePoll:((response:Response)=>void)|undefined;
  globalThis.fetch=(async(input)=>{
    const url=String(input);
    if(url.includes("get_bot_qrcode"))
      return new Response(JSON.stringify({qrcode:"qr-"+(++sequence),qrcode_img_content:"https://liteapp.weixin.qq.com/q/test?qrcode="+sequence}),{status:200});
    if(url.includes("get_qrcode_status"))return new Promise<Response>(resolve=>{releasePoll=resolve;signalPoll?.();});
    return new Response(JSON.stringify({ret:0}),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
    await app.close();
  });
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  const username="scan-"+randomUUID().slice(0,8);
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,
    payload:{username,realName:"扫码员工",password:"long-test-password-123"}})).statusCode,201);
  await sql`UPDATE member_users SET status='active' WHERE username=${username}`;
  const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,
    payload:{username,password:"long-test-password-123"}});
  assert.equal(login.statusCode,200);
  const cookieHeader=login.headers["set-cookie"];
  const cookie=(Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!).split(";",1)[0]!;
  const session={...origin,cookie};
  const [user]=await sql<{id:string}[]>`SELECT id FROM member_users WHERE username=${username}`;
  const userId=user!.id;
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session})).statusCode,200);

  const identity={status:"confirmed",ilink_user_id:"old-user",ilink_bot_id:"old-bot",
    bot_token:"old-token",baseurl:"https://ilinkai.weixin.qq.com"};
  const scenarios=[
    {source:"worker",answer:identity},
    {source:"worker",answer:{ret:-1,errmsg:"upstream unavailable"}},
    {source:"worker",answer:{status:"expired"}},
    {source:"worker",answer:{status:"scaned_but_redirect",redirect_host:"us.ilinkai.weixin.qq.com"}},
    {source:"worker",answer:{status:"wait"}},
    {source:"page",answer:identity},
    {source:"page",answer:{ret:-1,errmsg:"upstream unavailable"}},
    {source:"page",answer:{status:"expired"}},
    {source:"page",answer:{status:"scaned_but_redirect",redirect_host:"us.ilinkai.weixin.qq.com"}},
    {source:"page",answer:{status:"wait"}},
    {source:"verify",answer:identity}
  ] as const;
  for(const scenario of scenarios){
    const [oldScan]=await sql<{qr_secret:string}[]>`SELECT qr_secret FROM member_ilink_logins WHERE user_id=${userId}`;
    await sql`UPDATE member_ilink_logins SET status='error',last_polled_at=NULL WHERE user_id=${userId}`;
    const entered=new Promise<void>(resolve=>{signalPoll=resolve;});
    let pageStatus:number|null=null;
    const pending=scenario.source==="worker"?confirmPendingIlinkBindings().then(()=>{})
      :app.inject(scenario.source==="verify"
        ?{method:"POST",url:"/api/v1/membership/weixin/verify",headers:session,payload:{verifyCode:"1234"}}
        :{method:"GET",url:"/api/v1/membership/weixin/status",headers:session})
        .then(response=>{pageStatus=response.statusCode;});
    await entered;
    const replacement=await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session});
    assert.equal(replacement.statusCode,200);
    const [newScan]=await sql<{qr_secret:string;status:string}[]>`SELECT qr_secret,status FROM member_ilink_logins WHERE user_id=${userId}`;
    assert.notEqual(newScan!.qr_secret,oldScan!.qr_secret);
    assert(releasePoll);
    releasePoll(new Response(JSON.stringify(scenario.answer),{status:200}));
    await pending;
    if(scenario.source!=="worker")assert.equal(pageStatus,409);
    const [still]=await sql<{qr_secret:string;status:string;api_url:string}[]>`SELECT qr_secret,status,api_url FROM member_ilink_logins WHERE user_id=${userId}`;
    assert.equal(still!.qr_secret,newScan!.qr_secret);
    assert.equal(still!.status,"wait");
    assert.equal(still!.api_url,"https://ilinkai.weixin.qq.com");
    assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${userId}`).length,0);
    assert.equal((await sql`SELECT user_id FROM member_ilink_accounts WHERE user_id=${userId}`).length,0);
    signalPoll=undefined;
    releasePoll=undefined;
  }
});

test("the first inbound message confirms the connection once, and only while delivery is enabled",async t=>{
  installModules(SERVER_MODULES);
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  const oldDelivery=process.env.P3_DELIVERY_ENABLED;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="e".repeat(64);
  process.env.P3_DELIVERY_ENABLED="true";
  const sent:Array<{recipient:string;authorization:string;text:string;clientId:string}>=[];
  const recipient="user-"+randomUUID().slice(0,8),bot="bot-"+randomUUID().slice(0,8);
  globalThis.fetch=(async(input,init)=>{
    const url=String(input);
    const headers=new Headers(init?.headers);
    const authorization=headers.get("authorization")??"";
    if(url.includes("/sendmessage")){
      const body=init?.body?JSON.parse(String(init.body)) as {msg:{to_user_id:string;client_id:string;item_list:Array<{text_item:{text:string}}>}}:null;
      sent.push({recipient:body?.msg.to_user_id??"",authorization,text:body?.msg.item_list[0]?.text_item.text??"",clientId:body?.msg.client_id??""});
      return new Response(JSON.stringify({ret:0}),{status:200});
    }
    if(url.includes("getupdates")){
      const body=init?.body?JSON.parse(String(init.body)) as {get_updates_buf?:string}:null;
      const fresh=!body?.get_updates_buf;
      return new Response(JSON.stringify({ret:0,get_updates_buf:"cursor-"+(fresh?1:2),
        msgs:fresh?[{from_user_id:recipient,to_user_id:bot,context_token:"ctx-1"}]:[]}),{status:200});
    }
    return new Response(JSON.stringify({ret:0}),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
    if(oldDelivery===undefined)delete process.env.P3_DELIVERY_ENABLED;else process.env.P3_DELIVERY_ENABLED=oldDelivery;
  });
  const userId="member-"+randomUUID().slice(0,8);
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${userId},${"greet-"+userId},'员工','test-hash','active','member')`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${userId},${recipient},${bot})`;
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url,channel_state)
    VALUES(${userId},${recipient},${bot},${encryptSecret("token-"+bot)},
      'https://ilinkai.weixin.qq.com','needs_interaction')`;
  const polled=await pollMemberIlinkInboxes();
  assert.equal(polled.recovered,1);
  assert.equal(polled.greeted,1);
  assert.equal(sent.length,1);
  assert.equal(sent[0]!.recipient,recipient);
  assert.equal(sent[0]!.authorization,"Bearer token-"+bot);
  assert.equal(sent[0]!.text,"已连接，之后会在这里推送。");
  const [greeted]=await sql<{greeted_at:Date|null}[]>`SELECT greeted_at FROM member_ilink_accounts WHERE user_id=${userId}`;
  assert(greeted!.greeted_at instanceof Date);
  // The account keeps its cursor, so the next poll has no new message and sends nothing.
  const again=await pollMemberIlinkInboxes();
  assert.equal(again.greeted,0);
  assert.equal(sent.length,1);

  // A second account gets no confirmation while the delivery switch is off.
  const otherId="member-"+randomUUID().slice(0,8);
  const otherRecipient="user-"+randomUUID().slice(0,8),otherBot="bot-"+randomUUID().slice(0,8);
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${otherId},${"greet-"+otherId},'员工','test-hash','active','member')`;
  await sql`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
    VALUES(${otherId},${otherRecipient},${otherBot})`;
  await sql`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url,channel_state)
    VALUES(${otherId},${otherRecipient},${otherBot},${encryptSecret("token-"+otherBot)},
      'https://ilinkai.weixin.qq.com','needs_interaction')`;
  delete process.env.P3_DELIVERY_ENABLED;
  const quiet=await pollMemberIlinkInboxes();
  assert.equal(quiet.greeted,0);
  assert.equal(sent.length,1);
});
