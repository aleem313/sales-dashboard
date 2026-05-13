-- Migration 022: Add job_title column to relevancy_scores.
--
-- Problem surfaced 2026-05-13 after Phase 14 (Active rollout) went live:
-- when the classifier rejects in Active mode, the parent workflow routes
-- `active_reject → End (Audit Only)` so NO task row is created. The audit
-- page joins `relevancy_scores ← tasks ON tasks.custom_fields._relevancy_score_id`
-- and falls back to "Untitled" when the join misses — which is now the
-- common case for every Active-mode reject.
--
-- Fix: persist the job title onto the score row at write time. The
-- classifier core's C6/C7 verdict-builders inject `job_title` from
-- upstream.job.title (the n8n parent payload), and /api/relevancy-scores
-- writes it through to this column. Audit reads then COALESCE with the
-- tasks-join title for backwards compatibility with pre-022 rows.
--
-- Idempotent — safe to re-run.

ALTER TABLE relevancy_scores
  ADD COLUMN IF NOT EXISTS job_title TEXT;

-- Same problem for the "Open on Upwork" link: post-Active reject rows have
-- no task row to join through, AND many rows have NULL job_external_id
-- (the LLM/C6 path doesn't promote it; only C7 Path A deterministic-reject
-- does). Even when the ID is present, the URL form Vollna sends doesn't
-- always match the `~01...` canonical URL prefix, so reconstructing from
-- job_external_id is unreliable. Persist the full URL the classifier
-- received in the job payload instead.
ALTER TABLE relevancy_scores
  ADD COLUMN IF NOT EXISTS job_url TEXT;

-- No backfill: pre-022 rows fall back to the existing tasks-join path.

-- Bust stats cache (matches prior migrations' housekeeping).
DELETE FROM stats_cache;
