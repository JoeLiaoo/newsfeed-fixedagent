CREATE TABLE member_interest_tags (
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, tag)
);
