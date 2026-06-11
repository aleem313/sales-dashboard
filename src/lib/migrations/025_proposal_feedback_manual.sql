-- Migration 025: allow status='manual' on proposal_feedback.
--
-- Background: agents sometimes write a proposal by hand instead of using the
-- AI-drafted one. The new "I wrote my own proposal" card action records that
-- hand-written proposal as a distinct, admin-viewable event — reusing the
-- proposal_feedback table (migration 024) rather than a new table.
--
-- A manual row stores the pasted text in regenerated_proposal (the training
-- "target" slot), original_proposal = the card's _proposal at paste time (may be
-- NULL), categories = '{}', model = NULL, applied = FALSE (record-only — it does
-- NOT overwrite the card's _proposal). This makes the human proposal available to
-- the training corpus as a target while keeping it distinguishable from AI
-- regenerations via status.
--
-- Postgres has no ALTER CONSTRAINT, so we drop + recreate the inline status CHECK
-- (auto-named proposal_feedback_status_check). Mirrors migration 023's approach
-- for relevancy_overrides.override_type. Idempotent.

ALTER TABLE proposal_feedback DROP CONSTRAINT IF EXISTS proposal_feedback_status_check;

ALTER TABLE proposal_feedback
  ADD CONSTRAINT proposal_feedback_status_check
  CHECK (status IN ('feedback','regenerated','regen_failed','manual'));

-- Housekeeping consistent with prior migrations.
DELETE FROM stats_cache;
