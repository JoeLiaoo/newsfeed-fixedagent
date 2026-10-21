CREATE INDEX CONCURRENTLY IF NOT EXISTS member_sessions_expiry_idx ON member_sessions(expires_at);
