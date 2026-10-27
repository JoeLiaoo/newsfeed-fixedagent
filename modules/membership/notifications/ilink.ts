// Tencent iLink transport. Keep QR status and every bot credential on the server.
// Protocol reference: https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md
import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from "node:crypto";

export const ILINK_ROOT="https://ilinkai.weixin.qq.com";
const baseInfo={channel_version:"2.4.8",bot_agent:"Newsfeed"};
const appHeaders={"iLink-App-Id":"bot","iLink-App-ClientVersion":String(0x00020408)};
type ObjectValue=Record<string,unknown>;

const obj=(v:unknown):ObjectValue=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as ObjectValue:{};
const str=(v:unknown,max=4096)=>typeof v==="string"&&v.length>0&&v.length<=max?v:"";
function cryptoKey():Buffer {
  const value=process.env.P3_ILINK_CREDENTIAL_KEY??"";
  if(!/^[0-9a-fA-F]{64}$/.test(value))throw new Error("ilink_key_not_configured");
  return Buffer.from(value,"hex");
}
export function ilinkConfigured(){return process.env.P3_ILINK_BINDING_ENABLED==="true"&&/^[0-9a-fA-F]{64}$/.test(process.env.P3_ILINK_CREDENTIAL_KEY??"");}
export function encryptSecret(value:string):string{
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",cryptoKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(b=>b.toString("base64url")).join(".");
}
export function decryptSecret(value:string):string{
  const parts=value.split(".");if(parts.length!==3)throw new Error("invalid_encrypted_secret");
  const decipher=createDecipheriv("aes-256-gcm",cryptoKey(),Buffer.from(parts[0]!,"base64url"));
  decipher.setAuthTag(Buffer.from(parts[1]!,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2]!,"base64url")),decipher.final()]).toString("utf8");
}
export function trustedIlinkBase(value:unknown):string{
  const text=typeof value==="string"?value:ILINK_ROOT;
  const url=new URL(text);
  // Never use caller-provided URLs. Region redirects must remain inside Tencent's iLink domain.
  if(url.protocol!=="https:"||url.username||url.password||url.port||
    !(url.hostname==="ilinkai.weixin.qq.com"||/^[a-z0-9-]+\.ilinkai\.weixin\.qq\.com$/.test(url.hostname))||
    url.pathname!=="/"&&url.pathname!==""||url.search||url.hash)throw new Error("untrusted_ilink_origin");
  return url.origin;
}
function uin(){return Buffer.from(String(randomBytes(4).readUInt32BE())).toString("base64");}
export async function ilinkRequest(base:string,path:string,options:{
  method?:"GET"|"POST";token?:string;payload?:ObjectValue;timeoutMs?:number;fetcher?:typeof fetch;
}={}):Promise<ObjectValue>{
  const root=trustedIlinkBase(base);
  const fetcher=options.fetcher??fetch;
  const headers:Record<string,string>={...appHeaders};
  if(options.method!=="GET"){
    headers["Content-Type"]="application/json";
    headers["AuthorizationType"]="ilink_bot_token";
    headers["X-WECHAT-UIN"]=uin();
    if(options.token)headers["Authorization"]="Bearer "+options.token;
  }
  const response=await fetcher(root+path,{
    method:options.method??"POST",headers,
    body:options.method==="GET"?undefined:JSON.stringify(options.payload??{}),
    redirect:"error",signal:AbortSignal.timeout(options.timeoutMs??12000)
  });
  if(!response.ok)throw new Error("ilink_http_"+response.status);
  const raw=await response.text();
  if(raw.length>512_000)throw new Error("ilink_response_too_large");
  const value=obj(JSON.parse(raw));
  if(typeof value.ret==="number"&&value.ret!==0)throw Object.assign(new Error("ilink_ret_"+value.ret+"_"+str(value.errmsg,128)),{ret:value.ret,errcode:value.errcode});
  return value;
}
export async function createIlinkQr(fetcher?:typeof fetch){
  const response=await ilinkRequest(ILINK_ROOT,"/ilink/bot/get_bot_qrcode?bot_type=3",{payload:{local_token_list:[]},fetcher});
  const code=str(response.qrcode,512),link=str(response.qrcode_img_content,2048);
  if(!code||!link)throw new Error("invalid_ilink_qrcode");
  const url=new URL(link);
  if(url.protocol!=="https:"||url.username||url.password||url.port||
     !(url.hostname==="liteapp.weixin.qq.com"||url.hostname==="weixin.qq.com"))
    throw new Error("untrusted_ilink_qrcode_url");
  return {code,url:link};
}
export type QrState="wait"|"scaned"|"need_verifycode"|"verify_code_blocked"|"expired"|"confirmed"|"binded_redirect"|"scaned_but_redirect";
export async function pollIlinkQr(code:string,base=ILINK_ROOT,verifyCode?:string,fetcher?:typeof fetch){
  if(!code||code.length>512)throw new Error("invalid_qrcode");
  const path="/ilink/bot/get_qrcode_status?qrcode="+encodeURIComponent(code)+
    (verifyCode?"&verify_code="+encodeURIComponent(verifyCode):"");
  const result=await ilinkRequest(base,path,{method:"GET",timeoutMs:12000,fetcher});
  const status=str(result.status,40);
  if(!["wait","scaned","need_verifycode","verify_code_blocked","expired","confirmed","binded_redirect","scaned_but_redirect"].includes(status))
    throw new Error("unrecognized_ilink_qr_status");
  return {status:status as QrState,
    botToken:str(result.bot_token,8192),botId:str(result.ilink_bot_id,200),
    userId:str(result.ilink_user_id,200),base:result.baseurl?trustedIlinkBase(result.baseurl):trustedIlinkBase(base),
    redirectHost:typeof result.redirect_host==="string"?result.redirect_host:""};
}
export type IlinkAccount={botId:string;recipientId:string;token:string;base:string;contextToken?:string|null;cursor?:string|null};
export type IlinkInbound={id:string;seq:string|null;text:string;contextToken:string};
const reliableId=(value:unknown)=>typeof value==="string"&&value.length>0&&value.length<=200?value:
  typeof value==="number"&&Number.isSafeInteger(value)?String(value):"";
export function parseIlinkInbound(messages:unknown[],account:Pick<IlinkAccount,"botId"|"recipientId">):IlinkInbound[]{
  const parsed:IlinkInbound[]=[];
  for(const raw of messages){
    const msg=obj(raw);
    if(msg.from_user_id!==account.recipientId||msg.to_user_id!==account.botId||
      msg.message_type!==2||msg.message_state!==2)continue;
    const id=reliableId(msg.message_id);
    if(!id)continue;
    const items=Array.isArray(msg.item_list)?msg.item_list:[];
    if(items.length!==1)continue;
    const item=obj(items[0]);
    const rawText=obj(item.text_item).text;
    if(item.type===1&&(typeof rawText!=="string"||!rawText.length))continue;
    parsed.push({id,seq:reliableId(msg.seq)||null,text:item.type===1?(rawText as string).slice(0,4096):"",
      contextToken:str(msg.context_token,8192)});
  }
  return parsed;
}
export async function sendIlinkText(account:IlinkAccount,text:string,id:string,fetcher?:typeof fetch) {
  if(!text||text.length>1600||!account.token||!account.recipientId||!account.botId)throw new Error("invalid_ilink_send");
  const response=await ilinkRequest(account.base,"/ilink/bot/sendmessage",{
    token:account.token,fetcher,timeoutMs:15000,
    payload:{msg:{from_user_id:"",to_user_id:account.recipientId,client_id:id||randomUUID(),
      message_type:2,message_state:2,...(account.contextToken?{context_token:account.contextToken}:{}),
      item_list:[{type:1,text_item:{text}}]},base_info:baseInfo},
  });
  return {accepted:true,messageId:str(response.client_id,200)||id};
}
export async function pollIlinkInbox(account:IlinkAccount,fetcher?:typeof fetch){
  const response=await ilinkRequest(account.base,"/ilink/bot/getupdates",{
    token:account.token,fetcher,timeoutMs:39000,
    payload:{get_updates_buf:account.cursor??"",base_info:baseInfo},
  });
  const messages=Array.isArray(response.msgs)?response.msgs.map(obj):[];
  const inbound=parseIlinkInbound(messages,account);
  const latest=messages.filter(m=>m.from_user_id===account.recipientId&&m.to_user_id===account.botId)
    .map(m=>str(m.context_token,8192)).filter(Boolean).at(-1);
  return {cursor:str(response.get_updates_buf,16384)||account.cursor||"",contextToken:latest??null,
    hadInbound:messages.some(m=>m.from_user_id===account.recipientId&&m.to_user_id===account.botId),messages:inbound};
}
export function ilinkErrorKind(error:unknown):"needs_interaction"|"requires_rebind"|"rate_limited"|"unknown"{
  const x=error as {ret?:number;errcode?:number;message?:string};
  if(x.ret===-14||x.errcode===-14)return "requires_rebind";
  if(x.ret===-2 && /prepare failed|session not ready/i.test(x.message??""))return "needs_interaction";
  if(x.ret===-2)return "rate_limited";
  if(/session not ready|prepare failed/i.test(x.message??""))return "needs_interaction";
  return "unknown";
}
