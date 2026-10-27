CREATE TABLE member_ilink_conversations (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  outbox_id text REFERENCES member_notification_outbox(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
