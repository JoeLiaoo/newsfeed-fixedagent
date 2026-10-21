CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_expert_tasks_owner_idempotency_idx
  ON member_expert_tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
