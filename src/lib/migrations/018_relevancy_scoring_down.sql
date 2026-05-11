-- Migration 018 rollback.
--
-- Reverses `018_relevancy_scoring.sql`. Safe before the classifier ships (no
-- `relevancy_scores` rows accumulated yet). Once scoring is live and rows
-- accumulate, rollback loses calibration data — see plan §14.6.
--
-- Order: child → parent to satisfy FK constraints.
-- `system_settings` rows are operator state (mode toggle, min_score) — losing
-- them is harmless because the up-migration's seed re-creates safe defaults.

DROP INDEX IF EXISTS idx_idempotency_expires;
DROP TABLE IF EXISTS idempotency_keys;

DROP INDEX IF EXISTS idx_overrides_task;
DROP INDEX IF EXISTS idx_overrides_score;
DROP TABLE IF EXISTS relevancy_overrides;

DROP INDEX IF EXISTS idx_mje_task;
DROP INDEX IF EXISTS idx_mje_profile;
DROP TABLE IF EXISTS manual_job_evaluations;

DROP INDEX IF EXISTS idx_rs_dlq_pending;
DROP TABLE IF EXISTS relevancy_scores_dlq;

DROP INDEX IF EXISTS idx_rs_request;
DROP INDEX IF EXISTS idx_rs_source;
DROP INDEX IF EXISTS idx_rs_evaluated;
DROP INDEX IF EXISTS idx_rs_decision;
DROP INDEX IF EXISTS idx_rs_profile;
DROP INDEX IF EXISTS idx_rs_task;
DROP INDEX IF EXISTS idx_rs_snapshot;
DROP INDEX IF EXISTS idx_rs_mode;
DROP INDEX IF EXISTS idx_rs_flipped;
DROP INDEX IF EXISTS idx_rs_effective;
DROP TABLE IF EXISTS relevancy_scores;

DROP TABLE IF EXISTS criteria_versions;

DROP INDEX IF EXISTS idx_system_settings_updated;
DROP TABLE IF EXISTS system_settings;

ALTER TABLE profiles DROP COLUMN IF EXISTS min_score_override;
ALTER TABLE profiles DROP COLUMN IF EXISTS classifier_enabled;
ALTER TABLE profiles DROP COLUMN IF EXISTS thresholds_overrides;
