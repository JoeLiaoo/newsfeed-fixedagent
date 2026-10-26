type Investment={id:string;gp_name:string;investee_name:string;sector_tags:string[];event_date:string|null;status:"verified";source_url:string|null;source_placeholder:boolean};
type Page={investments:Investment[];pagination:{nextOffset:number|null};interest_tags?:string[]};
export type GpProjectsState={items:Investment[];interestTags:string[];nextOffset:number|null;loading:boolean;loadingMore:boolean;message:string;retry:{offset:number;append:boolean}};
export const initialGpProjectsState:GpProjectsState={items:[],interestTags:[],nextOffset:null,loading:true,loadingMore:false,message:"",retry:{offset:0,append:false}};

// Initial reads, append pages and retries share one cancellation/version scope.
export function createGpProjectsLoader(publish:(state:GpProjectsState)=>void,onUnauthorized:()=>void,group?:"citic-alliance"|"market-leaders"){
  let state=initialGpProjectsState,mode:boolean|undefined,version=0;
  let controller:AbortController|undefined;
  function cancel(){version++;controller?.abort();}
  async function load(matched:boolean,offset:number,append=false){
    cancel();
    const current=version,request=new AbortController();
    controller=request;
    const isCurrent=()=>version===current&&!request.signal.aborted;
    // Never append to a different view, even when a caller carries an old offset.
    if(mode!==matched){append=false;offset=0;}
    mode=matched;
    state=append?{...state,loadingMore:true,message:""}:{...initialGpProjectsState,loading:true};
    publish(state);
    try{
      const response=await fetch(`/api/v1/membership/gp-projects?limit=50&offset=${offset}${matched?"&matched=1":""}${group?`&group=${group}`:""}`,{signal:request.signal});
      if(!isCurrent())return;
      if(response.status===401){onUnauthorized();return;}
      if(!response.ok)throw new Error("request_failed");
      const page=await response.json() as Page;
      if(!isCurrent())return;
      state={items:append?[...state.items,...page.investments]:page.investments,
        interestTags:append?state.interestTags:page.interest_tags??[],nextOffset:page.pagination.nextOffset,
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
