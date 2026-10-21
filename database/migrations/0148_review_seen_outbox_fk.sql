ALTER TABLE member_notification_seen ADD CONSTRAINT member_notification_seen_outbox_fk
  FOREIGN KEY(outbox_id) REFERENCES member_notification_outbox(id) ON DELETE SET NULL NOT VALID;
