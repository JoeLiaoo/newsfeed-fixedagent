CREATE TABLE member_ilink_task_events (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES member_ilink_task_watches(task_id) ON DELETE CASCADE,
  state text NOT NULL,
  version timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,state,version)
);
