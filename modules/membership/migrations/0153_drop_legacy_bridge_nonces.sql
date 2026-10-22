-- Nonces belonged only to the retired manual-code bridge claim endpoint.
-- Rollout requires disabling the old claim handler before applying this migration.
DROP TABLE IF EXISTS member_bridge_nonces;
