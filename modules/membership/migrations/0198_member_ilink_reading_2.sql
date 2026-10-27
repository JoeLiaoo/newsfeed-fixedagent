CREATE TABLE member_ilink_inbound_messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  bot_id text NOT NULL,
  upstream_id text NOT NULL,
  seq text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  UNIQUE(bot_id,upstream_id)
);
