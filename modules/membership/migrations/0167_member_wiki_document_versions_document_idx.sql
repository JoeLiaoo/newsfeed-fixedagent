CREATE INDEX CONCURRENTLY IF NOT EXISTS member_wiki_document_versions_document_idx ON member_wiki_document_versions(document_id, version_no DESC);
