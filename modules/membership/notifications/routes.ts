import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import { sql } from "@aihot/backend/db";
import type { MemberSession } from "../server.ts";

type Auth=(req:FastifyRequest)=>Promise<MemberSession|null>;
const body=(req:FastifyRequest)=>req.body && typeof req.body==="object" ? req.body as Record<string,unknown>:{};
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
    return {settings,binding:binding??null,history,bindingAvailable:false,bindingBlocker:"channel_scan_callback_unverified"};
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
  // The iLink login QR authenticates a bot account, not a member scan. Until an
  // independently verified channel supplies an authenticated scan event with
  // scene ID and stable recipient, never create or claim a member binding.
  // Retain explicit fail-closed legacy responses for previously deployed clients.
  for (const path of ["/api/v1/membership/weixin/start", "/api/v1/membership/weixin/confirm"]) {
    app.post(path,async(req,reply)=>{
      const user=await member(req,reply);if(!user)return;
      return reply.code(503).send({error:"channel_scan_callback_unverified"});
    });
  }
  app.post("/api/v1/membership/bridge/claim",async(_req,reply)=>{
    return reply.header("Cache-Control","no-store").code(503).send({error:"legacy_binding_disabled"});
  });
  app.post("/api/v1/membership/weixin/unbind",async(req,reply)=>{
    const user=await member(req,reply);if(!user)return;
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      await tx`DELETE FROM member_weixin_bindings WHERE user_id=${user.id}`;
      await tx`DELETE FROM member_weixin_challenges WHERE user_id=${user.id}`;
      await tx`INSERT INTO member_notification_settings(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE member_notification_settings SET binding_version=binding_version+1,updated_at=now() WHERE user_id=${user.id}`;
      const cancelled=await tx<{id:string}[]>`UPDATE member_notification_outbox SET status='cancelled',error_code='unbound',lease_expires_at=NULL WHERE user_id=${user.id} AND status IN('pending','failed','sending') RETURNING id`;
      if(cancelled.length) await tx`DELETE FROM member_notification_seen WHERE outbox_id=ANY(${tx.array(cancelled.map(row=>row.id))}::text[])`;
    });
    return {ok:true};
  });
}
