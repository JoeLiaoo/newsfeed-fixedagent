CREATE TABLE member_news_compact_editions (
  outbox_id text PRIMARY KEY REFERENCES member_notification_outbox(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  local_date date NOT NULL,
  preference_version integer NOT NULL,
  total_count integer NOT NULL,
  displayed_items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
