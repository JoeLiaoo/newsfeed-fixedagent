CREATE TABLE member_gp_snapshot_evidence (
  snapshot_id text PRIMARY KEY REFERENCES member_gp_snapshots(id) ON DELETE CASCADE,
  raw_rows jsonb NOT NULL,
  sha256 text NOT NULL
);
