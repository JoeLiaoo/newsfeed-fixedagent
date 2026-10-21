CREATE TABLE member_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
