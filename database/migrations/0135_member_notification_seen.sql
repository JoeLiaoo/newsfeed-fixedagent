CREATE TABLE member_notification_seen (
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('news','gp')),
  source_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,kind,source_key)
);
