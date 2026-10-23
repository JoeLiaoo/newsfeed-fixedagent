CREATE TABLE member_wiki_tasks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES member_wiki_documents(id),
  version_id text NOT NULL REFERENCES member_wiki_document_versions(id),
  uploader_id text NOT NULL REFERENCES member_users(id),
  stage text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'extracting', 'compiling', 'auditing', 'linting', 'publishing', 'published', 'failed')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count int NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  draft jsonb,
  audit jsonb,
  lease_token text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
