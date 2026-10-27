CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_agent_one_running_per_user ON member_agent_runs(user_id) WHERE status='running';
