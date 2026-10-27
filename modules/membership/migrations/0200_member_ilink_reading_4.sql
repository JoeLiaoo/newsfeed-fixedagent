CREATE TABLE member_ilink_reply_outbox (
  id text PRIMARY KEY,
  inbound_id text NOT NULL UNIQUE REFERENCES member_ilink_inbound_messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
