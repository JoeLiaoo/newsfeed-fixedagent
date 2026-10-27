/** Bounded, opt-in timing events. Never pass message content or channel identities here. */
export type LatencyStage="poll"|"route_claim"|"model"|"send";
export type LatencyRoute="inbox"|"reading"|"knowledge"|"expert"|"agent"|"unknown";
export type LatencyStatus="returned"|"claimed"|"processed"|"queued"|"accepted"|"failed"|"unknown"|"cancelled";
export function latencyEnabled(){return process.env.P3_ILINK_LATENCY_METRICS_ENABLED==="true";}
export function latencyEvent(input:{correlationId:string;stage:LatencyStage;route:LatencyRoute;status:LatencyStatus;
  durationMs:number;apiCalls?:number|null;totalTokens?:number|null}){
  if(!latencyEnabled())return;
  const event:{event:string;correlationId:string;stage:LatencyStage;route:LatencyRoute;status:LatencyStatus;
    durationMs:number;apiCalls?:number;totalTokens?:number}={
    event:"ilink_latency",correlationId:input.correlationId,stage:input.stage,route:input.route,
    status:input.status,durationMs:Math.max(0,Math.round(input.durationMs)),
  };
  if(Number.isFinite(input.apiCalls))event.apiCalls=input.apiCalls!;
  if(Number.isFinite(input.totalTokens))event.totalTokens=input.totalTokens!;
  console.info(JSON.stringify(event));
}
