CREATE TABLE member_weixin_bindings (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  recipient_id text NOT NULL,
  channel_account_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','requires_rebind')),
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_id,channel_account_id)
);
