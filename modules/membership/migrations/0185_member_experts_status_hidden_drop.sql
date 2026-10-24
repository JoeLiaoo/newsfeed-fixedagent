-- The employee platform stops offering the one-layer expert as a catalog entry. Its status needs a
-- third value: `hidden` (no catalog entry, no new tasks) beside `available` and `blocked` (missing
-- dependencies, which would show the wrong badge). The old check is dropped here and replaced by the
-- next two migrations, which add the wider check and validate it.
ALTER TABLE member_experts DROP CONSTRAINT IF EXISTS member_experts_status_check;
