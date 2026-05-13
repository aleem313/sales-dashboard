# Migrations

## Version History

| Version | File | Milestone | Description |
|---------|------|-----------|-------------|
| 004 | `004_cyberpunk_schema.sql` | — | connects_used, priority, rejection_reason, niche, connects_budget, bonus_earned |
| 005 | `005_agent_passwords.sql` | — | password_hash column + 4 agent passwords |
| 006 | `006_task_management_schema.sql` | M1 | 18 task management tables, 14 indexes, 3 triggers, default seed |
| 008 | (in migrate route) | — | Webhook config: Bearer token `n8n-board-sync` → target project |
| 009 | (in migrate route) | — | 14 custom field definitions for n8n job data (Job Details, Client Info, Routing Info, Proposal) |
| 010 | `010_profile_platform.sql` | — | Add `platform` column to profiles table (default: 'Upwork') |
| 011 | `011_fix_profile_assignments.sql` | — | Fix profile-to-agent assignments to match n8n flow |
| 012 | `012_remove_clickup_dependency.sql` | M8 | Rename `clickup_status` → `status`, add `jobs.task_id` FK, make `clickup_user_id` nullable |
| 013 | `013_lifecycle_milestones.sql` | — | Add `meeting_booked_at` milestone column, backfill from activity_log, partial indexes |
| 014 | (in migrate route) | — | Lifecycle milestone columns extended: `proposal_viewed_at`, `in_chat_at`, `meeting_done_at`; backfill from activity_log + partial indexes |
| 015 | `015_stage_entered_at_filter.sql` | — | Backfill `jobs.stage_entered_at` from `received_at`, set DEFAULT NOW(), add `idx_jobs_stage_entered_at`, wipe `stats_cache`. Enables status-update-date filtering on dashboards/pipeline. |
| 016 | `016_connects_purchases.sql` | — | New `connects_purchases` ledger table (profile_id, purchased_on, connects_count, amount_spent, notes, created_by) + 2 indexes. Replaces hardcoded 150 budget fallback with real per-profile purchase totals. |
| 017 | `017_upwork_profile_snapshots.sql` | — | New `upwork_profile_snapshots` append-only table for storing rich Upwork freelancer profile JSON (output of `docs/profiles/extract-profile.js`). Promoted hot columns (rating, JSS, hourly_rate, totals, top_rated_status, last_worked_on, etc.) + JSONB `data` blob. Partial unique index `(profile_id) WHERE is_current = TRUE` enforces "exactly one current snapshot per profile" at the DB level. View `upwork_profile_snapshots_current` is the default read path. `pg_trgm` extension + GIN index on `skills_summary` for fast `ILIKE '%Laravel%'` skill keyword search. Second GIN index on `data->'skills'` for structural matches like `data->'skills' @> '[{"name":"Laravel"}]'::jsonb`. |
| 018 | `018_relevancy_scoring.sql` | — | Upwork Relevancy Scoring AI substrate (plan v3.3). Adds `system_settings` key/value table (seeded with `relevancy.classifier_mode='shadow'` and `relevancy.min_score=50`), 3 new columns on `profiles` (`thresholds_overrides JSONB`, `classifier_enabled BOOLEAN DEFAULT TRUE`, `min_score_override INTEGER 0-100 nullable`), `criteria_versions` PRD-version registry (starts empty — Phase 2 seeds v0.2), `relevancy_scores` canonical audit log with v3.3 threshold fields (`effective_decision`, `threshold_flipped`, `min_score_at_decision`, `classifier_mode_at_decision`, `snapshot_id`) + 10 indexes, `relevancy_scores_dlq` dead-letter queue, `manual_job_evaluations` for the Task Card Evaluator, `relevancy_overrides` to capture agent disagreements (calibration source), and `idempotency_keys` 24h replay cache for n8n callbacks. Fully additive — old code keeps working. Rollback in `018_relevancy_scoring_down.sql`. |
| 019 | `019_criteria_versions_v0_2_seed.sql` | — | Phase 2 of v3.3 plan. Seeds `criteria_versions` with PRD v0.2 — the baseline rule set the classifier reads at runtime. Inserts one row with `version='0.2'`, the 11 hard-gate thresholds from PRD §7 (24h freshness, <30 proposals, ≥$25/hr, ≥$1000 client spend, ≥4.0 rating, etc.), and the 13-element `reason_enum` from PRD §6.2 (**typos preserved** to align with existing N/A task data — e.g., "Low Higher rate" not "Low Hourly Rate"). `output_schema` and `prompt_versions` stay NULL until Phase 6 finalizes the Gemini structured-output schema and prompts. Unblocks `relevancy_scores` writes — the FK on `criteria_version` would reject inserts before this seed. Idempotent (`ON CONFLICT (version) DO NOTHING`). |
| 020 | `020_reason_enum_soft_signals.sql` | — | Extends `criteria_versions.reason_enum` for `version='0.2'` from 13 → 16 entries by appending 3 soft-signal labels: `Client already conducting an interview`, `Short term job checks`, `Red flag`. These are NOT new hard gates — the classifier (Mode A prompt on both Gemini + DeepSeek agents in `hi71jhPU8tmq7hEp`) emits them under existing gate contexts so we can observe production volume before deciding whether to formalize as gates 12/13/14. Re-audit after ~2 weeks of live data. Idempotent (existence guard on the first new label). |

## Execution

Migrations run via browser URL (no curl needed):

```
http://157.173.110.62/api/migrate?v={VERSION}&secret=YOUR_CRON_SECRET
```

**Latest migration:**
```
http://157.173.110.62/api/migrate?v=020&secret=YOUR_CRON_SECRET
```

Contabo is the only target. Replace `YOUR_CRON_SECRET` with the actual value from `.env.production`. All migrations are idempotent — safe to re-run.
