CREATE INDEX CONCURRENTLY IF NOT EXISTS member_gp_snapshots_gp_idx ON member_gp_snapshots(gp_id,captured_at DESC);
