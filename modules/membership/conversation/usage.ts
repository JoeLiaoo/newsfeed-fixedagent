export type AgentUsage={apiCalls:number;totalTokens:number;model:string|null;provider:string|null;costStatus:string;estimatedCostUsd:number|null};
export function parseUsage(value:unknown):AgentUsage{
  if(!value||typeof value!=="object")throw new Error("invalid_usage");
  const data=value as Record<string,unknown>;
  const total=data.total_including_auxiliary as Record<string,unknown>|undefined;
  const calls=total?.api_calls;
  const tokens=total?.total_tokens;
  if(!Number.isSafeInteger(calls)||!Number.isSafeInteger(tokens)||Number(calls)<1||Number(tokens)<0)
    throw new Error("invalid_usage");
  const status=typeof data.cost_status==="string"?data.cost_status:"unknown";
  const price=status==="unknown"?null:typeof total?.estimated_cost_usd==="number"&&Number.isFinite(total.estimated_cost_usd)?total.estimated_cost_usd:null;
  return {apiCalls:Number(calls),totalTokens:Number(tokens),
    model:typeof data.model==="string"?data.model:null,provider:typeof data.provider==="string"?data.provider:null,
    costStatus:status,estimatedCostUsd:price};
}

export function withinBudget(hour:number,day:number,globalDay:number):boolean{
  // B0 title_generation is an auxiliary paid call. Reserve two calls before starting.
  return hour+2<=30&&day+2<=100&&globalDay+2<=2000;
}
