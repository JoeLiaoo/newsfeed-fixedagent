-- One short-lived QR per approved site's logged-in session, no channel tokens returned to the browser.
CREATE TABLE IF NOT EXISTS member_ilink_logins (
  user_id text PRIMARY KEY REFERENCES member_users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  qr_secret text NOT NULL,
  qr_url text NOT NULL,
  status text NOT NULL DEFAULT 'wait',
  api_url text NOT NULL DEFAULT 'https://ilinkai.weixin.qq.com',
  expires_at timestamptz NOT NULL,
  last_polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
