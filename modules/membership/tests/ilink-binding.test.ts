import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {installModules} from "@aihot/backend/modules";
import {closeDb,sql} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {buildApp} from "../../../apps/api/src/app.ts";
import {SERVER_MODULES} from "../../../site/modules/server.ts";
import {pollMemberIlinkInboxes} from "../notifications/inbox.ts";
import {dispatchOutbox} from "../notifications/outbox.ts";

test("two approved browser sessions scan independently, auto bind and cannot steal bot identities",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  const oldDelivery=process.env.P3_DELIVERY_ENABLED;
  const sent:Array<{recipient:string;authorization:string;text:string}> = [];
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="c".repeat(64);
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  let sequence=0,stolen=false;
  globalThis.fetch=(async(input,init)=>{
    const url=String(input);
    const authorization=new Headers(init?.headers).get("authorization")??"";
    const msg=init?.body?JSON.parse(String(init.body)) as {msg?:{to_user_id?:string;item_list?:Array<{text_item?:{text:string}}>}}:null;
    if(url.includes("/sendmessage"))sent.push({recipient:msg?.msg?.to_user_id??"",authorization,text:msg?.msg?.item_list?.[0]?.text_item?.text??""});
    const response=url.includes("get_bot_qrcode")?
      {qrcode:"qr-"+(++sequence),qrcode_img_content:"https://liteapp.weixin.qq.com/q/test?qrcode="+sequence}:
      url.includes("get_qrcode_status")?
      {status:"confirmed",ilink_user_id:stolen?"user-1":"user-"+new URL(url).searchParams.get("qrcode")?.slice(3),
       ilink_bot_id:stolen?"bot-1":"bot-"+new URL(url).searchParams.get("qrcode")?.slice(3),
       bot_token:"test-token-"+sequence,baseurl:"https://ilinkai.weixin.qq.com"}:
      url.includes("getupdates")?{ret:0,get_updates_buf:"cursor-"+authorization,
        msgs:[{from_user_id:authorization==="Bearer test-token-1"?"user-1":"user-2",
          to_user_id:authorization==="Bearer test-token-1"?"bot-1":"bot-2",
          context_token:"ctx-"+authorization}]}:{ret:0};
    return new Response(JSON.stringify(response),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
    if(oldDelivery===undefined)delete process.env.P3_DELIVERY_ENABLED;else process.env.P3_DELIVERY_ENABLED=oldDelivery;
    await app.close();await stopBossNow();await closeDb();
  });
  const cookies:string[]=[];
  const ids:string[]=[];
  for(let i=0;i<2;i++){
    const username="ilink-"+randomUUID().slice(0,8);
    const register=await app.inject({method:"POST",url:"/api/v1/membership/register",headers:origin,payload:{username,realName:"扫码员工",password:"long-test-password-123"}});
    assert.equal(register.statusCode,201);
    const noApproval=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,payload:{username,password:"long-test-password-123"}});
    assert.equal(noApproval.statusCode,403);
    const [user]=await sql<{id:string}[]>`UPDATE member_users SET status='active' WHERE username=${username} RETURNING id`;
    ids.push(user!.id);
    const login=await app.inject({method:"POST",url:"/api/v1/membership/login",headers:origin,payload:{username,password:"long-test-password-123"}});
    assert.equal(login.statusCode,200);
    const h=login.headers["set-cookie"];
    cookies.push((Array.isArray(h)?h[0]!:h!).split(";",1)[0]!);
  }
  for(let i=0;i<2;i++){
    const session={...origin,cookie:cookies[i]!};
    const first=await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session});
    assert.equal(first.statusCode,200);
    assert((await first.json() as {qrUrl:string}).qrUrl.includes("liteapp.weixin.qq.com"));
    const raced=await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:session});
    assert.equal(raced.statusCode,429);
    const checked=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:{cookie:cookies[i]!}});
    assert.equal(checked.statusCode,200);
    assert.equal((await checked.json() as {status:string}).status,"bound");
    const [binding]=await sql<{recipient_id:string;channel_account_id:string}[]>`SELECT recipient_id,channel_account_id FROM member_weixin_bindings WHERE user_id=${ids[i]!}`;
    assert.equal(binding!.recipient_id,"user-"+(i+1));
    assert.equal(binding!.channel_account_id,"bot-"+(i+1));
    const [channel]=await sql<{token_ciphertext:string;channel_state:string}[]>`SELECT token_ciphertext,channel_state FROM member_ilink_accounts WHERE user_id=${ids[i]!}`;
    assert.notEqual(channel!.token_ciphertext,"test-token-"+(i+1));
    assert.equal(channel!.channel_state,"needs_interaction");
    const [settings]=await sql<{news_enabled:boolean;gp_enabled:boolean}[]>`SELECT news_enabled,gp_enabled FROM member_notification_settings WHERE user_id=${ids[i]!}`;
    assert(settings!.news_enabled&&settings!.gp_enabled);
  }
  const [one]=await sql<{recipient_id:string}[]>`SELECT recipient_id FROM member_weixin_bindings WHERE user_id=${ids[0]!}`;
  const [two]=await sql<{recipient_id:string}[]>`SELECT recipient_id FROM member_weixin_bindings WHERE user_id=${ids[1]!}`;
  assert.notEqual(one!.recipient_id,two!.recipient_id);
  const inbound=await pollMemberIlinkInboxes();
  assert("recovered" in inbound&&inbound.recovered===2,"each bot must accept inbound context only from its own user");
  const date=new Date().toISOString().slice(0,10);
  for(let i=0;i<2;i++){
    const id=randomUUID();
    const [settings]=await sql<{binding_version:number;news_version:number}[]>`SELECT binding_version,news_version FROM member_notification_settings WHERE user_id=${ids[i]!}`;
    await sql`INSERT INTO member_notification_outbox
      (id,user_id,kind,local_date,binding_version,subscription_version,part_index,payload,payload_sha256,window_end_at,sources_tracked)
      VALUES(${id},${ids[i]!},'news',${date}::date,${settings!.binding_version},${settings!.news_version},0,
        ${"private-message-"+(i+1)},'fixture',now(),true)`;
  }
  process.env.P3_DELIVERY_ENABLED="true";
  const dispatch=await dispatchOutbox({revalidate:async job=>job.payload,
    post:async()=>{throw new Error("per-member iLink must not use the legacy single-bot bridge");}});
  assert.equal(dispatch.accepted,2);
  assert.deepEqual(sent.map(x=>x.recipient).sort(),["user-1","user-2"]);
  assert(sent.some(x=>x.authorization==="Bearer test-token-1"&&x.recipient==="user-1"&&x.text==="private-message-1"));
  assert(sent.some(x=>x.authorization==="Bearer test-token-2"&&x.recipient==="user-2"&&x.text==="private-message-2"));
  delete process.env.P3_DELIVERY_ENABLED;
  const unbind=await app.inject({method:"POST",url:"/api/v1/membership/weixin/unbind",headers:{...origin,cookie:cookies[1]!}});
  assert.equal(unbind.statusCode,200);
  assert.equal((await sql`SELECT user_id FROM member_ilink_accounts WHERE user_id=${ids[1]!}`).length,0);
  stolen=true;
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:{...origin,cookie:cookies[1]!}})).statusCode,200);
  const collision=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:{cookie:cookies[1]!}});
  assert.equal(collision.statusCode,409);
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${ids[1]!}`).length,0);
});
