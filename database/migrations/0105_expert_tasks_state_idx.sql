CREATE INDEX CONCURRENTLY IF NOT EXISTS member_expert_tasks_state_idx ON member_expert_tasks(state, updated_at);
