-- The wider status check, added as NOT VALID so it does not scan the table under a strong lock.
ALTER TABLE member_experts ADD CONSTRAINT member_experts_status_check CHECK (status IN ('available', 'blocked', 'hidden')) NOT VALID;
