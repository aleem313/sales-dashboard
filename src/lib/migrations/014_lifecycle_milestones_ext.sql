-- Migration 014: Extend lifecycle milestone columns
-- Adds proposal_viewed_at, in_chat_at, meeting_done_at — same pattern as 013.
-- Enables historical-reach counters so a job that passed through a stage
-- still counts for that stage even after it moves to Lost/Won.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS proposal_viewed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS in_chat_at          TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS meeting_done_at     TIMESTAMPTZ;

-- Backfill proposal_viewed_at from activity_log
UPDATE jobs j SET proposal_viewed_at = sub.first_viewed
FROM (
  SELECT j2.id AS job_id, MIN(al.created_at) AS first_viewed
  FROM jobs j2
  JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
  JOIN activity_log al ON al.task_id = t.id
  WHERE al.action_type = 'task_moved'
    AND al.field = 'column'
    AND LOWER(al.new_value) IN ('proposal views', 'proposal viewed', 'viewed')
    AND j2.proposal_viewed_at IS NULL
  GROUP BY j2.id
) sub
WHERE j.id = sub.job_id;

-- Fallback: any job currently in post-views stages with no activity_log hit
UPDATE jobs SET proposal_viewed_at = COALESCE(stage_entered_at, updated_at)
WHERE proposal_viewed_at IS NULL
  AND LOWER(status) IN (
    'proposal views', 'proposal viewed',
    'in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost'
  );

-- Backfill in_chat_at from activity_log
UPDATE jobs j SET in_chat_at = sub.first_chat
FROM (
  SELECT j2.id AS job_id, MIN(al.created_at) AS first_chat
  FROM jobs j2
  JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
  JOIN activity_log al ON al.task_id = t.id
  WHERE al.action_type = 'task_moved'
    AND al.field = 'column'
    AND LOWER(al.new_value) IN ('in chat', 'following up')
    AND j2.in_chat_at IS NULL
  GROUP BY j2.id
) sub
WHERE j.id = sub.job_id;

UPDATE jobs SET in_chat_at = COALESCE(stage_entered_at, updated_at)
WHERE in_chat_at IS NULL
  AND LOWER(status) IN ('in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost');

-- Backfill meeting_done_at from activity_log (specifically the Meeting Done column)
UPDATE jobs j SET meeting_done_at = sub.first_done
FROM (
  SELECT j2.id AS job_id, MIN(al.created_at) AS first_done
  FROM jobs j2
  JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
  JOIN activity_log al ON al.task_id = t.id
  WHERE al.action_type = 'task_moved'
    AND al.field = 'column'
    AND LOWER(al.new_value) = 'meeting done'
    AND j2.meeting_done_at IS NULL
  GROUP BY j2.id
) sub
WHERE j.id = sub.job_id;

UPDATE jobs SET meeting_done_at = COALESCE(stage_entered_at, updated_at)
WHERE meeting_done_at IS NULL
  AND LOWER(status) IN ('meeting done', 'negotiation', 'won', 'lost');

-- Partial indexes for efficient "historical reach" counters
CREATE INDEX IF NOT EXISTS idx_jobs_proposal_viewed_at ON jobs(proposal_viewed_at) WHERE proposal_viewed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_in_chat_at         ON jobs(in_chat_at)         WHERE in_chat_at         IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_meeting_done_at    ON jobs(meeting_done_at)    WHERE meeting_done_at    IS NOT NULL;
