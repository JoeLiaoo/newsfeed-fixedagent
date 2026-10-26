import { useEffect,useState,type FormEvent } from "react";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@aihot/web/components/member-ui/card";
import { Input } from "@aihot/web/components/member-ui/input";
import { Checkbox } from "@aihot/web/components/member-ui/checkbox";
import { Label } from "@aihot/web/components/member-ui/label";
import { beijingStamp } from "@aihot/contracts/time";
import { DIRECTIONS } from "../catalog.ts";
import { createAdminPageLoader } from "./gp-admin-state.ts";
const GP_TAGS = DIRECTIONS.filter(d => d.name !== "战略配售").flatMap(d => [...d.tags]);
const PAGE_SIZE=25;
type GP={id:string;canonical_name:string;aliases:string[];entity_id:string|null;credit_code:string|null;entity_role:string;status:string;source_ref:string;project_groups:string[];project_group_basis:string|null;last_synced_at:string|null;last_error:string|null};
type Observation={id:string;gp_name:string;investee_name:string;investee_id:string|null;status:string;sector_tags:string[];sector_reason:string|null;data_date:string|null;provider_updated_at:string|null;investment_date:string|null;first_seen_at:string;snapshot_captured_at:string|null;approved_source_url:string|null;approved_event_date:string|null;mother_fund_name:string|null;subfund_name:string|null;fund_relation_basis:string|null;fund_relation_source_url:string|null;project_province:string|null;province_checked_at:string|null};
const prefix="/api/v1/membership/admin";
const GP_STATES=[{id:"candidate",label:"候选"},{id:"active",label:"启用"},{id:"paused",label:"暂停"}] as const;
const OBS_STATES=[{id:"observed",label:"待核"},{id:"verified",label:"已核实"},{id:"baseline",label:"历史基线"},{id:"retracted",label:"已撤回"}] as const;

export default function GpAdminPage(){
  const [gps,setGps]=useState<GP[]>([]),[gpsState,setGpsState]=useState("candidate"),[gpsOffset,setGpsOffset]=useState(0),[gpsNext,setGpsNext]=useState<number|null>(null);
  const [rows,setRows]=useState<Observation[]>([]),[obsState,setObsState]=useState("observed"),[obsOffset,setObsOffset]=useState(0),[obsNext,setObsNext]=useState<number|null>(null);
  const [gpsError,setGpsError]=useState(""),[obsError,setObsError]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loadingGps,setLoadingGps]=useState(false),[loadingObs,setLoadingObs]=useState(false);
  const [gpsRefresh,setGpsRefresh]=useState(0),[obsRefresh,setObsRefresh]=useState(0);
  const [syncState,setSyncState]=useState<Record<string,string>>({});
  const [gpsLoader]=useState(()=>createAdminPageLoader<GP>("gps","读取候选名单失败。",state=>{
    setGps(state.rows);setGpsNext(state.nextOffset);setLoadingGps(state.loading);setGpsError(state.error);
  }));
  const [obsLoader]=useState(()=>createAdminPageLoader<Observation>("observations","读取观察队列失败。",state=>{
    setRows(state.rows);setObsNext(state.nextOffset);setLoadingObs(state.loading);setObsError(state.error);
  }));
  useEffect(()=>{
    void gpsLoader.load(`${prefix}/gps?status=${gpsState}&limit=${PAGE_SIZE}&offset=${gpsOffset}`);
    return ()=>gpsLoader.cancel();
  },[gpsState,gpsOffset,gpsRefresh,gpsLoader]);
  useEffect(()=>{
    void obsLoader.load(`${prefix}/gp-observations?status=${obsState}&limit=${PAGE_SIZE}&offset=${obsOffset}`);
    return ()=>obsLoader.cancel();
  },[obsState,obsOffset,obsRefresh,obsLoader]);
  async function saveGp(id:string,input:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{const response=await fetch(prefix+"/gps/"+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
      setMessage(response.ok?"已保存主体核查结果。":response.status===409?"主体身份不可修改，或项目分类缺少依据。":"保存失败，请检查主体身份、GP 角色和依据。");
      if(response.ok)setGpsRefresh(value=>value+1);
    }catch{setMessage("网络异常，保存未完成。");}finally{setBusy(false);}
  }
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);const form=event.currentTarget,values=new FormData(form);
    try{const response=await fetch(prefix+"/gps",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:values.get("name"),sourceRef:values.get("sourceRef")})});
      setMessage(response.ok?"已添加待核候选。":response.status===409?"该主体已在名单中。":"添加失败，请检查名称和依据。");
      if(response.ok){form.reset();setGpsState("candidate");setGpsOffset(0);setGpsRefresh(value=>value+1);}
    }catch{setMessage("网络异常，添加未完成。");}finally{setBusy(false);}
  }
  async function sync(id:string){
    setSyncState(old=>({...old,[id]:"正在请求同步…"}));
    try{const response=await fetch(prefix+"/gps/"+encodeURIComponent(id)+"/sync",{method:"POST"});
      if(response.ok){setSyncState(old=>({...old,[id]:"同步已排队。"}));return;}
      const payload=await response.json().catch(()=>({})) as {error?:string};
      setSyncState(old=>({...old,[id]:payload.error==="provider_sync_disabled"?"当前未启用同步。":payload.error==="gp_not_active"?"主体未处于启用状态。":"同步请求失败，请稍后重试。"}));
    }catch{setSyncState(old=>({...old,[id]:"网络异常，同步请求未完成。"}));}
  }
  async function review(event:FormEvent<HTMLFormElement>,id:string){
    event.preventDefault();setBusy(true);setMessage("");const data=new FormData(event.currentTarget);
    try{const response=await fetch(prefix+"/gp-observations/"+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({tags:data.getAll("tags"),status:data.get("status"),reason:data.get("reason"),eventDate:data.get("eventDate"),sourceUrl:data.get("sourceUrl"),motherFund:data.get("motherFund"),subfund:data.get("subfund"),fundRelationBasis:data.get("fundRelationBasis"),fundRelationSourceUrl:data.get("fundRelationSourceUrl")})});
      setMessage(response.ok?"审核记录已保存。":response.status===400?"审核失败：核准投资须有日期、HTTPS 证据和赛道；基金归属须有依据和 HTTPS 来源。":"审核未保存，请重试。");
      if(response.ok)setObsRefresh(value=>value+1);
    }catch{setMessage("网络异常，审核未完成。");}finally{setBusy(false);}
  }
  async function verifyProvince(id:string){
    setBusy(true);setMessage("");
    try{const response=await fetch(prefix+"/gp-observations/"+encodeURIComponent(id)+"/province",{method:"POST"});
      const body=await response.json().catch(()=>({})) as {project_province?:string;error?:string};
      setMessage(response.ok?`新华财经工商画像已核验，项目省份：${body.project_province}。`:body.error==="xinhua_identity_unavailable"?"缺少新华财经主体 ID，无法核验省份；员工端将显示“未知”。": "新华财经暂时无法核验省份；员工端将显示“未知”。");
      if(response.ok)setObsRefresh(value=>value+1);
    }catch{setMessage("网络异常，省份未核验。");}finally{setBusy(false);}
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
    <Card className="mb-6"><CardHeader><CardTitle>监测名单</CardTitle><div className="flex flex-wrap gap-2" aria-label="监测名单状态">
      {GP_STATES.map(tab=><Button key={tab.id} type="button" size="sm" variant={gpsState===tab.id?"default":"outline"} aria-pressed={gpsState===tab.id} onClick={()=>{setGpsState(tab.id);setGpsOffset(0);}}>{tab.label}</Button>)}
    </div></CardHeader><CardContent className="grid gap-4">
      {gpsError&&<Alert role="alert">{gpsError} <Button size="sm" variant="outline" onClick={()=>setGpsRefresh(value=>value+1)}>重试</Button></Alert>}
      {loadingGps&&<p role="status" className="text-sm text-ink-3">正在加载监测名单…</p>}
      {!loadingGps&&!gps.length&&!gpsError&&<p className="text-sm text-ink-3">此状态下暂无主体。</p>}
      {gps.map(gp=><GpRow key={gp.id} gp={gp} busy={busy} syncMessage={syncState[gp.id]} onSave={input=>saveGp(gp.id,input)} onSync={()=>void sync(gp.id)}/>)}
      <Pager offset={gpsOffset} next={gpsNext} loading={loadingGps} onChange={setGpsOffset}/>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>新增关系核验</CardTitle><div className="flex flex-wrap gap-2" aria-label="观察记录状态">
      {OBS_STATES.map(tab=><Button key={tab.id} type="button" size="sm" variant={obsState===tab.id?"default":"outline"} aria-pressed={obsState===tab.id} onClick={()=>{setObsState(tab.id);setObsOffset(0);}}>{tab.label}</Button>)}
    </div></CardHeader><CardContent className="grid gap-4">
      {obsError&&<Alert role="alert">{obsError} <Button size="sm" variant="outline" onClick={()=>setObsRefresh(value=>value+1)}>重试</Button></Alert>}
      {loadingObs&&<p role="status" className="text-sm text-ink-3">正在加载观察队列…</p>}
      {!loadingObs&&!rows.length&&!obsError&&<p className="text-sm text-ink-3">此状态下暂无观察记录。</p>}
      {rows.map(row=><form key={row.id} onSubmit={e=>void review(e,row.id)} className="grid gap-3 rounded-control border border-line-soft p-4">
        <div className="font-medium">{row.gp_name} → {row.investee_name}</div>
        <p className="text-sm text-ink-3">{row.status} · 首次发现 {beijingStamp(row.first_seen_at)} · 入库快照 {row.snapshot_captured_at?beijingStamp(row.snapshot_captured_at):"未关联"}</p>
        <p className="text-sm text-ink-3">接口数据日期 {row.data_date||"未提供"} · 接口更新时间 {row.provider_updated_at||"未提供"} · 投资日期 {row.investment_date||"来源未提供"}</p>
        <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-sm">细分赛道</legend>
          {GP_TAGS.map(tag=><label key={tag} className="inline-flex items-center gap-1 text-xs"><Checkbox name="tags" value={tag} defaultChecked={row.sector_tags.includes(tag)}/>{tag}</label>)}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">状态<select name="status" defaultValue={row.status} className="rounded-control border border-line bg-surface p-2"><option value="baseline">历史基线</option><option value="observed">新发现（待核）</option><option value="verified">证据核准，可推送</option><option value="retracted">撤回</option></select></label>
          <label className="grid gap-1 text-sm">事件日期<Input name="eventDate" type="date" defaultValue={row.approved_event_date?.slice(0,10)||""}/></label>
          <label className="grid gap-1 text-sm">证据链接<Input name="sourceUrl" type="url" defaultValue={row.approved_source_url||""}/></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">母基金<Input name="motherFund" defaultValue={row.mother_fund_name||""} maxLength={120} placeholder="依据核验后填写…"/></label>
          <label className="grid gap-1 text-sm">子基金<Input name="subfund" defaultValue={row.subfund_name||""} maxLength={120} placeholder="依据核验后填写…"/></label>
        </div>
        <label className="grid gap-1 text-sm">母／子基金关系依据（填写至少 8 字）<Input name="fundRelationBasis" defaultValue={row.fund_relation_basis||""} maxLength={1000} placeholder="说明证据如何确认该归属…"/></label>
        <label className="grid gap-1 text-sm">母／子基金关系来源<Input name="fundRelationSourceUrl" type="url" defaultValue={row.fund_relation_source_url||""} placeholder="https://…"/></label>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <span>项目区域（省）：{row.project_province||"未知"}{row.province_checked_at?" · 已通过新华财经核验":" · 未核验"}</span>
          <Button type="button" size="sm" variant="outline" disabled={busy||!row.investee_id} onClick={()=>void verifyProvince(row.id)}>用新华财经核验省份</Button>
        </div>
        <label className="grid gap-1 text-sm">核验备注<Input name="reason" defaultValue={row.sector_reason||""}/></label>
        <Button size="sm" type="submit" disabled={busy} className="justify-self-start">保存核验</Button>
      </form>)}
      <Pager offset={obsOffset} next={obsNext} loading={loadingObs} onChange={setObsOffset}/>
    </CardContent></Card>
  </main>;
}

function Pager({offset,next,loading,onChange}:{offset:number;next:number|null;loading:boolean;onChange:(offset:number)=>void}){
  return <div className="flex items-center justify-between border-t border-line-soft pt-3 text-sm text-ink-3"><span>第 {Math.floor(offset/PAGE_SIZE)+1} 页</span><div className="flex gap-2">
    <Button type="button" size="sm" variant="outline" disabled={loading||offset===0} onClick={()=>onChange(Math.max(0,offset-PAGE_SIZE))}>上一页</Button>
    <Button type="button" size="sm" variant="outline" disabled={loading||next===null} onClick={()=>onChange(next??offset)}>下一页</Button>
  </div></div>;
}

function GpRow({gp,busy,syncMessage,onSave,onSync}:{gp:GP;busy:boolean;syncMessage?:string;onSave:(input:Record<string,unknown>)=>void;onSync:()=>void}){
  return <form onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);onSave({role:values.get("role"),status:values.get("status"),entityId:values.get("entityId"),creditCode:values.get("creditCode"),sourceRef:values.get("sourceRef"),projectGroups:values.getAll("projectGroups"),projectGroupBasis:values.get("projectGroupBasis"),aliases:String(values.get("aliases")??"").split(/[,，、]/).map(v=>v.trim()).filter(Boolean)});}} className="grid gap-2 rounded-control border border-line-soft p-4">
    <strong>{gp.canonical_name}</strong><p className="text-xs text-ink-3">别名：{gp.aliases.length?gp.aliases.join("、"):"无"} · 当前身份：{gp.entity_role} · 上次同步：{gp.last_synced_at?beijingStamp(gp.last_synced_at):"未同步"}</p>
    <p className="text-xs text-ink-3">最近错误：{gp.last_error||"无"}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">主体 ID<Input name="entityId" defaultValue={gp.entity_id||""}/></label>
      <label className="grid gap-1 text-sm">统一信用代码<Input name="creditCode" defaultValue={gp.credit_code||""}/></label>
      <label className="grid gap-1 text-sm">身份<select name="role" defaultValue={gp.entity_role} className="rounded-control border border-line bg-surface p-2"><option value="manager">管理人</option><option value="gp">直接投资 GP（已核实）</option><option value="fund">基金产品</option></select></label>
      <label className="grid gap-1 text-sm">监测状态<select name="status" defaultValue={gp.status} className="rounded-control border border-line bg-surface p-2"><option value="candidate">待核</option><option value="active">启用（仅核实 GP）</option><option value="paused">暂停</option></select></label>
    </div>
    <label className="grid gap-1 text-sm">别名（逗号分隔）<Input name="aliases" defaultValue={gp.aliases.join("、")}/></label>
    <label className="grid gap-1 text-sm">依据<Input name="sourceRef" defaultValue={gp.source_ref} required/></label>
    <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-sm">员工项目分类（核实后才展示）</legend>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm"><Checkbox name="projectGroups" value="citic-alliance" defaultChecked={gp.project_groups.includes("citic-alliance")}/>中信股权联盟</label>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm"><Checkbox name="projectGroups" value="market-leaders" defaultChecked={gp.project_groups.includes("market-leaders")}/>市场头部机构</label>
    </fieldset>
    <label className="grid gap-1 text-sm">分类依据（分类时必填，至少 8 字）<Input name="projectGroupBasis" defaultValue={gp.project_group_basis||""} maxLength={1000}/></label>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={busy} type="submit">保存主体</Button><Button size="sm" variant="outline" disabled={busy||gp.status!=="active"} type="button" onClick={onSync}>请求同步</Button>{syncMessage&&<span role="status" className="text-xs text-ink-3">{syncMessage}</span>}</div>
  </form>;
}
