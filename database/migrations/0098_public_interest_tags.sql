CREATE TABLE public_interest_tags (
  tag text PRIMARY KEY,
  created_by text REFERENCES member_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
