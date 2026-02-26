-- Vollna Analytics Dashboard Schema
-- Replaces e-commerce schema. Source of truth: DASHBOARD_DEV.md Section 4.

-- Drop old e-commerce tables
DROP TABLE IF EXISTS sales CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS regions CASCADE;
DROP TABLE IF EXISTS categories CASCADE;

-- Drop old Vollna tables if re-running
DROP VIEW IF EXISTS profile_stats CASCADE;
DROP VIEW IF EXISTS agent_stats CASCADE;
DROP TABLE IF EXISTS stats_cache CASCADE;
DROP TABLE IF EXISTS sync_log CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS agents CASCADE;

-- ============================================================
-- AGENTS — human freelancers managing proposals for 1+ profiles
-- ============================================================
CREATE TABLE agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_user_id   TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT,
  avatar_url        TEXT,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROFILES — Upwork accounts targeting a specific tech stack
-- ============================================================
CREATE TABLE profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        TEXT UNIQUE NOT NULL,        -- matches Google Sheet profile_id
  profile_name      TEXT NOT NULL,
  stack             TEXT,
  vollna_filter_tag TEXT UNIQUE,
  agent_id          UUID REFERENCES agents(id),
  clickup_list_id   TEXT,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- JOBS — Upwork job postings received from Vollna
-- ============================================================
CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            TEXT UNIQUE NOT NULL,        -- Vollna/Upwork job ID
  job_title         TEXT NOT NULL,
  job_url           TEXT,
  job_description   TEXT,
  budget_type       TEXT,                        -- 'fixed' | 'hourly'
  budget_min        DECIMAL(10,2),
  budget_max        DECIMAL(10,2),
  hourly_min        DECIMAL(10,2),
  hourly_max        DECIMAL(10,2),
  skills            TEXT[],                      -- array of skill strings
  client_country    TEXT,
  client_rating     DECIMAL(3,2),
  client_total_spent DECIMAL(12,2),
  client_hires      INTEGER,
  posted_at         TIMESTAMPTZ,
  received_at       TIMESTAMPTZ DEFAULT NOW(),
  profile_id        TEXT REFERENCES profiles(profile_id),
  agent_id          UUID REFERENCES agents(id),
  clickup_task_id   TEXT,
  clickup_task_url  TEXT,
  clickup_status    TEXT DEFAULT 'Proposal Ready',
  proposal_text     TEXT,
  gpt_model         TEXT,
  gpt_tokens_used   INTEGER,
  outcome           TEXT,                        -- 'won' | 'lost' | 'pending' | 'skipped'
  won_value         DECIMAL(10,2),
  proposal_sent_at  TIMESTAMPTZ,
  outcome_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SYNC_LOG — tracks data sync operations
-- ============================================================
CREATE TABLE sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,                 -- 'clickup' | 'sheets' | 'n8n_webhook'
  records_synced  INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  errors          TEXT[],
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'running'         -- 'running' | 'success' | 'failed'
);

-- ============================================================
-- STATS_CACHE — materialized stats refreshed by cron
-- ============================================================
CREATE TABLE stats_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key       TEXT UNIQUE NOT NULL,
  data            JSONB NOT NULL,
  computed_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX idx_jobs_agent_id ON jobs(agent_id);
CREATE INDEX idx_jobs_received_at ON jobs(received_at DESC);
CREATE INDEX idx_jobs_clickup_status ON jobs(clickup_status);
CREATE INDEX idx_jobs_outcome ON jobs(outcome);
CREATE INDEX idx_jobs_job_id ON jobs(job_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- Agent performance summary
CREATE VIEW agent_stats AS
SELECT
  a.id,
  a.name,
  a.clickup_user_id,
  COUNT(j.id) AS total_jobs,
  COUNT(CASE WHEN j.proposal_sent_at IS NOT NULL THEN 1 END) AS proposals_sent,
  COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
  COUNT(CASE WHEN j.outcome = 'lost' THEN 1 END) AS lost,
  ROUND(
    COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
    NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
  ) AS win_rate_pct,
  COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue,
  AVG(
    CASE WHEN j.proposal_sent_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.proposal_sent_at - j.received_at)) / 3600
    END
  ) AS avg_response_hours
FROM agents a
LEFT JOIN jobs j ON j.agent_id = a.id
GROUP BY a.id, a.name, a.clickup_user_id;

-- Profile performance summary
CREATE VIEW profile_stats AS
SELECT
  p.id,
  p.profile_id,
  p.profile_name,
  p.stack,
  COUNT(j.id) AS total_jobs,
  COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
  ROUND(
    COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
    NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
  ) AS win_rate_pct,
  AVG(CASE WHEN j.outcome = 'won' THEN j.won_value END) AS avg_won_value,
  COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue
FROM profiles p
LEFT JOIN jobs j ON j.profile_id = p.profile_id
GROUP BY p.id, p.profile_id, p.profile_name, p.stack;
