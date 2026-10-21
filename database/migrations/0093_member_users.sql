CREATE TABLE member_users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  real_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','disabled')),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  interests_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text REFERENCES member_users(id)
);
