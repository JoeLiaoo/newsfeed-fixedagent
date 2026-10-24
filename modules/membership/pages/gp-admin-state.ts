type PageState<T>={rows:T[];nextOffset:number|null;loading:boolean;error:string};

// Each queue owns a loader. Aborting saves work; the version guard also protects against
// responses whose fetch/json promise has already completed when the query changes.
export function createAdminPageLoader<T>(field:"gps"|"observations",failure:string,publish:(state:PageState<T>)=>void){
  let version=0;
  let controller:AbortController|undefined;
  function cancel(){version++;controller?.abort();}
  async function load(url:string){
    cancel();
    const current=version;
    const request=new AbortController();
    controller=request;
    publish({rows:[],nextOffset:null,loading:true,error:""});
    try{
      const response=await fetch(url,{signal:request.signal});
      if(!response.ok)throw new Error(failure);
      const page=await response.json() as Record<typeof field,T[]>&{pagination:{nextOffset:number|null}};
      if(current===version&&!request.signal.aborted)
        publish({rows:page[field],nextOffset:page.pagination.nextOffset,loading:false,error:""});
    }catch{
      if(current===version&&!request.signal.aborted)
        publish({rows:[],nextOffset:null,loading:false,error:failure});
    }
  }
  return {load,cancel};
}
