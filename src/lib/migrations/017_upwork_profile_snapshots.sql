-- Migration 017: Upwork freelancer profile snapshots.
-- Stores rich profile JSON (extracted from saved Upwork HTML by docs/profiles/extract-profile.js)
-- with append-only history. Each row is a snapshot taken at one point in time; only the most
-- recent snapshot per profile has is_current = TRUE.
--
-- Read path: SELECT FROM upwork_profile_snapshots_current (the view) for the "live" snapshot.
-- Read path (history): SELECT FROM upwork_profile_snapshots ORDER BY extracted_at DESC.
-- Write path: BEGIN; UPDATE old row to is_current=FALSE; INSERT new with is_current=TRUE; COMMIT.
-- The partial unique index enforces the "at most one current row per profile" invariant at the DB level.
--
-- pg_trgm enables fast ILIKE '%keyword%' over skills_summary. The JSONB GIN index on data->'skills'
-- supports structural matches like data->'skills' @> '[{"name":"Laravel"}]'::jsonb.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS upwork_profile_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
  extracted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,

  -- promoted hot columns (extracted from data on insert)
  name                TEXT,
  title               TEXT,
  hourly_rate         NUMERIC(10,2),
  rating              NUMERIC(3,2),
  job_success_score   INTEGER,
  top_rated_status    TEXT,
  total_jobs_worked   INTEGER,
  total_hours         NUMERIC(10,2),
  last_worked_on      DATE,
  profile_url         TEXT,
  ciphertext          TEXT,
  skills_summary      TEXT,

  -- everything else (the full extractor JSON)
  data                JSONB NOT NULL,

  -- audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one current row per profile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upwork_snapshot_current_per_profile
  ON upwork_profile_snapshots(profile_id) WHERE is_current = TRUE;

-- Lookup indexes.
CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_profile      ON upwork_profile_snapshots(profile_id);
CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_extracted_at ON upwork_profile_snapshots(extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_top_rated    ON upwork_profile_snapshots(top_rated_status)
  WHERE is_current = TRUE;

-- Skill-keyword search (current snapshots only).
CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_skills_trgm  ON upwork_profile_snapshots
  USING GIN (skills_summary gin_trgm_ops) WHERE is_current = TRUE;

-- Structural skill match (current snapshots only).
CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_skills_jsonb ON upwork_profile_snapshots
  USING GIN ((data->'skills')) WHERE is_current = TRUE;

-- Convenience view: the current snapshot for every profile.
CREATE OR REPLACE VIEW upwork_profile_snapshots_current AS
  SELECT * FROM upwork_profile_snapshots WHERE is_current = TRUE;

-- Bust stats cache for consistency with prior migrations.
DELETE FROM stats_cache;
