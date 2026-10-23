CREATE TABLE member_wiki_citations (
  id text PRIMARY KEY,
  page_id text NOT NULL REFERENCES member_wiki_pages(id),
  revision int NOT NULL,
  version_id text NOT NULL REFERENCES member_wiki_document_versions(id),
  label text NOT NULL,
  anchor text,
  analyst text,
  organization text,
  published_on date,
  source_title text,
  created_at timestamptz NOT NULL DEFAULT now()
);
