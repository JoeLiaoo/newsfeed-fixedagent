import {connect} from "node:net";
import {randomUUID} from "node:crypto";
import {parseUsage,type AgentUsage} from "./usage.ts";

export type HermesResult={answer:string;usage:AgentUsage};
export async function askHermes(prompt:string):Promise<HermesResult>{
  const socketPath=process.env.P3_HERMES_RUNNER_SOCKET??"/run/newsfeed-hermes/runner.sock";
  if(!socketPath.startsWith("/")||prompt.length>9000)throw new Error("runner_config");
  return new Promise((resolve,reject)=>{
    const socket=connect(socketPath);
    let settled=false,body="";
    const fail=(error:Error)=>{if(!settled){settled=true;socket.destroy();reject(error);}};
    const timeout=setTimeout(()=>fail(new Error("runner_timeout")),48_000);
    timeout.unref();
    socket.setEncoding("utf8");
    socket.on("connect",()=>socket.write(JSON.stringify({type:"chat",id:randomUUID(),prompt})+"\n"));
    socket.on("data",(chunk:string)=>{
      body+=chunk;
      if(body.length>40_000)return fail(new Error("runner_response_too_large"));
      const end=body.indexOf("\n");
      if(end<0)return;
      try{
        const value=JSON.parse(body.slice(0,end)) as Record<string,unknown>;
        if(value.ok!==true||typeof value.answer!=="string"||!value.answer.trim()||value.answer.length>6000)
          throw new Error("runner_failed");
        const usage=parseUsage(value.usage);
        if(!settled){settled=true;socket.end();resolve({answer:value.answer.trim(),usage});}
      }catch{fail(new Error("runner_invalid_result"));}
    });
    socket.on("error",()=>fail(new Error("runner_unavailable")));
    socket.on("close",()=>{clearTimeout(timeout);if(!settled)fail(new Error("runner_closed"));});
  });
}
