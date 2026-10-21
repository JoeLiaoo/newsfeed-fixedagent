CREATE TABLE member_experts (
  slug text PRIMARY KEY,
  owner_id text REFERENCES member_users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL,
  version text NOT NULL,
  skill_md text NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'blocked')),
  missing_dependencies text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
