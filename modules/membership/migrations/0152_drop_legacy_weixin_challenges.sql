-- The manual-code challenge UX was retired by PR #15; it held only temporary pending auth data.
-- Rollout requires disabling the old binding endpoint before applying this migration.
DROP TABLE IF EXISTS member_weixin_challenges;
