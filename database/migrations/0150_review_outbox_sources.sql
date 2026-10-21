CREATE TABLE member_notification_outbox_sources (
  outbox_id text NOT NULL REFERENCES member_notification_outbox(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  PRIMARY KEY(outbox_id,source_key)
);
