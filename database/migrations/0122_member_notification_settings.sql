CREATE TABLE member_notification_settings (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  news_enabled boolean NOT NULL DEFAULT true,
  gp_enabled boolean NOT NULL DEFAULT true,
  paused_until timestamptz,
  binding_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
