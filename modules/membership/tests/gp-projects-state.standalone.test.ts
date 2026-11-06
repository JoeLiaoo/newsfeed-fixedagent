import assert from "node:assert/strict";
import { test } from "node:test";
import { createGpProjectsLoader,initialGpProjectsState } from "../pages/projects/invested-gp-state.ts";

function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function page(id:string,nextOffset:number|null=50){
  return {ok:true,status:200,json:async()=>({investments:[{id}],pagination:{nextOffset},filter_options:{mother_funds:[],subfunds:[],sectors:[],provinces:[]}})} as Response;
}

test("a newer load ignores an older append, whether that append fails or succeeds",async t=>{
  for(const failed of [false,true]){
    const pending:Array<ReturnType<typeof deferred<Response>>&{signal:AbortSignal;url:string}>=[];
    t.mock.method(globalThis,"fetch",(url:string,options:RequestInit)=>{
      const item={...deferred<Response>(),signal:options.signal!,url};pending.push(item);return item.promise;
    });
    let state=initialGpProjectsState;
    const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail("unexpected redirect"));
    const first=loader.load(0);pending[0]!.resolve(page("old-first",100));await first;
    const append=loader.load(100,true);
    loader.cancel();
    const latest=loader.load(0);
    assert.equal(pending[1]!.signal.aborted,true);
    pending[2]!.resolve(page("current-first"));await latest;
    const snapshot=state;
    if(failed)pending[1]!.reject(new Error("old failure"));else pending[1]!.resolve(page("unmatched",null));
    await append;
    assert.equal(state,snapshot);
    assert.deepEqual(state.items.map(x=>x.id),["current-first"]);
    assert.equal(state.nextOffset,50);assert.equal(state.message,"");
    assert.deepEqual(state.retry,{offset:0,append:false});
    assert.equal(pending.every(item=>!item.url.includes("matched=")),true);
    t.mock.restoreAll();
  }
});

test("current append failure retries its page, preserves earlier rows and appends once",async t=>{
  const pending:Array<ReturnType<typeof deferred<Response>>&{url:string}>=[];
  t.mock.method(globalThis,"fetch",(url:string)=>{const item={...deferred<Response>(),url};pending.push(item);return item.promise;});
  let state=initialGpProjectsState;
  const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail());
  const first=loader.load(0);pending[0]!.resolve(page("first"));await first;
  const bad=loader.load(50,true);pending[1]!.reject(new Error("offline"));await bad;
  assert.deepEqual(state.retry,{offset:50,append:true});
  assert.deepEqual(state.items.map(x=>x.id),["first"]);
  const retry=loader.load(state.retry.offset,state.retry.append);
  assert.match(pending[2]!.url,/offset=50$/);
  assert.equal(pending[2]!.url.includes("matched="),false);
  pending[2]!.resolve(page("second",null));await retry;
  assert.deepEqual(state.items.map(x=>x.id),["first","second"]);
  assert.equal(state.nextOffset,null);assert.equal(state.loadingMore,false);assert.equal(state.message,"");
});

test("switching requests cancels pending JSON and unmount cancels retry/redirect updates",async t=>{
  const pending:Array<ReturnType<typeof deferred<Response>>>=[];
  t.mock.method(globalThis,"fetch",()=>{const item=deferred<Response>();pending.push(item);return item.promise;});
  let state=initialGpProjectsState,redirects=0;
  const loader=createGpProjectsLoader(value=>{state=value;},()=>{redirects++;});
  const body=deferred<unknown>();
  const a=loader.load(0);pending[0]!.resolve({ok:true,status:200,json:()=>body.promise} as Response);
  await Promise.resolve();
  const b=loader.load(0),c=loader.load(0);
  pending[2]!.resolve(page("latest"));await c;
  pending[1]!.resolve(page("middle"));await b;
  body.resolve({investments:[{id:"first"}],pagination:{nextOffset:null}});await a;
  assert.deepEqual(state.items.map(x=>x.id),["latest"]);
  const retry=loader.load(50,true);loader.cancel();const snapshot=state;
  pending[3]!.resolve({status:401} as Response);await retry;
  assert.equal(state,snapshot);assert.equal(redirects,0);
});

test("citic-alliance loader keeps its category and never asks for the matched toggle",async t=>{
  const urls:string[]=[];
  let fail=false;
  t.mock.method(globalThis,"fetch",async(url:string)=>{urls.push(url);if(fail)throw new Error("offline");return page("approved",null);});
  let state=initialGpProjectsState;
  const loader=createGpProjectsLoader(value=>{state=value;},()=>assert.fail(),"citic-alliance");
  await loader.load(0);
  assert.deepEqual(state.items.map(item=>item.id),["approved"]);
  fail=true;
  await loader.load(50,true);
  assert.deepEqual(state.retry,{offset:50,append:true});
  assert.deepEqual(state.items.map(item=>item.id),["approved"]);
  fail=false;
  await loader.load(state.retry.offset,state.retry.append);
  assert.deepEqual(state.items.map(item=>item.id),["approved","approved"]);
  assert.deepEqual(urls,[
    "/api/v1/membership/gp-projects?limit=50&offset=0&group=citic-alliance",
    "/api/v1/membership/gp-projects?limit=50&offset=50&group=citic-alliance",
    "/api/v1/membership/gp-projects?limit=50&offset=50&group=citic-alliance",
  ]);
  assert.equal(urls.some(url=>url.includes("matched=")),false);
});

test("loader sends invested-gp filters and omits a blank subfund",async t=>{
  const urls:string[]=[];
  t.mock.method(globalThis,"fetch",async(url:string)=>{urls.push(url);return page("filtered",null);});
  const loader=createGpProjectsLoader(()=>{},()=>assert.fail());
  await loader.load(0,false,{motherFund:"母基金甲",subfund:"子基金乙",sector:"光伏",province:"江苏省"});
  const parsed=new URL(urls[0]!,"http://localhost");
  assert.equal(parsed.searchParams.get("motherFund"),"母基金甲");
  assert.equal(parsed.searchParams.get("subfund"),"子基金乙");
  assert.equal(parsed.searchParams.get("sector"),"光伏");
  assert.equal(parsed.searchParams.get("province"),"江苏省");
  assert.equal(parsed.searchParams.get("matched"),null);
  await loader.load(0,false,{motherFund:"中信金石",subfund:"",sector:"",province:""});
  const alliance=new URL(urls[1]!,"http://localhost");
  assert.equal(alliance.searchParams.get("motherFund"),"中信金石");
  assert.equal(alliance.searchParams.has("subfund"),false);
});
