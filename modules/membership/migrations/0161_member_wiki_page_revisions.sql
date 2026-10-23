CREATE TABLE member_wiki_page_revisions (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES member_wiki_pages(id),
  revision int NOT NULL,
  body_md text NOT NULL,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_id text REFERENCES member_wiki_tasks(id),
  version_id text REFERENCES member_wiki_document_versions(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, revision)
);
