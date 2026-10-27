CREATE TABLE member_ilink_kb_conversations (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  binding_version integer NOT NULL,
  base_id text REFERENCES member_wiki_bases(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
