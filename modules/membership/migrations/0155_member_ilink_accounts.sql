-- Token/context are AES-256-GCM ciphertext; one bot identity for each bound member.
CREATE TABLE IF NOT EXISTS member_ilink_accounts (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  recipient_id text NOT NULL,
  channel_account_id text NOT NULL UNIQUE,
  token_ciphertext text NOT NULL,
  api_url text NOT NULL,
  context_ciphertext text,
  cursor_ciphertext text,
  channel_state text NOT NULL DEFAULT 'needs_interaction',
  last_inbound_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
