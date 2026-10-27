-- No historical backfill: a past accepted status is not an exact acceptance time.
ALTER TABLE member_ilink_reply_outbox ADD COLUMN accepted_at timestamptz;
