CREATE TABLE member_ilink_task_watches (
  task_id text PRIMARY KEY REFERENCES member_expert_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  grant_id uuid,
  alias text NOT NULL,
  sequence integer NOT NULL,
  created_inbound_id text REFERENCES member_ilink_inbound_messages(id) ON DELETE SET NULL,
  last_event_version timestamptz,
  long_notice_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,alias), UNIQUE(user_id,sequence)
);
