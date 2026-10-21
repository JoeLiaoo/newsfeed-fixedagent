CREATE TABLE member_notification_outbox (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('news','gp')),
  local_date date NOT NULL,
  binding_version integer NOT NULL,
  part_index integer NOT NULL,
  payload text NOT NULL,
  payload_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','unknown','cancelled','requires_rebind')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  channel_message_id text,
  error_code text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,kind,local_date,binding_version,part_index)
);
