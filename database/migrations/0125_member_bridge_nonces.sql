CREATE TABLE member_bridge_nonces (
  nonce_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
