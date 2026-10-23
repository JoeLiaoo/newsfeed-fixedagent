CREATE TABLE member_wiki_contributions (
  id text PRIMARY KEY,
  target_key text NOT NULL,
  slug text NOT NULL,
  page_type text NOT NULL,
  target_type text,
  target_name text,
  track text,
  document_id text NOT NULL REFERENCES member_wiki_documents(id),
  version_id text NOT NULL REFERENCES member_wiki_document_versions(id),
  version_no int NOT NULL,
  task_id text REFERENCES member_wiki_tasks(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'withdrawn')),
  contribution jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, slug)
);
