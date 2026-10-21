import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { closeDb, sql } from "@aihot/backend/db";

const scrypt = promisify(scryptCallback);
const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
const realName = process.env.INITIAL_ADMIN_NAME?.trim();
const password = process.env.INITIAL_ADMIN_PASSWORD;
if (!username || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) || !realName || realName.length < 2 || realName.length > 80 || !password || password.length < 12) {
  throw new Error("Set INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_NAME, and INITIAL_ADMIN_PASSWORD (at least 12 characters) in the process environment.");
}
try {
  const [admins, users] = await Promise.all([
    sql<{ count: number }[]>`SELECT count(*)::int AS count FROM member_users WHERE role = 'admin'`,
    sql<{ id: string; real_name: string }[]>`SELECT id, real_name FROM member_users WHERE username = ${username}`,
  ]);
  if (admins[0]!.count > 0) throw new Error("An admin already exists; bootstrap is one-time only.");
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
  if (users[0]) {
    if (users[0].real_name !== realName) throw new Error("The existing account name does not match INITIAL_ADMIN_NAME.");
    await sql`UPDATE member_users SET role = 'admin', status = 'active', password_hash = ${`${salt}:${hash}`}, approved_at = now() WHERE id = ${users[0].id}`;
  } else {
    await sql`INSERT INTO member_users (id, username, real_name, password_hash, role, status, approved_at) VALUES (${randomBytes(16).toString("hex")}, ${username}, ${realName}, ${`${salt}:${hash}`}, 'admin', 'active', now())`;
  }
  process.stdout.write("Initial admin account is ready.\n");
} finally {
  await closeDb();
}
