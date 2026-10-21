import { useEffect,useState,type FormEvent } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Label } from "@aihot/web/components/member-ui/label";
import { DIRECTIONS } from "../catalog.ts";
const GP_TAGS = DIRECTIONS.filter(d => d.name !== "战略配售").flatMap(d => [...d.tags]);

type GP={id:string;canonical_name:string;entity_id:string|null;credit_code:string|null;entity_role:string;status:string;source_ref:string;last_synced_at:string|null;last_error:string|null};
type Observation={id:string;gp_name:string;investee_name:string;status:string;sector_tags:string[];sector_reason:string|null;data_date:string|null;first_seen_at:string;approved_source_url:string|null;approved_event_date:string|null};
const prefix="/api/v1/membership/admin";

export default function GpAdminPage(){
  const [gps,setGps]=useState<GP[]>([]),[rows,setRows]=useState<Observation[]>([]);
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function load(){
    const [a,b]=await Promise.all([fetch(prefix+"/gps"),fetch(prefix+"/gp-observations")]);
    if(!a.ok||!b.ok){setMessage("需要管理员权限，或服务暂不可用。");return;}
    setGps((await a.json() as {gps:GP[]}).gps);
    setRows((await b.json() as {observations:Observation[]}).observations);
  }
  useEffect(()=>{void load().catch(()=>setMessage("加载失败。"));},[]);
  async function saveGp(id:string,input:Record<string,unknown>){
    setBusy(true);
    try{
      const response=await fetch(prefix+"/gps/"+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
      setMessage(response.ok?"已保存主体核查结果。":"保存失败，请检查主体身份、GP 角色和依据。");
      if(response.ok) await load();
    }catch{setMessage("网络异常。");}finally{setBusy(false);}
  }
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);
    const form=event.currentTarget,values=new FormData(form);
    try{
      const response=await fetch(prefix+"/gps",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:values.get("name"),sourceRef:values.get("sourceRef")})});
      setMessage(response.ok?"已添加待核候选。":"添加失败，请检查是否重复。");
      if(response.ok){form.reset();await load();}
    }catch{setMessage("网络异常。");}finally{setBusy(false);}
  }
  async function sync(id:string){
    setBusy(true);
    try{const response=await fetch(prefix+"/gps/"+encodeURIComponent(id)+"/sync",{method:"POST"});setMessage(response.ok?"已排队等待后台同步。":"同步未启用或主体尚未核准。");}
    catch{setMessage("网络异常。");}finally{setBusy(false);}
  }
  async function review(event:FormEvent<HTMLFormElement>,id:string){
    event.preventDefault();setBusy(true);const data=new FormData(event.currentTarget);
    try{
      const response=await fetch(prefix+"/gp-observations/"+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
        tags:data.getAll("tags"),status:data.get("status"),reason:data.get("reason"),eventDate:data.get("eventDate"),sourceUrl:data.get("sourceUrl"),
      })});
      setMessage(response.ok?"审核记录已保存。":"审核失败：确认新增投资必须有可核验的事件日期、HTTPS 证据和赛道。");
      if(response.ok) await load();
    }catch{setMessage("网络异常。");}finally{setBusy(false);}
  }
  return <main className="mx-auto w-full max-w-5xl px-5 py-8">
    <h1 className="mb-5 text-2xl font-semibold">GP 投资动向</h1>
    {message&&<Alert role="status" className="mb-4">{message}</Alert>}
    <Card className="mb-6"><CardHeader><CardTitle>新增监测候选</CardTitle></CardHeader><CardContent>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="gp-name">主体全称</Label><Input id="gp-name" name="name" required maxLength={180}/></div>
        <div><Label htmlFor="gp-source">身份依据</Label><Input id="gp-source" name="sourceRef" required maxLength={1000}/></div>
        <Button disabled={busy} type="submit">添加候选</Button>
      </form>
    </CardContent></Card>
    <Card className="mb-6"><CardHeader><CardTitle>主体身份核验</CardTitle></CardHeader><CardContent className="grid gap-4">
      {gps.map(gp=><GpRow key={gp.id} gp={gp} busy={busy} onSave={input=>saveGp(gp.id,input)} onSync={()=>sync(gp.id)}/>)}
      {!gps.length&&<p className="text-sm text-ink-3">暂无监测候选。</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>新增关系核验</CardTitle></CardHeader><CardContent className="grid gap-4">
      {rows.map(row=><form key={row.id} onSubmit={e=>void review(e,row.id)} className="grid gap-3 rounded-control border border-line-soft p-4">
        <div className="font-medium">{row.gp_name} → {row.investee_name}</div>
        <p className="text-sm text-ink-3">{row.status} · 首次发现 {new Date(row.first_seen_at).toLocaleDateString("zh-CN")} · 数据日期 {row.data_date||"未提供"}</p>
        <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-sm">细分赛道</legend>
          {GP_TAGS.map(tag=><label key={tag} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" name="tags" value={tag} defaultChecked={row.sector_tags.includes(tag)}/>{tag}</label>)}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">状态<select name="status" defaultValue={row.status} className="rounded-control border border-line bg-surface p-2"><option value="baseline">历史基线</option><option value="observed">新发现（待核）</option><option value="verified">证据核准，可推送</option><option value="retracted">撤回</option></select></label>
          <label className="grid gap-1 text-sm">事件日期<Input name="eventDate" type="date" defaultValue={row.approved_event_date?.slice(0,10)||""}/></label>
          <label className="grid gap-1 text-sm">证据链接<Input name="sourceUrl" type="url" defaultValue={row.approved_source_url||""}/></label>
        </div>
        <label className="grid gap-1 text-sm">核验备注<Input name="reason" defaultValue={row.sector_reason||""}/></label>
        <Button size="sm" type="submit" disabled={busy} className="justify-self-start">保存核验</Button>
      </form>)}
      {!rows.length&&<p className="text-sm text-ink-3">暂无快照记录。</p>}
    </CardContent></Card>
  </main>;
}

function GpRow({gp,busy,onSave,onSync}:{gp:GP;busy:boolean;onSave:(input:Record<string,unknown>)=>void;onSync:()=>void}){
  return <form onSubmit={event=>{
    event.preventDefault();
    const values=new FormData(event.currentTarget);
    onSave({role:values.get("role"),status:values.get("status"),entityId:values.get("entityId"),creditCode:values.get("creditCode"),sourceRef:values.get("sourceRef")});
  }} className="grid gap-2 rounded-control border border-line-soft p-4">
    <strong>{gp.canonical_name}</strong><p className="text-xs text-ink-3">上次同步：{gp.last_synced_at||"未同步"} · {gp.last_error||"无错误"}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">主体 ID<Input name="entityId" defaultValue={gp.entity_id||""}/></label>
      <label className="grid gap-1 text-sm">统一信用代码<Input name="creditCode" defaultValue={gp.credit_code||""}/></label>
      <label className="grid gap-1 text-sm">身份<select name="role" defaultValue={gp.entity_role} className="rounded-control border border-line bg-surface p-2"><option value="manager">管理人</option><option value="gp">直接投资 GP（已核实）</option><option value="fund">基金产品</option></select></label>
      <label className="grid gap-1 text-sm">监测状态<select name="status" defaultValue={gp.status} className="rounded-control border border-line bg-surface p-2"><option value="candidate">待核</option><option value="active">启用（仅核实 GP）</option><option value="paused">暂停</option></select></label>
    </div>
    <label className="grid gap-1 text-sm">依据<Input name="sourceRef" defaultValue={gp.source_ref} required/></label>
    <div className="flex gap-2"><Button size="sm" disabled={busy} type="submit">保存主体</Button><Button size="sm" variant="outline" disabled={busy||gp.status!=="active"} type="button" onClick={onSync}>请求同步</Button></div>
  </form>;
}
