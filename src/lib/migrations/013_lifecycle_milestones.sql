-- Migration 013: Add lifecycle milestone columns to jobs
-- These columns track WHEN a job first reached key milestones,
-- enabling lifecycle-based metrics (e.g., a Won job still counts as Meeting Booked)

-- Add meeting_booked_at column
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS meeting_booked_at TIMESTAMPTZ;

-- Backfill meeting_booked_at from activity_log (most accurate: first time task entered meeting column)
UPDATE jobs j SET meeting_booked_at = sub.first_meeting
FROM (
  SELECT j2.id AS job_id, MIN(al.created_at) AS first_meeting
  FROM jobs j2
  JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
  JOIN activity_log al ON al.task_id = t.id
  WHERE al.action_type = 'task_moved'
    AND al.field = 'column'
    AND LOWER(al.new_value) IN ('meeting scheduled', 'meeting done')
    AND j2.meeting_booked_at IS NULL
  GROUP BY j2.id
) sub
WHERE j.id = sub.job_id;

-- Backfill fallback: jobs currently in meeting+ statuses with no activity_log match
UPDATE jobs SET meeting_booked_at = COALESCE(stage_entered_at, updated_at)
WHERE meeting_booked_at IS NULL
  AND LOWER(status) IN ('meeting scheduled', 'meeting done');

-- Backfill proposal_sent_at for any jobs that have it NULL but are in post-sent statuses
UPDATE jobs SET proposal_sent_at = COALESCE(stage_entered_at, updated_at)
WHERE proposal_sent_at IS NULL
  AND LOWER(status) IN ('proposal submitted', 'sent', 'submitted', 'following up',
    'prototype required', 'prototype done', 'prototype sent',
    'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost');

-- Index for efficient date-range queries on milestone columns
CREATE INDEX IF NOT EXISTS idx_jobs_meeting_booked_at ON jobs(meeting_booked_at) WHERE meeting_booked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_proposal_sent_at ON jobs(proposal_sent_at) WHERE proposal_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_outcome_at ON jobs(outcome_at) WHERE outcome_at IS NOT NULL;
