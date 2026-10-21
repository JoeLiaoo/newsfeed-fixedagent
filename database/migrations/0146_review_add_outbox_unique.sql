CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_notification_outbox_edition_part_idx
  ON member_notification_outbox(user_id,kind,local_date,binding_version,subscription_version,part_index);
