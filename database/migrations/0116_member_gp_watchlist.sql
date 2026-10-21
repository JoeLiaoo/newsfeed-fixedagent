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
