CREATE TABLE member_wiki_quality_issues (
  id text PRIMARY KEY,
  page_id text REFERENCES member_wiki_pages(id),
  level text NOT NULL CHECK (level IN ('P0', 'P1', 'advisory')),
  category text NOT NULL,
  target text,
  message text NOT NULL,
  evidence text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  detected_at timestamptz NOT NULL DEFAULT now()
);
