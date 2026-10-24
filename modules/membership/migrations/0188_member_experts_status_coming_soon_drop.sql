-- The employee catalog now shows one planned expert entry marked `coming_soon` (开发中，敬请期待). Its
-- status needs a fourth value beside `available`, `blocked` (missing dependencies) and `hidden` (no
-- catalog entry). The old check is dropped here and replaced by the next two migrations, which add the
-- wider check and validate it.
ALTER TABLE member_experts DROP CONSTRAINT IF EXISTS member_experts_status_check;
