import { after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql,closeDb } from "@aihot/backend/db";

after(async()=>closeDb());

test("P3 PostgreSQL migration creates durable identity, evidence and delivery ledgers",async()=>{
  const user=randomUUID(), other=randomUUID(), gp=randomUUID();
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${user},${"admin-"+user},'Admin','test-hash','active','admin'),
          (${other},${"user-"+other},'Member','test-hash','active','member')`;
  await sql`INSERT INTO member_gp_watchlist(id,canonical_name,entity_id,entity_role,status,source_ref,reviewed_by)
    VALUES(${gp},${"GP-"+gp},'official-id','gp','active','https://example.org/independent',${user})`;
  const s1=randomUUID(),s2=randomUUID(),inv=randomUUID();
  await sql`INSERT INTO member_gp_snapshots(id,gp_id,complete,fetched_count,row_count)
    VALUES(${s1},${gp},true,1,1)`;
  await sql`INSERT INTO member_gp_snapshot_evidence(snapshot_id,raw_rows,sha256)
    VALUES(${s1},${sql.json([{investee_name:"A",source:"original"}])},'original-hash')`;
  await sql`INSERT INTO member_gp_investments(id,gp_id,investee_key,investee_name,raw_evidence,status,source_snapshot_id)
    VALUES(${inv},${gp},'keyA','A',${sql.json({source:"original"})},'baseline',${s1})`;
  await sql`INSERT INTO member_gp_snapshots(id,gp_id,complete,fetched_count,row_count)
    VALUES(${s2},${gp},true,1,1)`;
  await sql`INSERT INTO member_gp_snapshot_evidence(snapshot_id,raw_rows,sha256)
    VALUES(${s2},${sql.json([{investee_name:"A",source:"updated"}])},'updated-hash')`;
  await sql`UPDATE member_gp_investments SET source_snapshot_id=${s2},raw_evidence=${sql.json({source:"updated"})} WHERE id=${inv}`;
  const [old]=await sql<{raw_rows:unknown;sha256:string}[]>`SELECT raw_rows,sha256 FROM member_gp_snapshot_evidence WHERE snapshot_id=${s1}`;
  assert.equal(old.sha256,"original-hash");
  assert.deepEqual(old.raw_rows,[{investee_name:"A",source:"original"}]);

  await sql`INSERT INTO member_gp_review_audit(investment_id,actor_id,tags,reason,before_state,after_state)
    VALUES(${inv},${user},ARRAY['基础模型']::text[],'test',
      ${sql.json({status:"observed"})},${sql.json({status:"verified"})})`;
  const [audit]=await sql<{before_state:{status:string};after_state:{status:string}}[]>`SELECT before_state,after_state FROM member_gp_review_audit WHERE investment_id=${inv}`;
  assert.equal(audit.before_state.status,"observed");
  assert.equal(audit.after_state.status,"verified");

  await sql`INSERT INTO member_notification_seen(user_id,kind,source_key) VALUES(${user},'gp',${"gp:"+inv})`;
  const duplicates=await sql`INSERT INTO member_notification_seen(user_id,kind,source_key)
    VALUES(${user},'gp',${"gp:"+inv}) ON CONFLICT DO NOTHING RETURNING source_key`;
  assert.equal(duplicates.length,0);
  const otherUser=await sql`INSERT INTO member_notification_seen(user_id,kind,source_key)
    VALUES(${other},'gp',${"gp:"+inv}) RETURNING source_key`;
  assert.equal(otherUser.length,1);

  const date="2026-10-22";
  await sql`INSERT INTO member_notification_outbox
    (id,user_id,kind,local_date,binding_version,part_index,payload,payload_sha256,window_end_at)
    VALUES(${randomUUID()},${user},'gp',${date}::date,1,0,'digest','hash',${new Date("2026-10-22T01:00:00Z")})`;
  const [cursor]=await sql<{last_at:Date}[]>`SELECT max(window_end_at) AS last_at
    FROM member_notification_outbox WHERE user_id=${user} AND kind='gp'`;
  assert.equal(cursor.last_at.toISOString(),"2026-10-22T01:00:00.000Z");
});
