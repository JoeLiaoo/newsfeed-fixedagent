import { useCallback,useEffect,useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@aihot/web/components/member-ui/card";
import { Checkbox } from "@aihot/web/components/member-ui/checkbox";
import { pollDue,scanStatusText,VISIBLE_POLL_MS } from "./scan-state.ts";

type Settings={news_enabled:boolean;gp_enabled:boolean;paused_until:string|null;binding_version:number};
type Binding={status:string;recipient_suffix:string;bound_at:string};
type History={kind:"news"|"gp";date:string;status:string;part_index:number;attempts:number;error_code:string|null};
type Scan={status:string;qrUrl:string;expiresAt?:string};
type Channel={channel_state:string;last_inbound_at:string|null};
type Data={settings:Settings;binding:Binding|null;history:History[];bindingAvailable:boolean;channel:Channel|null;scan:Scan|null};
const endpoint="/api/v1/membership/";
const boundMessage="绑定成功，可以关闭微信二维码页面。请向机器人发送一条消息以启用推送。";
function scanFailureMessage(status:string){
  if(status==="verify_code_blocked")return "微信安全验证受阻，绑定失败。可以关闭二维码页面后重试。";
  if(status==="binded_redirect")return "微信提示该机器人已绑定，当前扫码未完成。可以关闭二维码页面后重试。";
  return "二维码已过期，绑定未完成。可以关闭二维码页面后重试。";
}

export default function NotificationsPage(){
  const [data,setData]=useState<Data|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [scan,setScan]=useState<Scan|null>(null),[verifyCode,setVerifyCode]=useState("");
  const [scanError,setScanError]=useState("");
  const [news,setNews]=useState(true),[gp,setGp]=useState(true),[paused,setPaused]=useState(false);
  const reload=useCallback(async(syncSettings=true)=>{
    const response=await fetch(endpoint+"notifications");
    if(!response.ok){setMessage("需要登录后查看通知设置。");return;}
    const result=await response.json() as Data;
    setData(result);
    setScan(previous=>result.binding?.status==="active"||result.scan?.status==="error"?null:result.scan??previous);
    if(result.binding?.status==="active")setScanError("");
    else if(result.scan?.status==="error")setScanError("微信二维码状态查询失败，绑定结果尚未确认。可以关闭二维码页面后重新生成。");
    if(syncSettings){setNews(result.settings.news_enabled);setGp(result.settings.gp_enabled);setPaused(!!result.settings.paused_until&&new Date(result.settings.paused_until)>new Date());}
  },[]);
  useEffect(()=>{void reload().catch(()=>setMessage("加载失败，请刷新。"));},[reload]);
  useEffect(()=>{
    if(data?.binding?.status!=="active")return;
    const refresh=()=>{if(document.visibilityState==="visible")void reload(false).catch(()=>{});};
    const interval=window.setInterval(refresh,10000);
    document.addEventListener("visibilitychange",refresh);
    return()=>{window.clearInterval(interval);document.removeEventListener("visibilitychange",refresh);};
  },[data?.binding?.status,reload]);
  useEffect(()=>{
    if(!scan || ["expired","bound","binded_redirect","verify_code_blocked"].includes(scan.status))return;
    let active=true;
    let lastPoll=0;
    const tick=async(force=false)=>{
      const visible=document.visibilityState!=="hidden";
      if(!force&&!pollDue(lastPoll,Date.now(),visible))return;
      lastPoll=Date.now();
      try{
        const response=await fetch(endpoint+"weixin/status",{cache:"no-store"});
        const result=await response.json() as Scan&{error?:string};
        if(!active)return;
        if(result.status==="error"){
          setScan(null);setMessage("");
          setScanError("微信二维码状态查询失败，绑定结果尚未确认。可以关闭二维码页面后重新生成。");
          return;
        }
        if(response.status===401){setMessage("需要登录后查看通知设置。");return;}
        if(!response.ok)return;
        setScanError("");
        if(result.status==="bound"){setScan(null);setMessage(boundMessage);await reload();}
        else if(["idle","expired","verify_code_blocked","binded_redirect"].includes(result.status)){
          setScan(null);
          setMessage(scanFailureMessage(result.status));
        }
        else setScan(old=>old?{...old,status:result.status}:old);
      }catch{ /* temporary channel error: next poll will retry */ }
    };
    void tick();
    const interval=window.setInterval(()=>void tick(),VISIBLE_POLL_MS);
    // The phone confirms the scan while the tab is hidden; ask again as soon as it is back.
    const onVisibility=()=>{if(document.visibilityState==="visible")void tick(true);};
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{active=false;window.clearInterval(interval);document.removeEventListener("visibilitychange",onVisibility);};
  },[scan?.qrUrl,scan?.status,reload]);
  async function startScan(){
    // Open synchronously from the click so browsers do not block the new tab after the request.
    const qrTab=window.open("about:blank","_blank");
    if(qrTab)qrTab.opener=null;
    setBusy(true);setMessage("");setScanError("");
    try{
      const response=await fetch(endpoint+"weixin/start",{method:"POST"});
      const result=await response.json() as Scan&{error?:string};
      if(response.ok&&result.qrUrl){
        setScan(result);setScanError("");
        if(qrTab){qrTab.location.replace(result.qrUrl);setMessage("已在新标签页打开微信官方二维码。扫码结果会显示在此页面。");}
        else setMessage("浏览器阻止了新标签页，请点击下方“打开微信官方二维码”。扫码结果会显示在此页面。");
      }else{qrTab?.close();setMessage(result.error==="scan_in_progress"?"二维码尚未过期，稍后可重试。":"暂时无法生成二维码，请稍后重试。");}
    }catch{qrTab?.close();setMessage("网络异常，二维码生成失败，请重试。");}finally{setBusy(false);}
  }
  async function submitVerification(){
    setBusy(true);
    try{
      const response=await fetch(endpoint+"weixin/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({verifyCode})});
      const result=await response.json() as Scan&{error?:string};
      if(result.error==="scan_replaced")return;
      if(!response.ok){setMessage("微信安全验证未通过。");return;}
      setVerifyCode("");
      if(result.status==="bound"){setScan(null);await reload();setMessage(boundMessage);}
      else if(["expired","verify_code_blocked","binded_redirect"].includes(result.status)){
        setScan(null);setMessage(scanFailureMessage(result.status));
      }else setScan(old=>old?{...old,status:result.status}:old);
    }catch{setMessage("网络异常，请重试。");}finally{setBusy(false);}
  }
  async function request(path:string,body?:Record<string,unknown>,method="POST"){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(endpoint+path,{method,...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
      const result=await response.json() as {error?:string};
      if(!response.ok){setMessage("请求失败："+(result.error??"未知错误"));return;}
      setMessage("已保存。");
      await reload(true);
    }catch{setMessage("网络异常，请重试。");}finally{setBusy(false);}
  }
  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <Button asChild variant="outline" className="mb-5"><Link to="/settings/profile"><ArrowLeft aria-hidden="true" />返回个人设置</Link></Button>
    <h1 className="mb-6 text-2xl font-semibold">绑定微信</h1>
    {message&&<Alert role="status" variant={message.startsWith("绑定成功")?"success":undefined} className="mb-4">{message}</Alert>}
    <Card className="mb-5"><CardHeader><CardTitle>绑定个人微信</CardTitle></CardHeader><CardContent className="grid gap-3">
      <div className="flex items-center gap-2">
        <Badge variant={data?.binding?.status==="active"?"success":"secondary"}>{data?.binding?.status==="active"?"已绑定":data?.binding?.status==="requires_rebind"?"需要重新绑定":"未绑定"}</Badge>
        {data?.binding&&<span className="text-sm text-ink-3">收件人尾号 {data.binding.recipient_suffix}</span>}
      </div>
      {data?.binding?.status!=="active"&&<div className="grid gap-3">
        {scan?.qrUrl?<div className="grid gap-2">
          <Button asChild className="justify-self-start"><a href={scan.qrUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />打开微信官方二维码</a></Button>
          <p className="text-sm text-ink-3">{scanStatusText(scan.status)}</p>
          {scan.status==="need_verifycode"&&<div className="flex gap-2">
            <input value={verifyCode} onChange={e=>setVerifyCode(e.target.value)} placeholder="微信要求的验证码" className="min-w-0 rounded-control border border-line px-3 py-2" inputMode="numeric" maxLength={8} />
            <Button disabled={busy||!/^[0-9]{4,8}$/.test(verifyCode)} onClick={()=>void submitVerification()}>验证</Button>
          </div>}
        </div>:<Button disabled={busy||!data?.bindingAvailable} onClick={()=>void startScan()} className="justify-self-start">扫码绑定微信</Button>}
        {scanError&&<div className="grid gap-2">
          <p className="text-sm text-hot">{scanError}</p>
          <Button disabled={busy||!data?.bindingAvailable} variant="outline" onClick={()=>void startScan()} className="justify-self-start">重新生成二维码</Button>
        </div>}
        {!data?.bindingAvailable&&<p className="text-sm text-ink-3">管理员尚未启用 iLink 扫码接入。</p>}
      </div>}
      <div className="grid gap-1">
        <label className="flex items-center gap-3"><Checkbox checked={data?.binding?.status==="active"&&data?.channel?.channel_state==="active"&&!!data.channel.last_inbound_at} disabled className="disabled:opacity-100" />已向机器人发送消息</label>
        <p className="pl-7 text-sm text-ink-3">由机器人收到消息后自动勾选；通道提示需重新互动时自动取消。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {data?.channel?.channel_state==="needs_interaction"&&<p className="text-sm text-ink-3">需要先在微信向机器人发一条消息，才能继续接收推送。</p>}
        {data?.binding&&<Button disabled={busy} variant="outline" onClick={()=>void request("weixin/unbind")}>解绑</Button>}
      </div>
    </CardContent></Card>
    <Card className="mb-5"><CardHeader><CardTitle>订阅设置</CardTitle></CardHeader><CardContent className="grid gap-4">
      <p className="text-sm text-ink-3">新账号默认开启资讯日报和 GP 投资动向推送；你可以分别取消订阅或暂停全部通知。</p>
      <label className="flex items-center gap-3"><Checkbox checked={news} onCheckedChange={value=>setNews(value===true)}/>个人资讯日报</label>
      <label className="flex items-center gap-3"><Checkbox checked={gp} onCheckedChange={value=>setGp(value===true)}/>GP 新增投资动向</label>
      <label className="flex items-center gap-3"><Checkbox checked={paused} onCheckedChange={value=>setPaused(value===true)}/>暂停全部通知</label>
      <Button disabled={busy||!data} onClick={()=>void request("notifications",{newsEnabled:news,gpEnabled:gp,paused},"PUT")} className="justify-self-start">保存通知设置</Button>
      <p className="text-xs text-ink-3">北京时间：工作日资讯 09:00、GP 10:00；休息日资讯 11:00、GP 12:00。节假日以运维配置为准。</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>最近投递记录</CardTitle></CardHeader><CardContent className="grid gap-2">
      {data?.history.map((item,index)=><div key={item.kind+item.date+item.part_index+index} className="flex justify-between gap-3 border-b border-line-soft py-2 text-sm">
        <span>{item.date} · {item.kind==="news"?"资讯":"GP 动向"} · 第 {item.part_index+1} 段</span>
        <span className="text-ink-3">{item.status==="accepted"?"渠道已受理":item.status==="unknown"?"送达结果未知":item.status==="requires_rebind"?"需要重新绑定":item.status}</span>
      </div>)}
      {!data?.history.length&&<p className="text-sm text-ink-3">暂无投递记录。</p>}
    </CardContent></Card>
  </main>;
}
