ALTER TABLE member_gp_watchlist
  ADD CONSTRAINT member_gp_project_groups_valid CHECK (
    project_groups <@ ARRAY['citic-alliance','market-leaders']::text[]
    AND (cardinality(project_groups) = 0 OR length(btrim(coalesce(project_group_basis, ''))) >= 8)
  ) NOT VALID;
