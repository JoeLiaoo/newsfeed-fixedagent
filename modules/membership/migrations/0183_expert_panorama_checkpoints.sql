CREATE TABLE member_expert_panorama_checkpoints (
  task_id text NOT NULL REFERENCES member_expert_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  node_key text NOT NULL,
  depth integer NOT NULL DEFAULT 0,
  kind text NOT NULL,
  tool text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, node_key, kind)
);
