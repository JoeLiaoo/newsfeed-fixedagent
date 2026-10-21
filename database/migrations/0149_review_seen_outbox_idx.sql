CREATE INDEX CONCURRENTLY IF NOT EXISTS member_notification_seen_outbox_idx ON member_notification_seen(outbox_id) WHERE outbox_id IS NOT NULL;
