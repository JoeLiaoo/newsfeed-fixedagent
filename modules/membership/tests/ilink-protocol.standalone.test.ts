import assert from "node:assert/strict";
import {test} from "node:test";
import {createIlinkQr,decryptSecret,encryptSecret,ilinkErrorKind,pollIlinkInbox,pollIlinkQr,
 parseIlinkInbound,sendIlinkText,trustedIlinkBase} from "../notifications/ilink.ts";

test("iLink provider boundary encrypts tokens and rejects origin redirects",async()=>{
  const before=process.env.P3_ILINK_CREDENTIAL_KEY;
  process.env.P3_ILINK_CREDENTIAL_KEY="a".repeat(64);
  try{
    const secret="example-bot-token";
    const ciphertext=encryptSecret(secret);
    assert.notEqual(ciphertext,secret);
    assert.equal(decryptSecret(ciphertext),secret);
    assert.throws(()=>trustedIlinkBase("https://ilinkai.weixin.qq.com.attacker.test"));
    assert.throws(()=>trustedIlinkBase("http://ilinkai.weixin.qq.com"));
    assert.throws(()=>trustedIlinkBase("https://ilinkai.weixin.qq.com:4444"));
  }finally{if(before===undefined)delete process.env.P3_ILINK_CREDENTIAL_KEY;else process.env.P3_ILINK_CREDENTIAL_KEY=before;}
});
test("iLink batch keeps only complete user text with reliable IDs",()=>{
  const text=(id:unknown,from="user-A",state=2)=>({message_id:id,seq:"12",from_user_id:from,to_user_id:"bot-A",
    message_type:1,message_state:state,item_list:[{type:1,text_item:{text:"知识库"}}],context_token:"ctx"});
  const largeId=JSON.parse('{"message_id":1234567890123456789}') as {message_id:number};
  const messages=parseIlinkInbound([text("m1"),text("m2"),text("echo","bot-A"),text("partial","user-A",1),
    text(largeId.message_id),{...text(null),seq:73},{...text(null),seq:null,client_id:"client-backup"},
    {...text("outbound"),message_type:2},{...text("empty"),item_list:[{type:1,text_item:{text:""}}]},
    {...text("media"),item_list:[{type:2}]}],{botId:"bot-A",recipientId:"user-A"});
  assert.deepEqual(messages.map(message=>message.id),["m1","m2",String(Math.trunc(largeId.message_id)),"73","client-backup","empty","media"]);
  assert.equal(messages[2]!.text,"知识库");
  assert.equal(messages[5]!.text,"");
  assert.equal(messages[6]!.text,"");
});
test("iLink QR auth and notification transport route to exactly one member",async()=>{
  const calls:Array<{url:string;headers:Headers;body:any}>=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);
    const headers=new Headers(init?.headers);
    const payload=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:null;
    calls.push({url,headers,body:payload});
    const response=url.includes("get_bot_qrcode")?
      {qrcode:"temporary-challenge",qrcode_img_content:"https://liteapp.weixin.qq.com/q/example?qrcode=test"}:
      url.includes("get_qrcode_status")?
      {status:"confirmed",ilink_user_id:"user-A",ilink_bot_id:"bot-A",bot_token:"secret-A",baseurl:"https://ilinkai.weixin.qq.com"}:
      url.includes("getupdates")?
      {ret:0,get_updates_buf:"next-cursor",msgs:[{from_user_id:"user-B",to_user_id:"bot-A",context_token:"wrong-user"},
        {message_id:"inbound",from_user_id:"user-A",to_user_id:"bot-A",message_type:1,message_state:2,
          item_list:[{type:1,text_item:{text:"知识库"}}],context_token:"correct-context"},
        {message_id:"outbound-shape",from_user_id:"user-A",to_user_id:"bot-A",message_type:2,message_state:2,
          item_list:[{type:1,text_item:{text:"忽略"}}],context_token:"wrong-type"}]}:
      {ret:0};
    return new Response(JSON.stringify(response),{status:200,headers:{"content-type":"application/json"}});
  };
  const qr=await createIlinkQr(fetcher);
  assert.equal(qr.code,"temporary-challenge");
  assert.match(qr.url,/liteapp\.weixin\.qq\.com/);
  const linked=await pollIlinkQr(qr.code,undefined,undefined,fetcher);
  assert.equal(linked.userId,"user-A");
  assert.equal(linked.botId,"bot-A");
  assert.equal(linked.botToken,"secret-A");
  const account={botId:"bot-A",recipientId:"user-A",token:"secret-A",base:"https://ilinkai.weixin.qq.com",contextToken:"correct-context"};
  const inbox=await pollIlinkInbox({...account,cursor:"old-cursor"},fetcher);
  assert.equal(inbox.contextToken,"correct-context");
  assert(inbox.hadInbound);
  assert.deepEqual(inbox.messages.map(message=>message.text),["知识库"]);
  const receipt=await sendIlinkText(account,"Hello A","outbox-id-A",fetcher);
  assert.equal(receipt.accepted,true);
  const send=calls.find(c=>c.url.includes("/sendmessage"));
  assert.equal(send?.body.msg.to_user_id,"user-A");
  assert.equal(send?.body.msg.context_token,"correct-context");
  assert.equal(send?.body.msg.client_id,"outbox-id-A");
  assert.equal(send?.body.msg.message_type,2);
  assert.equal(send?.headers.get("Authorization"),"Bearer secret-A");
  assert.equal(ilinkErrorKind({ret:-14}),"requires_rebind");
  assert.equal(ilinkErrorKind({ret:-2,message:"session not ready"}),"needs_interaction");
  assert.equal(ilinkErrorKind({ret:-2,message:"rate limited"}),"rate_limited");
});

test("iLink getupdates aborts when its worker shuts down",async()=>{
  const shutdown=new AbortController();
  let started!:()=>void;
  const requestStarted=new Promise<void>(resolve=>{started=resolve;});
  const fetcher:typeof fetch=async(_input,init)=>{
    started();
    return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
    });
  };
  const pending=pollIlinkInbox({botId:"bot-A",recipientId:"user-A",token:"fixture",
    base:"https://ilinkai.weixin.qq.com"},fetcher,shutdown.signal);
  await requestStarted;
  shutdown.abort(new Error("worker shutdown"));
  await assert.rejects(pending,/worker shutdown/);
});
