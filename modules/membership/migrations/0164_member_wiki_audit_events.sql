CREATE TABLE member_wiki_audit_events (
  id text PRIMARY KEY,
  actor_id text REFERENCES member_users(id),
  event_type text NOT NULL,
  document_id text REFERENCES member_wiki_documents(id),
  version_id text REFERENCES member_wiki_document_versions(id),
  task_id text REFERENCES member_wiki_tasks(id),
  page_id text REFERENCES member_wiki_pages(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
