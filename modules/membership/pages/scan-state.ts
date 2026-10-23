/** How often the page asks the server about a pending scan while it is on screen. */
export const VISIBLE_POLL_MS=3500;
/** A hidden page still polls, only less often: the phone confirms the scan, not the tab. */
export const HIDDEN_POLL_MS=15000;

/** Whether the next poll may run now. */
export function pollDue(lastPollAt:number,now:number,visible:boolean):boolean{
  if(visible)return true;
  return now-lastPollAt>=HIDDEN_POLL_MS;
}

/** The one line the page shows for a scan status. */
export function scanStatusText(status:string):string{
  if(status==="scaned")return "微信已扫码，请在手机上确认。";
  if(status==="need_verifycode")return "微信要求额外安全验证。";
  return "请用个人微信扫码，确认后网页自动完成绑定。";
}
