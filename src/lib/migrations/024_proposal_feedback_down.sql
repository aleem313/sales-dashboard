-- Rollback for migration 024: drop the proposal_feedback table.
-- Destructive — discards all captured proposal feedback + regeneration history.

DROP TABLE IF EXISTS proposal_feedback;

DELETE FROM stats_cache;
