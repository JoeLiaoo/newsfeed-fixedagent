-- A response may commit only while its exact account lease remains current.
-- Nullable columns keep existing accounts and the previous release readable during migration.
ALTER TABLE member_ilink_accounts ADD COLUMN poll_lease_owner uuid;
