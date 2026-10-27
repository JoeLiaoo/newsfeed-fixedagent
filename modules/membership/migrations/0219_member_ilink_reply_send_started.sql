-- Nullable so pre-deploy processes can continue to insert reply rows.
ALTER TABLE member_ilink_reply_outbox ADD COLUMN send_started_at timestamptz;
