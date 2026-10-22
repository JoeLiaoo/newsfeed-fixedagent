import {createHash} from "node:crypto";
import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import {createIlinkQr,decryptSecret,encryptSecret,ilinkConfigured,pollIlinkQr,trustedIlinkBase} from "./ilink.ts";
import { sql } from "@aihot/backend/db";
import type { MemberSession } from "../server.ts";

type Auth=(req:FastifyRequest)=>Promise<MemberSession|null>;
const body=(req:FastifyRequest)=>req.body && typeof req.body==="object" ? req.body as Record<string,unknown>:{};
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const sessionHash=(req:FastifyRequest)=>{
  const cookie=String(req.headers.cookie??"").split(";").map(s=>s.trim()).find(s=>s.startsWith("citic_member_session="));
  if(!cookie)return "";
  try{return sha(decodeURIComponent(cookie.slice("citic_member_session=".length)));}catch{return "";}
};
const originOk=(req:FastifyRequest)=>{if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}};

export function registerNotificationRoutes(app:FastifyInstance,auth:Auth) {
  async function member(req:FastifyRequest,reply:FastifyReply){
    reply.header("Cache-Control","private, no-store").header("Vary","Cookie");
    const user=await auth(req);
    if(!user){reply.code(401).send({error:"login_required"});return null;}
    if(req.method!=="GET"&&!originOk(req)){reply.code(403).send({error:"invalid_origin"});return null;}
    return user;
  }
  app.get("/api/v1/membership/notifications",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    await sql`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
    const [settings]=await sql`SELECT news_enabled,gp_enabled,paused_until,binding_version FROM member_notification_settings WHERE user_id=${user.id}`;
    const [binding]=await sql`SELECT status,RIGHT(recipient_id,4) AS recipient_suffix,bound_at FROM member_weixin_bindings WHERE user_id=${user.id}`;
    const history=await sql`SELECT kind,local_date::text AS date,status,part_index,attempts,error_code,accepted_at FROM member_notification_outbox WHERE user_id=${user.id} ORDER BY created_at DESC,part_index DESC LIMIT 60`;
    const [channel]=await sql`SELECT channel_state,last_inbound_at FROM member_ilink_accounts WHERE user_id=${user.id}`;
    const [scan]=await sql<{session_hash:string;qr_url:string;status:string;expires_at:Date}[]>`SELECT session_hash,qr_url,status,expires_at
      FROM member_ilink_logins WHERE user_id=${user.id} AND expires_at>now()`;
    return {settings,binding:binding??null,history,bindingAvailable:ilinkConfigured(),channel:channel??null,
      scan:scan?.session_hash===sessionHash(req)?{status:scan.status,qrUrl:scan.qr_url,expiresAt:scan.expires_at}:null};
  });
  app.put("/api/v1/membership/notifications",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    const input=body(req);
    if(typeof input.newsEnabled!=="boolean"||typeof input.gpEnabled!=="boolean"||typeof input.paused!=="boolean")
      return reply.code(400).send({error:"invalid_notification_settings"});
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      const [old]=await tx<{news_enabled:boolean;gp_enabled:boolean;paused_until:Date|null}[]>`SELECT news_enabled,gp_enabled,paused_until FROM member_notification_settings WHERE user_id=${user.id} FOR UPDATE`;
      const now=Date.now();
      const pauseChanged=(old.paused_until!==null&&old.paused_until.getTime()>now)!==(input.paused===true);
      const newsChanged=old.news_enabled!==input.newsEnabled;
      const gpChanged=old.gp_enabled!==input.gpEnabled;
      const changed=newsChanged||gpChanged||pauseChanged;
      if(!changed) return;
      await tx`UPDATE member_notification_settings SET news_enabled=${input.newsEnabled as boolean},gp_enabled=${input.gpEnabled as boolean},paused_until=${input.paused===true?new Date("2099-01-01T00:00:00Z"):null},
        news_since=CASE WHEN ${newsChanged||pauseChanged} THEN now() ELSE news_since END,
        gp_since=CASE WHEN ${gpChanged||pauseChanged} THEN now() ELSE gp_since END,
        news_version=news_version+${newsChanged||pauseChanged?1:0},gp_version=gp_version+${gpChanged||pauseChanged?1:0},updated_at=now() WHERE user_id=${user.id}`;
      const kinds=pauseChanged?["news","gp"]:[...(newsChanged?["news"]:[]),...(gpChanged?["gp"]:[])];
      const cancelled=await tx<{id:string}[]>`UPDATE member_notification_outbox SET status='cancelled',error_code='subscription_changed',lease_expires_at=NULL
        WHERE user_id=${user.id} AND kind=ANY(${tx.array(kinds)}::text[]) AND status IN('pending','failed','sending') RETURNING id`;
      if(cancelled.length) await tx`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${tx.array(cancelled.map(row=>row.id))}::text[])`;
    });
    return {ok:true};
  });
  // Every QR belongs to the *current session*, not just the site account.
  app.post("/api/v1/membership/weixin/start",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    if(!ilinkConfigured())return reply.code(503).send({error:"ilink_not_configured"});
    const hash=sessionHash(req);if(!hash)return reply.code(401).send({error:"login_required"});
    const [existing]=await sql`SELECT user_id FROM member_ilink_logins WHERE user_id=${user.id} AND expires_at>now()`;
    if(existing)return reply.code(429).send({error:"scan_in_progress"});
    let qr;
    try{qr=await createIlinkQr();}catch{return reply.code(503).send({error:"ilink_qr_unavailable"});}
    const created=await sql`INSERT INTO member_ilink_logins(user_id,session_hash,qr_secret,qr_url,status,api_url,expires_at)
      VALUES(${user.id},${hash},${encryptSecret(qr.code)},${qr.url},'wait',${trustedIlinkBase(undefined)},now()+interval '5 minutes')
      ON CONFLICT (user_id) DO UPDATE SET session_hash=EXCLUDED.session_hash,qr_secret=EXCLUDED.qr_secret,qr_url=EXCLUDED.qr_url,status='wait',
      api_url=EXCLUDED.api_url,expires_at=EXCLUDED.expires_at,last_polled_at=NULL
      WHERE member_ilink_logins.expires_at<=now() RETURNING user_id`;
    if(!created.length)return reply.code(429).send({error:"scan_in_progress"});
    return {status:"wait",qrUrl:qr.url,expiresInSeconds:300};
  });
  async function scanStatus(req:FastifyRequest,reply:FastifyReply,verification?:string) {
    const user=await member(req,reply);if(!user)return;
    if(!ilinkConfigured())return reply.code(503).send({error:"ilink_not_configured"});
    const hash=sessionHash(req);
    const [login]=await sql<{session_hash:string;qr_secret:string;qr_url:string;api_url:string;status:string;expires_at:Date;last_polled_at:Date|null}[]>`SELECT session_hash,qr_secret,qr_url,api_url,status,expires_at,last_polled_at
      FROM member_ilink_logins WHERE user_id=${user.id}`;
    if(!login)return {status:"idle"};
    if(login.session_hash!==hash||!hash)return reply.code(403).send({error:"scan_session_mismatch"});
    if(login.expires_at.getTime()<Date.now()) {
      await sql`DELETE FROM member_ilink_logins WHERE user_id=${user.id} AND session_hash=${hash}`;
      return {status:"expired"};
    }
    if(login.last_polled_at && Date.now()-login.last_polled_at.getTime()<2500)
      return {status:login.status,qrUrl:login.qr_url};
    const [leased]=await sql`UPDATE member_ilink_logins SET last_polled_at=now()
      WHERE user_id=${user.id} AND session_hash=${hash}
        AND (last_polled_at IS NULL OR last_polled_at<now()-interval '2.5 seconds')
      RETURNING user_id`;
    if(!leased)return {status:login.status,qrUrl:login.qr_url};
    let result;
    try{result=await pollIlinkQr(decryptSecret(login.qr_secret),login.api_url,verification);}
    catch{return {status:"wait",qrUrl:login.qr_url};}
    if(result.status==="scaned_but_redirect") {
      try{
        const redirect=trustedIlinkBase("https://"+result.redirectHost);
        await sql`UPDATE member_ilink_logins SET api_url=${redirect},status='wait' WHERE user_id=${user.id} AND session_hash=${hash}`;
      }catch{ return reply.code(502).send({error:"invalid_channel_redirect"}); }
      return {status:"wait",qrUrl:login.qr_url};
    }
    if(result.status==="confirmed") {
      if(!result.botToken||!result.botId||!result.userId)return reply.code(502).send({error:"incomplete_ilink_identity"});
      const outcome=await sql.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
        const [still]=await tx`SELECT user_id FROM member_sessions WHERE token_hash=${hash} AND user_id=${user.id} AND expires_at>now()`;
        const [active]=await tx`SELECT id FROM member_users WHERE id=${user.id} AND status='active'`;
        const [current]=await tx`SELECT session_hash,expires_at FROM member_ilink_logins WHERE user_id=${user.id} FOR UPDATE`;
        if(!still||!active||!current||current.session_hash!==hash||new Date(current.expires_at).getTime()<=Date.now())return "invalid_session";
        const [collision]=await tx`SELECT user_id FROM member_weixin_bindings WHERE
           (recipient_id=${result.userId} AND channel_account_id=${result.botId} OR channel_account_id=${result.botId})
           AND user_id<>${user.id}`;
        if(collision.length)return "identity_already_bound";
        await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
        await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${user.id}`;
        await tx`INSERT INTO member_ilink_accounts(user_id,recipient_id,channel_account_id,token_ciphertext,api_url,channel_state)
          VALUES(${user.id},${result.userId},${result.botId},${encryptSecret(result.botToken)},${result.base},'needs_interaction')
          ON CONFLICT(user_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,channel_account_id=EXCLUDED.channel_account_id,
          token_ciphertext=EXCLUDED.token_ciphertext,api_url=EXCLUDED.api_url,channel_state='needs_interaction',
          context_ciphertext=NULL,cursor_ciphertext=NULL,last_inbound_at=NULL,updated_at=now()`;
        await tx`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id)
          VALUES(${user.id},${result.userId},${result.botId})
          ON CONFLICT(user_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,channel_account_id=EXCLUDED.channel_account_id,status='active',bound_at=now()`;
        const cancelled=await tx<{id:string}[]>`UPDATE member_notification_outbox
          SET status='cancelled',error_code='binding_changed',lease_expires_at=NULL
          WHERE user_id=${user.id} AND status IN('pending','failed','sending') RETURNING id`;
        if(cancelled.length)await tx`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${tx.array(cancelled.map(x=>x.id))}::text[])`;
        await tx`DELETE FROM member_ilink_logins WHERE user_id=${user.id}`;
        return "ok";
      });
      return outcome==="ok"?{status:"bound"}:reply.code(409).send({error:outcome});
    }
    if(result.status==="expired"||result.status==="verify_code_blocked"||result.status==="binded_redirect"){
      await sql`DELETE FROM member_ilink_logins WHERE user_id=${user.id} AND session_hash=${hash}`;
      return {status:result.status};
    }
    await sql`UPDATE member_ilink_logins SET status=${result.status} WHERE user_id=${user.id} AND session_hash=${hash}`;
    return {status:result.status,qrUrl:login.qr_url};
  }
  app.get("/api/v1/membership/weixin/status",async(req,reply)=>scanStatus(req,reply));
  app.post("/api/v1/membership/weixin/verify",async(req,reply)=>{
    const code=body(req).verifyCode;
    if(typeof code!=="string"||!/^[0-9]{4,8}$/.test(code))return reply.code(400).send({error:"invalid_verification_code"});
    return scanStatus(req,reply,code);
  });
  // Old manual code endpoint must not be re-enabled by an older browser client.
  app.post("/api/v1/membership/weixin/confirm",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    return reply.code(410).send({error:"manual_confirmation_retired"});
  });
  app.post("/api/v1/membership/bridge/claim",async(_req,reply)=>
    reply.header("Cache-Control","no-store").code(410).send({error:"manual_bridge_retired"}));
  app.post("/api/v1/membership/weixin/unbind",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      await tx`DELETE FROM member_weixin_bindings WHERE user_id=${user.id}`;
      await tx`DELETE FROM member_ilink_accounts WHERE user_id=${user.id}`;
      await tx`DELETE FROM member_ilink_logins WHERE user_id=${user.id}`;
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${user.id}`;
      const cancelled=await tx<{id:string}[]>`UPDATE member_notification_outbox SET status='cancelled',error_code='unbound',lease_expires_at=NULL WHERE user_id=${user.id} AND status IN('pending','failed','sending') RETURNING id`;
      if(cancelled.length) await tx`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${tx.array(cancelled.map(row=>row.id))}::text[])`;
    });
    return {ok:true};
  });
}
