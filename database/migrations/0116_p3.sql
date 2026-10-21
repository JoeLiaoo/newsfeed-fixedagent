-- P3 separates observed changes from independently verified investment events.
CREATE TABLE member_gp_watchlist (
  id text PRIMARY KEY,
  canonical_name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  entity_id text,
  credit_code text,
  entity_role text NOT NULL DEFAULT 'manager' CHECK(entity_role IN ('manager','gp','fund')),
  status text NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','active','paused')),
  source_ref text NOT NULL,
  reviewed_by text REFERENCES member_users(id),
  reviewed_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status <> 'active' OR (entity_role = 'gp' AND entity_id IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE TABLE member_gp_snapshots (
  id text PRIMARY KEY,
  gp_id text NOT NULL REFERENCES member_gp_watchlist(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'xinhua',
  captured_at timestamptz NOT NULL DEFAULT now(),
  complete boolean NOT NULL,
  source_total integer,
  fetched_count integer NOT NULL,
  row_count integer NOT NULL,
  error_code text
);
CREATE INDEX member_gp_snapshots_gp_idx ON member_gp_snapshots(gp_id,captured_at DESC);
CREATE TABLE member_gp_investments (
  id text PRIMARY KEY,
  gp_id text NOT NULL REFERENCES member_gp_watchlist(id) ON DELETE CASCADE,
  investee_key text NOT NULL,
  investee_name text NOT NULL,
  investee_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  data_date text,
  provider_updated_at text,
  investment_date text,
  raw_evidence jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('baseline','observed','verified','retracted')),
  sector_tags text[] NOT NULL DEFAULT '{}',
  sector_reason text,
  classification_model text,
  classification_state text NOT NULL DEFAULT 'pending' CHECK(classification_state IN ('pending','suggested','reviewed','failed')),
  approved_event_date date,
  approved_source_url text,
  approved_by text REFERENCES member_users(id),
  approved_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(gp_id,investee_key)
);
CREATE INDEX member_gp_investments_status_idx ON member_gp_investments(status,first_seen_at);
CREATE TABLE member_gp_review_audit (
  id bigserial PRIMARY KEY,
  investment_id text NOT NULL REFERENCES member_gp_investments(id) ON DELETE CASCADE,
  actor_id text REFERENCES member_users(id),
  tags text[] NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE member_notification_settings (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  news_enabled boolean NOT NULL DEFAULT true,
  gp_enabled boolean NOT NULL DEFAULT true,
  paused_until timestamptz,
  binding_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE member_weixin_challenges (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_recipient text,
  claimed_channel text
);
CREATE TABLE member_weixin_bindings (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  recipient_id text NOT NULL,
  channel_account_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','requires_rebind')),
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_id,channel_account_id)
);
CREATE TABLE member_bridge_nonces (
  nonce_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
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
CREATE INDEX member_notification_outbox_due_idx ON member_notification_outbox(status,next_attempt_at);
