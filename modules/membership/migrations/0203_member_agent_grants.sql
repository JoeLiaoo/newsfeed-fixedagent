-- Revoke with DELETE; a new INSERT gets a different immutable grant_id.
CREATE TABLE member_agent_grants (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  granted_at timestamptz NOT NULL DEFAULT now()
);
