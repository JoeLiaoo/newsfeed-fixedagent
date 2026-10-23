CREATE INDEX CONCURRENTLY IF NOT EXISTS member_wiki_documents_uploader_idx ON member_wiki_documents(uploader_id, created_at DESC);
