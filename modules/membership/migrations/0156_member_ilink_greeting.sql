-- One connection confirmation per bound iLink account; the flag survives restarts and new polls.
ALTER TABLE member_ilink_accounts ADD COLUMN IF NOT EXISTS greeted_at timestamptz;
