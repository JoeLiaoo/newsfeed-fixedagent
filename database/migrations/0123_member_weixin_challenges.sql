CREATE TABLE member_weixin_challenges (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_recipient text,
  claimed_channel text
);
