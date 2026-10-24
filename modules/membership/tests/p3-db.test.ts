import { after,test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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


test("candidate reseeding updates only unreviewed candidates and preserves verified evidence", async () => {
  const seed = () => execFileSync(process.execPath, ["scripts/seed-gp-candidates.ts"], { env: process.env, stdio: "pipe" });
  seed();
  const initial = await sql`SELECT * FROM member_gp_watchlist WHERE id LIKE 'candidate-%' ORDER BY id`;
  assert.equal(initial.length, 9);
  assert.ok(initial.every(row => row.status === "candidate"));
  const reviewer = randomUUID();
  await sql`INSERT INTO member_users(id,username,real_name,password_hash,status,role)
    VALUES(${reviewer},${"seed-review-"+reviewer},'Test Admin','test-hash','active','admin')`;
  // Candidate 1 is still unreviewed; 2 is reviewed, 3 active, 4 paused, 5 has a snapshot.
  await sql`UPDATE member_gp_watchlist SET aliases=ARRAY['Manual alias'],source_ref='https://example.org/manual',entity_role='fund'
    WHERE id IN ('candidate-001','candidate-002','candidate-003','candidate-004','candidate-005')`;
  await sql`UPDATE member_gp_watchlist SET reviewed_by=${reviewer},reviewed_at=now() WHERE id='candidate-002'`;
  await sql`UPDATE member_gp_watchlist SET status='active',entity_role='gp',entity_id='confirmed',reviewed_by=${reviewer},reviewed_at=now() WHERE id='candidate-003'`;
  await sql`UPDATE member_gp_watchlist SET status='paused' WHERE id='candidate-004'`;
  await sql`INSERT INTO member_gp_snapshots(id,gp_id,complete,fetched_count,row_count) VALUES(${randomUUID()},'candidate-005',true,0,0)`;
  const before = await sql`SELECT * FROM member_gp_watchlist WHERE id IN ('candidate-002','candidate-003','candidate-004','candidate-005') ORDER BY id`;
  seed();
  const [updated] = await sql`SELECT * FROM member_gp_watchlist WHERE id='candidate-001'`;
  assert.deepEqual(updated.aliases, initial[0].aliases);
  assert.equal(updated.source_ref, initial[0].source_ref);
  assert.equal(updated.entity_role, initial[0].entity_role);
  assert.equal(updated.status, 'candidate');
  const after = await sql`SELECT * FROM member_gp_watchlist WHERE id IN ('candidate-002','candidate-003','candidate-004','candidate-005') ORDER BY id`;
  assert.deepEqual(after, before, 'Reviewed fields, reviewer and historical states must be preserved');
  const once = await sql`SELECT * FROM member_gp_watchlist WHERE id LIKE 'candidate-%' ORDER BY id`;
  seed();
  assert.deepEqual(await sql`SELECT * FROM member_gp_watchlist WHERE id LIKE 'candidate-%' ORDER BY id`, once);
});
