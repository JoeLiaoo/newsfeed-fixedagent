import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminPageLoader } from "../pages/gp-admin-state.ts";

function deferred<T>(){
  let resolve!:(value:T)=>void, reject!:(reason:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const response=(field:string,label:string,nextOffset:number|null=25)=>({ok:true,json:async()=>({[field]:[label],pagination:{nextOffset}})}) as Response;

for(const field of ["gps","observations"] as const){
  test(`${field}: old filter/page/retry responses cannot replace the latest page`,async t=>{
    const pending:Array<ReturnType<typeof deferred<Response>>&{signal:AbortSignal}>=[];
    t.mock.method(globalThis,"fetch",(_url:string,options:RequestInit)=>{
      const item={...deferred<Response>(),signal:options.signal!};pending.push(item);return item.promise;
    });
    let state={rows:[] as string[],nextOffset:null as number|null,loading:false,error:""};
    const loader=createAdminPageLoader<string>(field,"failed",value=>{state=value;});
    for(const [before,after] of [["candidate/0","active/0"],["active/0","active/25"],["active/25","active/25"]]){
      const start=pending.length;
      const old=loader.load(before),latest=loader.load(after);
      assert.equal(pending[start]!.signal.aborted,true);
      pending[start+1]!.resolve(response(field,"latest"));await latest;
      // Deliberately ignore AbortSignal in this mock: even a late body must be harmless.
      pending[start]!.resolve(response(field,"stale",null));await old;
      assert.deepEqual(state,{rows:["latest"],nextOffset:25,loading:false,error:""});
    }
  });

  test(`${field}: stale failures and cancelled JSON bodies do not change current loading/error`,async t=>{
    const pending:Array<ReturnType<typeof deferred<Response>>>=[];
    t.mock.method(globalThis,"fetch",()=>{const item=deferred<Response>();pending.push(item);return item.promise;});
    let state={rows:[] as string[],nextOffset:null as number|null,loading:false,error:""};
    const loader=createAdminPageLoader<string>(field,"failed",value=>{state=value;});
    const old=loader.load("old"),latest=loader.load("current");
    pending[0]!.reject(new Error("old failure"));await old;
    assert.deepEqual(state,{rows:[],nextOffset:null,loading:true,error:""});
    pending[1]!.resolve({ok:false} as Response);await latest;
    assert.equal(state.error,"failed");
    const body=deferred<unknown>();
    const slow=loader.load("slow-body");
    pending[2]!.resolve({ok:true,json:()=>body.promise} as Response);
    await Promise.resolve();
    loader.cancel();
    const snapshot=state;
    body.resolve({[field]:["stale"],pagination:{nextOffset:null}});await slow;
    assert.equal(state,snapshot);
  });
}

test("GP and observation queues retain independent errors and cancellation",async t=>{
  const pending:Array<ReturnType<typeof deferred<Response>>>=[];
  t.mock.method(globalThis,"fetch",()=>{const item=deferred<Response>();pending.push(item);return item.promise;});
  const states:string[]=[];
  const gps=createAdminPageLoader<string>("gps","GP failed",state=>{if(state.error)states.push(state.error);});
  const obs=createAdminPageLoader<string>("observations","obs failed",state=>{if(state.rows.length)states.push(state.rows[0]!);});
  const a=gps.load("gps"),b=obs.load("obs");
  pending[0]!.resolve({ok:false} as Response);await a;
  gps.cancel();pending[1]!.resolve(response("observations","observation"));await b;
  assert.deepEqual(states,["GP failed","observation"]);
});
