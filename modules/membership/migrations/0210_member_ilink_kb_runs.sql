CREATE TABLE member_ilink_kb_runs (
  id text PRIMARY KEY,
  inbound_id text NOT NULL UNIQUE REFERENCES member_ilink_inbound_messages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  grant_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('knowledge.list_bases','knowledge.search','knowledge.answer')),
  base_id text,
  query text,
  status text NOT NULL CHECK(status IN ('pending','running','succeeded','failed','unknown','cancelled')),
  answer_id text REFERENCES member_wiki_answers(id),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
