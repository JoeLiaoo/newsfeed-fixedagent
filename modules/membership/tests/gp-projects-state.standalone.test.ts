import assert from "node:assert/strict";
import { test } from "node:test";
import { createGpProjectsLoader,initialGpProjectsState } from "../pages/projects/invested-gp-state.ts";

function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function page(id:string,nextOffset:number|null=50){
  return {ok:true,status:200,json:async()=>({investments:[{id}],interest_tags:["光伏"],pagination:{nextOffset}})} as Response;
}

for(const matched of [false,true])for(const failed of [false,true]){
  test(`switch ${matched?'matched to all':'all to matched'} ignores old append ${failed?'failure':'success'}`,async t=>{
    const pending:Array<ReturnType<typeof deferred<Response>>&{signal:AbortSignal;url:string}>=[];
    t.mock.method(globalThis,"fetch",(url:string,options:RequestInit)=>{
      const item={...deferred<Response>(),signal:options.signal!,url};pending.push(item);return item.promise;
    });
    let state=initialGpProjectsState;
    const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail("unexpected redirect"));
    const first=loader.load(matched,0);pending[0]!.resolve(page("old-first",100));await first;
    const append=loader.load(matched,100,true);
    loader.cancel(); // effect cleanup on query change
    const latest=loader.load(!matched,0);
    assert.equal(pending[1]!.signal.aborted,true);
    pending[2]!.resolve(page("current-first"));await latest;
    const snapshot=state;
    // Simulate a response/body arriving despite transport cancellation.
    if(failed)pending[1]!.reject(new Error("old failure"));else pending[1]!.resolve(page("unmatched",null));
    await append;
    assert.equal(state,snapshot);
    assert.deepEqual(state.items.map(x=>x.id),["current-first"]);
    assert.equal(state.nextOffset,50);assert.equal(state.message,"");
    assert.deepEqual(state.retry,{offset:0,append:false});
  });
}

test("current append failure retries its page, preserves earlier rows and appends once",async t=>{
  const pending:Array<ReturnType<typeof deferred<Response>>&{url:string}>=[];
  t.mock.method(globalThis,"fetch",(url:string)=>{const item={...deferred<Response>(),url};pending.push(item);return item.promise;});
  let state=initialGpProjectsState;
  const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail());
  const first=loader.load(true,0);pending[0]!.resolve(page("first"));await first;
  const bad=loader.load(true,50,true);pending[1]!.reject(new Error("offline"));await bad;
  assert.deepEqual(state.retry,{offset:50,append:true});
  assert.deepEqual(state.items.map(x=>x.id),["first"]);
  const retry=loader.load(true,state.retry.offset,state.retry.append);
  assert.match(pending[2]!.url,/offset=50&matched=1$/);
  pending[2]!.resolve(page("second",null));await retry;
  assert.deepEqual(state.items.map(x=>x.id),["first","second"]);
  assert.equal(state.nextOffset,null);assert.equal(state.loadingMore,false);assert.equal(state.message,"");
});

test("switching back cancels pending JSON and unmount cancels retry/redirect updates",async t=>{
  const pending:Array<ReturnType<typeof deferred<Response>>>=[];
  t.mock.method(globalThis,"fetch",()=>{const item=deferred<Response>();pending.push(item);return item.promise;});
  let state=initialGpProjectsState,redirects=0;
  const loader=createGpProjectsLoader(value=>{state=value;},()=>{redirects++;});
  const body=deferred<unknown>();
  const a=loader.load(false,0);pending[0]!.resolve({ok:true,status:200,json:()=>body.promise} as Response);
  await Promise.resolve();
  const b=loader.load(true,0),c=loader.load(false,0);
  pending[2]!.resolve(page("latest"));await c;
  pending[1]!.resolve(page("middle"));await b;
  body.resolve({investments:[{id:"first"}],pagination:{nextOffset:null}});await a;
  assert.deepEqual(state.items.map(x=>x.id),["latest"]);
  const retry=loader.load(false,50,true);loader.cancel();const snapshot=state;
  pending[3]!.resolve({status:401} as Response);await retry;
  assert.equal(state,snapshot);assert.equal(redirects,0);
});

for(const group of ["citic-alliance","market-leaders"] as const){
  test(`${group} loader keeps its category on first page, matched view and retry`,async t=>{
    const urls:string[]=[];
    let fail=false;
    t.mock.method(globalThis,"fetch",async(url:string)=>{urls.push(url);if(fail)throw new Error("offline");return page("approved",null);});
    let state=initialGpProjectsState;
    const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail(),group);
    await loader.load(false,0);
    assert.deepEqual(state.items.map(item=>item.id),["approved"]);
    await loader.load(true,0);
    fail=true;
    await loader.load(true,50,true);
    assert.deepEqual(state.retry,{offset:50,append:true});
    assert.deepEqual(state.items.map(item=>item.id),["approved"]);
    fail=false;
    await loader.load(true,state.retry.offset,state.retry.append);
    assert.deepEqual(state.items.map(item=>item.id),["approved","approved"]);
    assert.deepEqual(urls,[
      `/api/v1/membership/gp-projects?limit=50&offset=0&group=${group}`,
      `/api/v1/membership/gp-projects?limit=50&offset=0&matched=1&group=${group}`,
      `/api/v1/membership/gp-projects?limit=50&offset=50&matched=1&group=${group}`,
      `/api/v1/membership/gp-projects?limit=50&offset=50&matched=1&group=${group}`,
    ]);
  });
}
