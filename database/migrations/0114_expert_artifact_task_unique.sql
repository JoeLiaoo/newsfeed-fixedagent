CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_expert_artifacts_task_idx
  ON member_expert_artifacts(task_id);
