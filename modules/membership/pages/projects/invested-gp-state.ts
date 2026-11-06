type Investment={id:string;gp_name:string;investee_name:string;sector_tags:string[];event_date:string|null;status:"verified";source_url:string|null;source_placeholder:boolean;mother_fund_name:string|null;subfund_name:string|null;project_province:string;province_verified:boolean};
type Filters={motherFund:string;subfund:string;sector:string;province:string};
type FilterOptions={mother_funds:string[];subfunds:string[];sectors:string[];provinces:string[]};
type Page={investments:Investment[];pagination:{nextOffset:number|null};filter_options?:FilterOptions};
export type GpProjectsState={items:Investment[];filterOptions:FilterOptions;nextOffset:number|null;loading:boolean;loadingMore:boolean;message:string;retry:{offset:number;append:boolean}};
const emptyFilters:FilterOptions={mother_funds:[],subfunds:[],sectors:[],provinces:[]};
export const initialGpProjectsState:GpProjectsState={items:[],filterOptions:emptyFilters,nextOffset:null,loading:true,loadingMore:false,message:"",retry:{offset:0,append:false}};

// 清单固定读取全部已核实项目，不再带 matched=1。
export function createGpProjectsLoader(publish:(state:GpProjectsState)=>void,onUnauthorized:()=>void,group?:"citic-alliance"){
  let state=initialGpProjectsState,version=0;
  let controller:AbortController|undefined;
  function cancel(){version++;controller?.abort();}
  async function load(offset:number,append=false,filters:Filters={motherFund:"",subfund:"",sector:"",province:""}){
    cancel();
    const current=version,request=new AbortController();
    controller=request;
    const isCurrent=()=>version===current&&!request.signal.aborted;
    state=append?{...state,loadingMore:true,message:""}:{...initialGpProjectsState,filterOptions:state.filterOptions,loading:true};
    publish(state);
    try{
      const params=new URLSearchParams({limit:"50",offset:String(offset)});
      if(group)params.set("group",group);
      if(filters.motherFund)params.set("motherFund",filters.motherFund);
      if(filters.subfund)params.set("subfund",filters.subfund);
      if(filters.sector)params.set("sector",filters.sector);
      if(filters.province)params.set("province",filters.province);
      const response=await fetch(`/api/v1/membership/gp-projects?${params}`,{signal:request.signal});
      if(!isCurrent())return;
      if(response.status===401){onUnauthorized();return;}
      if(!response.ok)throw new Error("request_failed");
      const page=await response.json() as Page;
      if(!isCurrent())return;
      state={items:append?[...state.items,...page.investments]:page.investments,
        filterOptions:append?state.filterOptions:page.filter_options??emptyFilters,nextOffset:page.pagination.nextOffset,
        loading:false,loadingMore:false,message:"",retry:{offset:0,append:false}};
      publish(state);
    }catch{
      if(!isCurrent())return;
      state={...state,loading:false,loadingMore:false,message:"项目列表暂时无法加载，请重试。",retry:{offset,append}};
      publish(state);
    }
  }
  return {load,cancel};
}
