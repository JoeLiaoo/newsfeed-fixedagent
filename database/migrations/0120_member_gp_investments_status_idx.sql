CREATE INDEX CONCURRENTLY IF NOT EXISTS member_gp_investments_status_idx ON member_gp_investments(status,first_seen_at);
