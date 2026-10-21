CREATE TABLE member_expert_tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  expert_slug text NOT NULL REFERENCES member_experts(slug),
  state text NOT NULL CHECK (state IN ('queued', 'waiting_input', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  selected_entity jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
