// The server finishes a scan on its own. The page may be hidden while the phone confirms the QR,
// so the worker asks the channel about every scan that has not expired and writes the binding the
// same way the page does.
import { sql } from "@aihot/backend/db";
import { decryptSecret, ilinkConfigured, pollIlinkQr, trustedIlinkBase } from "./ilink.ts";
import { completeIlinkBinding } from "./binding.ts";

const PENDING_LIMIT=20;

type ScanRow={user_id:string;session_hash:string;qr_secret:string;api_url:string;status:string};

/** A scan nobody can finish any more: the page offers a new QR instead of waiting for a dead one. */
async function expireScan(userId:string){
  await sql`UPDATE member_ilink_logins SET status='expired',expires_at=now() WHERE user_id=${userId}`;
}

export async function confirmPendingIlinkBindings(){
  if(!ilinkConfigured())return {disabled:true};
  const scans=await sql<ScanRow[]>`SELECT user_id,session_hash,qr_secret,api_url,status FROM member_ilink_logins
    WHERE expires_at>now() ORDER BY expires_at LIMIT ${PENDING_LIMIT}`;
  let bound=0,expired=0,failed=0,waiting=0;
  for(const scan of scans){
    // The page polls the same scan; one lease keeps a single poll of the channel at a time.
    const [leased]=await sql`UPDATE member_ilink_logins SET last_polled_at=now() WHERE user_id=${scan.user_id}
      AND (last_polled_at IS NULL OR last_polled_at<now()-interval '2.5 seconds') RETURNING user_id`;
    if(!leased)continue;
    let result;
    try{result=await pollIlinkQr(decryptSecret(scan.qr_secret),scan.api_url);}
    catch{
      // The channel failed: keep the scan, mark it, and let the page offer a new QR.
      await sql`UPDATE member_ilink_logins SET status='error' WHERE user_id=${scan.user_id}`;
      failed++;
      continue;
    }
    if(result.status==="confirmed"){
      if(!result.botToken||!result.botId||!result.userId){await expireScan(scan.user_id);expired++;continue;}
      const outcome=await completeIlinkBinding(scan.user_id,scan.session_hash,{
        recipientId:result.userId,channelAccountId:result.botId,botToken:result.botToken,base:result.base});
      if(outcome==="bound"||outcome==="already_bound")bound++;
      else{await expireScan(scan.user_id);expired++;}
      continue;
    }
    if(result.status==="scaned_but_redirect"){
      try{
        const redirect=trustedIlinkBase("https://"+result.redirectHost);
        await sql`UPDATE member_ilink_logins SET api_url=${redirect},status='wait' WHERE user_id=${scan.user_id}`;
        waiting++;
      }catch{await expireScan(scan.user_id);expired++;}
      continue;
    }
    if(result.status==="expired"||result.status==="verify_code_blocked"||result.status==="binded_redirect"){
      await expireScan(scan.user_id);
      expired++;
      continue;
    }
    await sql`UPDATE member_ilink_logins SET status=${result.status} WHERE user_id=${scan.user_id}`;
    waiting++;
  }
  return {checked:scans.length,bound,expired,failed,waiting};
}
