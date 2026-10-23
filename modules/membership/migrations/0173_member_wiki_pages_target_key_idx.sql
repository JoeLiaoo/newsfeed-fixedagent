CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_wiki_pages_target_key_idx ON member_wiki_pages(target_key) WHERE target_key <> ''
