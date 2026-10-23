CREATE TABLE member_wiki_pages (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  page_type text NOT NULL CHECK (page_type IN ('view', 'query', 'concept', 'monitor')),
  target_type text,
  target_name text,
  track text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
