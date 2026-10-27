-- Nullable for existing rows and writers running the previous release during rollout.
ALTER TABLE member_ilink_inbound_messages ADD COLUMN received_at timestamptz;
