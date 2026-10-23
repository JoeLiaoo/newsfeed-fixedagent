CREATE TABLE member_wiki_answers (
  id text PRIMARY KEY,
  question text NOT NULL,
  answer_md text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  asked_by text REFERENCES member_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
