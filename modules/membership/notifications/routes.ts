import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import type { MemberSession } from "../server.ts";

type Auth=(req:FastifyRequest)=>Promise<MemberSession|null>;
const body=(req:FastifyRequest)=>req.body && typeof req.body==="object" ? req.body as Record<string,unknown>:{};
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
const originOk=(req:FastifyRequest)=>{if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}};
const secret=()=>process.env.P3_BINDING_HMAC_SECRET??"";
const constantEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};

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
    const [challenge]=await sql`SELECT expires_at,claimed_recipient IS NOT NULL AS claimed FROM member_weixin_challenges WHERE user_id=${user.id} AND expires_at>now()`;
    const history=await sql`SELECT kind,local_date::text AS date,status,part_index,attempts,error_code,accepted_at FROM member_notification_outbox WHERE user_id=${user.id} ORDER BY created_at DESC,part_index DESC LIMIT 60`;
    return {settings,binding:binding??null,challenge:challenge??null,history};
  });
  app.put("/api/v1/membership/notifications",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    const input=body(req);
    if(typeof input.newsEnabled!=="boolean"||typeof input.gpEnabled!=="boolean"||typeof input.paused!=="boolean")
      return reply.code(400).send({error:"invalid_notification_settings"});
    await sql.begin(async tx=>{
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      const [old]=await tx<{news_enabled:boolean;gp_enabled:boolean}[]>`SELECT news_enabled,gp_enabled FROM member_notification_settings WHERE user_id=${user.id} FOR UPDATE`;
      const changed=old.news_enabled!==input.newsEnabled || old.gp_enabled!==input.gpEnabled;
      await tx`UPDATE member_notification_settings SET news_enabled=${input.newsEnabled as boolean},gp_enabled=${input.gpEnabled as boolean},paused_until=${input.paused===true?new Date("2099-01-01T00:00:00Z"):null},
        binding_version=binding_version+${changed?1:0},updated_at=now() WHERE user_id=${user.id}`;
      await tx`UPDATE member_notification_outbox SET status='cancelled',error_code='subscription_changed'
        WHERE user_id=${user.id} AND status IN('pending','failed')`;
    });
    return {ok:true};
  });
  app.post("/api/v1/membership/weixin/start",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    if(secret().length<32) return reply.code(503).send({error:"binding_bridge_not_configured"});
    const code=randomBytes(12).toString("hex").toUpperCase();
    const hash=sha(secret()+"\n"+code);
    const created=await sql`INSERT INTO member_weixin_challenges(user_id,code_hash,expires_at)
      VALUES(${user.id},${hash},now()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,
      attempts=0,claimed_recipient=NULL,claimed_channel=NULL
      WHERE member_weixin_challenges.expires_at<now() RETURNING user_id`;
    if(!created.length) return reply.code(429).send({error:"binding_in_progress"});
    return {code,expiresInSeconds:600,instruction:"向平台指定 Hermes 微信机器人私聊发送绑定码，然后回到网页确认。"};
  });
  // The bridge callback is anonymous at the generic API boundary but strictly authenticated with HMAC,
  // timestamp + single-use nonce and the exact recipient identity observed by the Hermes gateway.
  app.post("/api/v1/membership/bridge/claim",async(req,reply)=>{
    reply.header("Cache-Control","no-store");
    const input=body(req);
    const code=typeof input.code==="string"?input.code.trim().toUpperCase():"";
    const recipient=typeof input.recipientId==="string"?input.recipientId.trim():"";
    const channel=typeof input.channelAccountId==="string"?input.channelAccountId.trim():"";
    const stamp=String(req.headers["x-p3-timestamp"]??"");
    const nonce=String(req.headers["x-p3-nonce"]??"");
    const sig=String(req.headers["x-p3-signature"]??"");
    if(secret().length<32 || !/^[A-F0-9]{24}$/.test(code) || !recipient || recipient.length>200 ||
      !channel||channel.length>200||!/^\d{10,13}$/.test(stamp)||nonce.length<16||nonce.length>128||
      Math.abs(Date.now()-Number(stamp))>300000)
      return reply.code(403).send({error:"bridge_auth_failed"});
    const canonical=[stamp,nonce,code,recipient,channel].join("\n");
    const expected=createHmac("sha256",secret()).update(canonical).digest("hex");
    if(!/^[a-f0-9]{64}$/.test(sig)||!constantEqual(sig,expected)) return reply.code(403).send({error:"bridge_auth_failed"});
    const inserted=await sql`INSERT INTO member_bridge_nonces(nonce_hash) VALUES(${sha(nonce)}) ON CONFLICT DO NOTHING RETURNING nonce_hash`;
    if(!inserted.length) return reply.code(409).send({error:"bridge_replay"});
    const changed=await sql`UPDATE member_weixin_challenges SET attempts=attempts+1,claimed_recipient=${recipient},claimed_channel=${channel}
      WHERE code_hash=${sha(secret()+"\n"+code)} AND expires_at>now() AND attempts<5 AND claimed_recipient IS NULL RETURNING user_id`;
    return changed.length?{claimed:true}:reply.code(404).send({error:"invalid_or_expired_code"});
  });
  app.post("/api/v1/membership/weixin/confirm",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    const success=await sql.begin(async tx=>{
      const [pending]=await tx<{claimed_recipient:string|null;claimed_channel:string|null}[]>`SELECT claimed_recipient,claimed_channel FROM member_weixin_challenges
        WHERE user_id=${user.id} AND expires_at>now() FOR UPDATE`;
      if(!pending?.claimed_recipient||!pending.claimed_channel) return "not_claimed";
      const collision=await tx`SELECT user_id FROM member_weixin_bindings WHERE recipient_id=${pending.claimed_recipient} AND channel_account_id=${pending.claimed_channel} AND user_id<>${user.id}`;
      if(collision.length) return "recipient_already_bound";
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${user.id}`;
      await tx`INSERT INTO member_weixin_bindings(user_id,recipient_id,channel_account_id) VALUES(${user.id},${pending.claimed_recipient},${pending.claimed_channel})
        ON CONFLICT(user_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,channel_account_id=EXCLUDED.channel_account_id,status='active',bound_at=now()`;
      await tx`UPDATE member_notification_outbox SET status='cancelled',error_code='binding_changed' WHERE user_id=${user.id} AND status IN('pending','failed')`;
      await tx`DELETE FROM member_weixin_challenges WHERE user_id=${user.id}`;
      return "ok";
    });
    return success==="ok"?{ok:true}:reply.code(409).send({error:success});
  });
  app.post("/api/v1/membership/weixin/unbind",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    await sql.begin(async tx=>{
      await tx`DELETE FROM member_weixin_bindings WHERE user_id=${user.id}`;
      await tx`DELETE FROM member_weixin_challenges WHERE user_id=${user.id}`;
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${user.id}`;
      await tx`UPDATE member_notification_outbox SET status='cancelled',error_code='unbound' WHERE user_id=${user.id} AND status IN('pending','failed')`;
    });
    return {ok:true};
  });
}
