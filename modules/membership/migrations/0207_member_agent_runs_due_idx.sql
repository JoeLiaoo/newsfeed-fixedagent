CREATE INDEX CONCURRENTLY IF NOT EXISTS member_agent_runs_due_idx ON member_agent_runs(created_at) WHERE status='pending';
