-- Migration 015: Make stage_entered_at the canonical status-change filter timestamp
-- Dashboard / pipeline / agent KPIs now filter by "when did this job's status last change"
-- instead of "when did this job arrive". The column already exists (added M004) and is
-- maintained by syncJobStatusFromTask() on every column move — this migration just makes
-- it safe to filter on (backfill NULLs, default for new rows, index for performance).

-- Step 1: Backfill NULL stage_entered_at from received_at.
-- Safe — only touches rows that have never had a status change recorded.
UPDATE jobs SET stage_entered_at = received_at
WHERE stage_entered_at IS NULL;

-- Step 2: Default NOW() so future INSERTs (e.g., n8n webhook upsertJob) get a
-- non-NULL value automatically without code changes.
ALTER TABLE jobs ALTER COLUMN stage_entered_at SET DEFAULT NOW();

-- Step 3: Index for date-range filtering on status-change date.
-- DESC matches typical "recent activity" sort order.
CREATE INDEX IF NOT EXISTS idx_jobs_stage_entered_at ON jobs (stage_entered_at DESC);

-- Step 4: Wipe stats_cache so the 5-min TTL doesn't serve stale-meaning data
-- immediately post-deploy. Non-destructive — repopulates on next request.
DELETE FROM stats_cache;
