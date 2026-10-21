-- Employee accounts, approval, private interests, and opaque browser sessions.
CREATE TABLE member_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  real_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','disabled')),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text REFERENCES member_users(id)
);

CREATE TABLE member_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_sessions_expiry_idx ON member_sessions(expires_at);

CREATE TABLE member_interest_tags (
  user_id text NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, tag)
);
CREATE INDEX member_interest_tag_idx ON member_interest_tags(tag);

CREATE TABLE public_interest_tags (
  tag text PRIMARY KEY,
  created_by text REFERENCES member_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
