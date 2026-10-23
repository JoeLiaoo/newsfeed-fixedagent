CREATE TABLE member_wiki_documents (
  id text PRIMARY KEY,
  uploader_id text NOT NULL REFERENCES member_users(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_by text REFERENCES member_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
