-- Position returned by one getupdates call. Nullable for historical rows and
-- synthetic task events; adding it does not rewrite the live inbound table.
ALTER TABLE member_ilink_inbound_messages ADD COLUMN poll_position integer;
