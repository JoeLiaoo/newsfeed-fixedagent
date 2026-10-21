CREATE TABLE member_gp_review_audit (
  id bigserial PRIMARY KEY,
  investment_id text NOT NULL REFERENCES member_gp_investments(id) ON DELETE CASCADE,
  actor_id text REFERENCES member_users(id),
  tags text[] NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
