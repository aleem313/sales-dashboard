-- Migration 019: Seed criteria_versions with PRD v0.2.
--
-- The classifier (Phase 6+) cannot write `relevancy_scores` rows until this row
-- exists (FK constraint on `relevancy_scores.criteria_version`). This migration
-- unblocks Phase 6 by seeding the canonical v0.2 baseline.
--
-- Data sources:
--   • thresholds      → PRD §7 (Hard gates, v1 thresholds)
--   • reason_enum     → PRD §6.2 (Rejection reason taxonomy — TYPOS PRESERVED to match
--                       existing N/A task data: "Low Higher rate", not "Low Hourly Rate")
--   • prd_changelog   → PRD §17 v0.2 row
--   • output_schema   → NULL (defined when Phase 6 finalizes the Gemini structured-output schema)
--   • prompt_versions → NULL (set when Phase 6 ships prompts)
--
-- Idempotent — safe to re-run via ON CONFLICT (version) DO NOTHING.

INSERT INTO criteria_versions (
  version,
  prd_changelog,
  thresholds,
  reason_enum,
  output_schema,
  prompt_versions,
  effective_at
) VALUES (
  '0.2',
  -- One-line summary of the v0.2 changelog entry (full row in PRD §17).
  '2026-05-05 v0.2 — Added §6.7 reject example library, §6.8 proceed example library, and §16 Appendix C LLM-ready JSON example library with gate annotations. Additive only — no edits to v0.1 §1–§13 content.',
  -- Per-gate thresholds from PRD §7. Keys are stable gate IDs; values include the numeric threshold (where applicable), the unit, the canonical reason label on fail, and the input source.
  $$
  {
    "1": {
      "name": "stack_match",
      "type": "qualitative",
      "rule": "Job primary skill must be in assigned profile stack bucket",
      "reason_on_fail": "Out of stack",
      "input": "Vollna pre-filter + agent eyeball check"
    },
    "2": {
      "name": "job_freshness",
      "type": "numeric",
      "threshold_hours": 24,
      "comparator": "<=",
      "reason_on_fail": "Old job",
      "input": "_generated (Upwork posting timestamp)"
    },
    "3": {
      "name": "proposal_saturation",
      "type": "numeric",
      "threshold_count": 30,
      "comparator": "<",
      "buckets_accepted": ["Less than 5", "5–10", "10–15"],
      "reason_on_fail": "Too many invites",
      "input": "Upwork Proposals indicator"
    },
    "4": {
      "name": "hourly_rate_floor",
      "type": "numeric",
      "threshold_usd_per_hour": 25,
      "comparator": ">=",
      "applies_when": "budget_type == 'hourly'",
      "reason_on_fail": "Low Higher rate",
      "input": "_budget (parsed)"
    },
    "5": {
      "name": "client_spend_floor",
      "type": "numeric",
      "threshold_usd_lifetime": 1000,
      "comparator": ">=",
      "reason_on_fail": "Client Low spending",
      "input": "_client_spent"
    },
    "6": {
      "name": "client_rating_floor",
      "type": "numeric",
      "threshold_rating": 4.0,
      "comparator": ">=",
      "absent_when_new_client_ok": true,
      "reason_on_fail": "Bad rating client",
      "input": "_client_rating"
    },
    "7": {
      "name": "job_availability",
      "type": "qualitative",
      "rule": "Posting still open; not filled or closed",
      "reason_on_fail": ["Job unavailable", "Already hired"],
      "input": "Upwork posting status"
    },
    "8": {
      "name": "no_location_lockin",
      "type": "qualitative",
      "rule": "Job does not require freelancer to be in US (or any country we cannot field)",
      "reason_on_fail": "Location loc",
      "input": "Job description (Upwork badge U.S. only)"
    },
    "9": {
      "name": "no_video_proposal",
      "type": "qualitative",
      "rule": "Job description does not require a recorded video pitch",
      "reason_on_fail": "Video Proposal",
      "input": "Job description scan"
    },
    "10": {
      "name": "portfolio_match",
      "type": "qualitative",
      "rule": "Profile has at least one portfolio item that maps to the job stack",
      "reason_on_fail": "Portfolio unavailable",
      "input": "Profile portfolio knowledge"
    },
    "11": {
      "name": "no_duplicate",
      "type": "lookup",
      "rule": "_job_id is not already tracked across active boards in the last 30 days",
      "window_days": 30,
      "reason_on_fail": "Duplicate",
      "input": "Internal _job_id lookup against relevancy_scores + tasks history"
    }
  }
  $$::jsonb,
  -- Rejection-reason enum. ORDER + EXACT SPELLING matches PRD §6.2.
  -- Typos PRESERVED to align with existing N/A task data on the Task Board:
  --   • "Low Higher rate" (NOT "Low Hourly Rate" — production typo)
  -- See PRD §9.2 (typo decision) and CLAUDE.md "Connects canonical storage" pattern.
  ARRAY[
    'Out of stack',
    'Old job',
    'Too many invites',
    'Low Higher rate',
    'Location loc',
    'Client Low spending',
    'Job unavailable',
    'Already hired',
    'Language barrier',
    'Bad rating client',
    'Video Proposal',
    'Duplicate',
    'Portfolio unavailable'
  ]::TEXT[],
  -- output_schema: NULL until Phase 6 finalizes the Gemini structured-output schema.
  -- The expected shape is documented in plan v3.3 §8.4; will be backfilled by an
  -- UPDATE statement at the end of Phase 6 (not as a separate migration — same version).
  NULL,
  -- prompt_versions: NULL until Phase 6 ships A_full / B_edge prompts.
  NULL,
  '2026-05-05 00:00:00+00'::TIMESTAMPTZ
)
ON CONFLICT (version) DO NOTHING;
