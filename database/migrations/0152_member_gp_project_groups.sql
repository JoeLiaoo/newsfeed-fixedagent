-- Existing GPs remain unclassified until an administrator supplies a basis.
ALTER TABLE member_gp_watchlist ADD COLUMN project_groups text[] NOT NULL DEFAULT '{}';
