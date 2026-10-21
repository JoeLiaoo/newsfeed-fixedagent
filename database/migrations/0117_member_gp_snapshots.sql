CREATE TABLE member_gp_snapshots (
  id text PRIMARY KEY,
  gp_id text NOT NULL REFERENCES member_gp_watchlist(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'xinhua',
  captured_at timestamptz NOT NULL DEFAULT now(),
  complete boolean NOT NULL,
  source_total integer,
  fetched_count integer NOT NULL,
  row_count integer NOT NULL,
  error_code text
);
