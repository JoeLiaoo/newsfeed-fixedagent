import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {installModules} from "@aihot/backend/modules";
import {closeDb,sql} from "@aihot/backend/db";
import {stopBossNow} from "@aihot/backend/jobs/queue";
import {buildApp} from "../../../apps/api/src/app.ts";
import {SERVER_MODULES} from "../../../site/modules/server.ts";

test("two approved browser sessions scan independently, auto bind and cannot steal bot identities",async t=>{
  installModules(SERVER_MODULES);
  const app=await buildApp();
  const previousFetch=globalThis.fetch;
  const oldFlag=process.env.P3_ILINK_BINDING_ENABLED;
  const oldKey=process.env.P3_ILINK_CREDENTIAL_KEY;
  process.env.P3_ILINK_BINDING_ENABLED="true";
  process.env.P3_ILINK_CREDENTIAL_KEY="c".repeat(64);
  const origin={host:"newsfeed.test",origin:"http://newsfeed.test"};
  let sequence=0,stolen=false;
  globalThis.fetch=(async input=>{
    const url=String(input);
    const response=url.includes("get_bot_qrcode")?
      {qrcode:"qr-"+(++sequence),qrcode_img_content:"https://liteapp.weixin.qq.com/q/test?qrcode="+sequence}:
      url.includes("get_qrcode_status")?
      {status:"confirmed",ilink_user_id:stolen?"user-1":"user-"+new URL(url).searchParams.get("qrcode")?.slice(3),
       ilink_bot_id:stolen?"bot-1":"bot-"+new URL(url).searchParams.get("qrcode")?.slice(3),
       bot_token:"test-token-"+sequence,baseurl:"https://ilinkai.weixin.qq.com"}:{ret:0};
    return new Response(JSON.stringify(response),{status:200});
  }) as typeof fetch;
  t.after(async()=>{
    globalThis.fetch=previousFetch;
    if(oldFlag===undefined)delete process.env.P3_ILINK_BINDING_ENABLED;else process.env.P3_ILINK_BINDING_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=oldKey;
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
  const unbind=await app.inject({method:"POST",url:"/api/v1/membership/weixin/unbind",headers:{...origin,cookie:cookies[1]!}});
  assert.equal(unbind.statusCode,200);
  assert.equal((await sql`SELECT user_id FROM member_ilink_accounts WHERE user_id=${ids[1]!}`).length,0);
  stolen=true;
  assert.equal((await app.inject({method:"POST",url:"/api/v1/membership/weixin/start",headers:{...origin,cookie:cookies[1]!}})).statusCode,200);
  const collision=await app.inject({method:"GET",url:"/api/v1/membership/weixin/status",headers:{cookie:cookies[1]!}});
  assert.equal(collision.statusCode,409);
  assert.equal((await sql`SELECT user_id FROM member_weixin_bindings WHERE user_id=${ids[1]!}`).length,0);
});
