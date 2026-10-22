CREATE TABLE member_notification_outbox_sources (
  outbox_id text NOT NULL REFERENCES member_notification_outbox(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  source_key text NOT NULL,
  source_start integer NOT NULL CHECK(source_start>=0),
  source_end integer NOT NULL CHECK(source_end>source_start),
  PRIMARY KEY(outbox_id,segment_index)
);
