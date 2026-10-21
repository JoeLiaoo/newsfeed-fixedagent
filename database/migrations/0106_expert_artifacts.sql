CREATE TABLE member_expert_artifacts (
  id bigserial PRIMARY KEY,
  task_id text NOT NULL REFERENCES member_expert_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  body bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
