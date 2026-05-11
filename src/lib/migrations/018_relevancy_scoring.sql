-- Migration 018: Upwork Relevancy Scoring AI — operator controls + scoring tables.
--
-- This is the schema substrate for the v3.3 classifier (Gemini Flash 2.5 + n8n).
-- The migration is fully additive: 3 new columns on `profiles`, 7 new tables, no
-- changes to existing data. Idempotent — safe to re-run.
--
-- New surfaces:
--   • system_settings              → global operator knobs (classifier_mode, min_score)
--   • profiles.thresholds_overrides → per-profile gate-threshold overrides (JSONB)
--   • profiles.classifier_enabled  → per-profile shadow/active toggle
--   • profiles.min_score_override  → per-profile min_score override (NULL = global)
--   • criteria_versions            → immutable PRD-version registry
--   • relevancy_scores             → canonical scoring log (auto + manual)
--   • relevancy_scores_dlq         → dead-letter queue for failed score writes
--   • manual_job_evaluations       → admin "Task Card Evaluator" request log
--   • relevancy_overrides          → agent disagreements with classifier (calibration)
--   • idempotency_keys             → 24h replay cache for n8n → Next.js callbacks
--
-- See `docs/upwork-relevancy-scoring-ai-plan-v3.md` §9.2 (full schema) and §10.9.6
-- (idempotency middleware). Rollback script: `018_relevancy_scoring_down.sql`.
--
-- NOTE: `criteria_versions` starts empty. The PRD v0.2 row is seeded in Phase 4
-- (PRD freeze) — it is NOT inserted here so this migration stays domain-agnostic.
-- The classifier (Phase 6+) cannot persist `relevancy_scores` rows until that
-- seed exists, which is the intended ordering.

-- ============================================================================
-- 1. Global operator controls (system_settings)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  description  TEXT,
  updated_by   TEXT,                                  -- session.user.id of last editor
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated ON system_settings (updated_at DESC);

-- Seed v3.3 defaults (safe to re-run — ON CONFLICT DO NOTHING).
INSERT INTO system_settings (key, value, description) VALUES
  ('relevancy.classifier_mode', '"shadow"'::jsonb,
   'Global classifier routing mode. shadow = score only, no routing. active = AI decision drives routing.'),
  ('relevancy.min_score', '50'::jsonb,
   'Global minimum total_score threshold. proceed verdicts with total_score < this value are flipped to reject when classifier_mode=active.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Per-profile operator controls (additions to profiles)
-- ============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS thresholds_overrides JSONB DEFAULT '{}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS classifier_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS min_score_override INTEGER
  CHECK (min_score_override IS NULL OR (min_score_override >= 0 AND min_score_override <= 100));

-- ============================================================================
-- 3. Criteria version registry (immutable PRD-version history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS criteria_versions (
  version          TEXT PRIMARY KEY,
  prd_changelog    TEXT NOT NULL,
  thresholds       JSONB NOT NULL,                  -- snapshot of all gate thresholds at this version
  reason_enum      TEXT[] NOT NULL,                 -- valid PRD §6.2 rejection-reason labels (typos preserved)
  output_schema    JSONB,                           -- expected Gemini structured-output schema for this version
  prompt_versions  TEXT[],                          -- prompt versions compatible with this criteria version
  effective_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. Canonical scoring log (auto pipeline + manual evaluator)
-- ============================================================================

CREATE TABLE IF NOT EXISTS relevancy_scores (
  id                          BIGSERIAL PRIMARY KEY,
  task_id                     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  job_external_id             TEXT,                                                     -- Upwork stable job ID
  profile_id                  TEXT REFERENCES profiles(profile_id),
  decision                    TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),

  -- v3.3 threshold fields (post-min_score adjustment)
  effective_decision          TEXT NOT NULL CHECK (effective_decision IN ('proceed','reject','review')),
  threshold_flipped           BOOLEAN NOT NULL DEFAULT FALSE,
  min_score_at_decision       INTEGER CHECK (min_score_at_decision IS NULL OR (min_score_at_decision BETWEEN 0 AND 100)),
  classifier_mode_at_decision TEXT NOT NULL CHECK (classifier_mode_at_decision IN ('shadow','active')),

  snapshot_id                 UUID,                                                     -- references upwork_profile_snapshots.id; soft (no FK) since snapshot may be deleted later

  rejection_reasons           TEXT[],
  gates_passed                INTEGER[] CHECK (gates_passed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
  gates_failed                INTEGER[] CHECK (gates_failed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
  gates_evidence              JSONB,                                                    -- per-gate evidence for audit
  components                  JSONB,                                                    -- 7 rubric components
  total_score                 INTEGER,
  tier                        TEXT,
  confidence                  NUMERIC(4,3),
  confidence_warnings         TEXT[],                                                   -- e.g. ['stale_snapshot','non_english_description']
  proposal_angles             TEXT[],
  evidence_panel              JSONB,                                                    -- human-readable bundle for UI (manual eval only)
  summary                     TEXT,
  missing_signals             TEXT[],
  thresholds_used             JSONB,                                                    -- snapshot of effective per-gate thresholds at score time

  model                       TEXT NOT NULL,
  prompt_version              TEXT NOT NULL,
  prompt_mode                 TEXT NOT NULL CHECK (prompt_mode IN ('A_full','B_edge')),
  criteria_version            TEXT NOT NULL REFERENCES criteria_versions(version),
  evaluation_path             TEXT NOT NULL CHECK (evaluation_path IN ('deterministic','llm','llm_after_deterministic','manual_url','shadow')),

  request_id                  UUID,                                                     -- propagated from ingress; end-to-end tracing
  source                      TEXT CHECK (source IN ('auto','manual_url')),
  requested_by                TEXT,                                                     -- session.user.id from server (never trusted from body)

  input_tokens                INTEGER,
  output_tokens               INTEGER,
  latency_ms                  INTEGER,
  evaluated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rs_effective  ON relevancy_scores (effective_decision, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_flipped    ON relevancy_scores (threshold_flipped, evaluated_at DESC) WHERE threshold_flipped = TRUE;
CREATE INDEX IF NOT EXISTS idx_rs_mode       ON relevancy_scores (classifier_mode_at_decision, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_snapshot   ON relevancy_scores (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_rs_task       ON relevancy_scores (task_id);
CREATE INDEX IF NOT EXISTS idx_rs_profile    ON relevancy_scores (profile_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_decision   ON relevancy_scores (decision);
CREATE INDEX IF NOT EXISTS idx_rs_evaluated  ON relevancy_scores (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_source     ON relevancy_scores (source, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_request    ON relevancy_scores (request_id);

-- ============================================================================
-- 5. Dead-letter queue for failed audit-log writes
-- ============================================================================

CREATE TABLE IF NOT EXISTS relevancy_scores_dlq (
  id              BIGSERIAL PRIMARY KEY,
  payload         JSONB NOT NULL,                  -- the verdict that couldn't be persisted
  error_detail    TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_rs_dlq_pending ON relevancy_scores_dlq (next_attempt_at) WHERE resolved_at IS NULL;

-- ============================================================================
-- 6. Manual evaluator request log
-- ============================================================================

CREATE TABLE IF NOT EXISTS manual_job_evaluations (
  id            BIGSERIAL PRIMARY KEY,
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id    TEXT NOT NULL REFERENCES profiles(profile_id),
  score_id      BIGINT REFERENCES relevancy_scores(id),
  requested_by  TEXT NOT NULL,
  load_status   TEXT CHECK (load_status IN ('success','partial','failed')),
  load_error    TEXT,                                                          -- when task lookup or snapshot read fails
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mje_profile ON manual_job_evaluations (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mje_task    ON manual_job_evaluations (task_id, created_at DESC);

-- ============================================================================
-- 7. Override capture (agent disagrees with classifier verdict)
-- ============================================================================

CREATE TABLE IF NOT EXISTS relevancy_overrides (
  id                  BIGSERIAL PRIMARY KEY,
  score_id            BIGINT NOT NULL REFERENCES relevancy_scores(id),
  task_id             UUID NOT NULL REFERENCES tasks(id),
  classifier_decision TEXT NOT NULL,
  agent_action        TEXT NOT NULL,                                            -- e.g. 'moved_to_na', 'moved_to_proposal_submitted'
  agent_id            UUID REFERENCES agents(id),
  override_reason     TEXT[],                                                   -- multi-select, mirrors PRD §6.2 labels (typos preserved)
  source              TEXT CHECK (source IN ('auto','manual_url')),             -- snapshot of the score's source for audit filtering
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_overrides_score ON relevancy_overrides (score_id);
CREATE INDEX IF NOT EXISTS idx_overrides_task  ON relevancy_overrides (task_id, created_at DESC);

-- ============================================================================
-- 8. Idempotency cache (24h TTL, pruned by cron)
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

-- ============================================================================
-- 9. Bust stats cache for consistency with prior migrations
-- ============================================================================

DELETE FROM stats_cache;
