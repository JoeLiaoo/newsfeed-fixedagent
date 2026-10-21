CREATE INDEX CONCURRENTLY IF NOT EXISTS member_daily_digest_history_idx ON member_daily_digests(user_id, local_date DESC, generated_at DESC);
