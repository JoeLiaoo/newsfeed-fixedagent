import { useCallback,useEffect,useState } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Badge } from "@aihot/web/components/member-ui/badge";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@aihot/web/components/member-ui/card";
import { Checkbox } from "@aihot/web/components/member-ui/checkbox";
import { copyText } from "@aihot/web/lib/clipboard";

type Settings={news_enabled:boolean;gp_enabled:boolean;paused_until:string|null;binding_version:number};
type Binding={status:string;recipient_suffix:string;bound_at:string};
type Challenge={expires_at:string;claimed:boolean};
type History={kind:"news"|"gp";date:string;status:string;part_index:number;attempts:number;error_code:string|null};
type Data={settings:Settings;binding:Binding|null;challenge:Challenge|null;history:History[];botContactQrUrl:string|null};
const endpoint="/api/v1/membership/";

export default function NotificationsPage(){
  const [data,setData]=useState<Data|null>(null),[message,setMessage]=useState(""),[code,setCode]=useState(""),[busy,setBusy]=useState(false);
  const [news,setNews]=useState(true),[gp,setGp]=useState(true),[paused,setPaused]=useState(false);
  const reload=useCallback(async(syncSettings=true)=>{
    const response=await fetch(endpoint+"notifications");
    if(!response.ok){setMessage("需要登录后查看通知设置。");return;}
    const result=await response.json() as Data;
    setData(result);
    if(syncSettings){setNews(result.settings.news_enabled);setGp(result.settings.gp_enabled);setPaused(!!result.settings.paused_until&&new Date(result.settings.paused_until)>new Date());}
    if(!result.challenge)setCode("");
  },[]);
  useEffect(()=>{void reload().catch(()=>setMessage("加载失败，请刷新。"));},[reload]);
  useEffect(()=>{
    const challenge=data?.challenge;
    if(!challenge)return;
    const refresh=()=>{if(document.visibilityState==="visible")void reload(false).catch(()=>setMessage("刷新绑定状态失败，请稍后重试。"));};
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    const interval=!challenge.claimed?window.setInterval(refresh,2000):undefined;
    const remaining=Date.parse(challenge.expires_at)-Date.now();
    const expiry=window.setTimeout(refresh,Math.max(0,remaining)+100);
    return()=>{
      window.removeEventListener("focus",refresh);
      document.removeEventListener("visibilitychange",refresh);
      if(interval!==undefined)window.clearInterval(interval);
      window.clearTimeout(expiry);
    };
  },[data?.challenge?.expires_at,data?.challenge?.claimed,reload]);
  async function copyCode(){
    try{await copyText(code);setMessage("绑定码已复制。");}
    catch{setMessage("复制失败，请长按绑定码并手动复制。");}
  }
  async function request(path:string,body?:Record<string,unknown>,method="POST"){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(endpoint+path,{method,headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
      const result=await response.json() as {error?:string;code?:string};
      if(!response.ok){setMessage(result.error==="binding_in_progress"?"绑定码仍有效，请完成或到期后重试。":result.error==="not_claimed"?"机器人尚未收到绑定码。":"请求失败："+(result.error??"未知错误"));return;}
      if(result.code){setCode(result.code);setMessage("绑定码已生成。");}else{setCode("");setMessage("已保存。");}
      await reload(true);
    }catch{setMessage("网络异常，请重试。");}finally{setBusy(false);}
  }
  return <main className="mx-auto w-full max-w-3xl px-5 py-8">
    <h1 className="mb-6 text-2xl font-semibold">微信通知</h1>
    {message&&<Alert role="status" className="mb-4">{message}</Alert>}
    <Card className="mb-5"><CardHeader><CardTitle>绑定个人微信</CardTitle></CardHeader><CardContent className="grid gap-3">
      <div className="flex items-center gap-2">
        <Badge variant={data?.binding?.status==="active"?"success":"secondary"}>{data?.binding?.status==="active"?"已绑定":data?.binding?.status==="requires_rebind"?"需要重新绑定":"未绑定"}</Badge>
        {data?.binding&&<span className="text-sm text-ink-3">收件人尾号 {data.binding.recipient_suffix}</span>}
      </div>
      {data?.binding?.status!=="active"&&<div className="flex flex-col gap-3 rounded-control border border-line-soft bg-bg-sunk p-4 sm:flex-row sm:items-center">
        {data?.botContactQrUrl?<img src={data.botContactQrUrl} alt="Hermes 微信机器人联系二维码" width={176} height={176} className="size-44 rounded-control border border-line-soft bg-white object-contain p-2" referrerPolicy="no-referrer"/>:<div className="grid size-44 place-items-center rounded-control border border-dashed border-line bg-white p-4 text-center text-sm text-ink-3">管理员尚未配置机器人联系二维码</div>}
        <div className="grid gap-2 text-sm">
          <p className="font-medium">扫码连接 Hermes 微信机器人</p>
          <p className="text-ink-3">管理员已批准的平台账号均可绑定微信。生成绑定码并在此机器人会话中发送，再回到此页确认；新闻和 GP 订阅默认开启，可在下方分别关闭。绑定和接收推送不代表已获准与机器人聊天，私聊权限须由管理员另行批准。</p>
          {!data?.botContactQrUrl&&<p className="text-ink-3">联系二维码由管理员配置；Hermes 网关登录二维码不能用于员工绑定。</p>}
        </div>
      </div>}
      {code&&<div className="rounded-control border border-line-soft bg-bg-sunk p-4">
        <p className="mb-1 text-sm text-ink-3">在上方 Hermes 机器人微信私聊中发送此码（10 分钟有效）</p>
        <div className="flex items-center gap-3"><code className="break-all font-mono text-lg font-semibold">{code}</code>
        <Button size="sm" variant="outline" onClick={()=>void copyCode()}>复制</Button></div>
      </div>}
      {data?.challenge?.claimed&&<p className="text-sm">机器人已收到绑定码，请确认。</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy||!!data?.challenge} variant="outline" onClick={()=>void request("weixin/start")}>生成绑定码</Button>
        <Button disabled={busy||!data?.challenge?.claimed} onClick={()=>void request("weixin/confirm")}>确认绑定</Button>
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
