ALTER TABLE member_notification_outbox ADD COLUMN subscription_version integer NOT NULL DEFAULT 1;
