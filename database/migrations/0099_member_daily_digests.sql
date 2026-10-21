CREATE TABLE member_daily_digests (
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  preference_version integer NOT NULL,
  window_start timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  tags text[] NOT NULL,
  items jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date, preference_version),
  CHECK (cutoff_at > window_start)
);
