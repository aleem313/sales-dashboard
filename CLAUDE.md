# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rising Lions Analytics Dashboard — a real-time analytics platform for Upwork job automation. Tracks proposals, win rates, agent performance, and revenue. Data flows in from n8n webhooks (Upwork jobs), Google Sheets imports, and the internal Task Board system.

> **IMPORTANT**: ClickUp has been fully replaced by the internal Task Board (Milestone 8). The Task Board is the **single source of truth** for job status tracking. Never rely on ClickUp data, APIs, or webhooks. All ClickUp integration code has been removed.

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
```

No test framework is configured. There are no unit/integration tests.

## Deployment

> **2026-04-29 transition note:** The n8n workflow no longer dual-writes to Vercel — only Contabo sinks remain (the two Vercel-targeting nodes `Create Board Task` and `Send to Dashboard` were removed). The Vercel deployment itself may still be running for transition; the user has not yet decided whether to tear it down. See `docs/n8n_workflow_prd.md` §12 for the change record. The two-target description below reflects the **historical** repo deploy targets, not the current n8n write topology.

The app is deployed **to two targets simultaneously** from `main`:

1. **Vercel** (primary) — `https://sales-dashboard-snowy-beta.vercel.app`, backed by Neon Postgres. Git push triggers Vercel's own deploy. Vercel handles cron jobs defined in `vercel.json`.
2. **Contabo self-hosted** — `http://157.173.110.62` on a Ubuntu 24.04 VPS, Docker-native, Postgres 17 in a sibling container. Deployed by `.github/workflows/deploy-contabo.yml` on every push to `main`: SSH → `git reset --hard` → `docker compose --env-file .env.production -f docker-compose.server.yml up -d --build` → healthcheck → done. See `docker/DEPLOY-CONTABO.md` for the runbook.

Historically both deployments received the same n8n webhook traffic via parallel sink nodes in the workflow. As of 2026-04-29 only Contabo receives n8n writes (see "n8n Integration" below). No local dev workflow — all changes must be production-ready.

**CI/CD key files:**
- `.github/workflows/deploy-contabo.yml` — **active** auto-deploy pipeline (push to main)
- `docker-compose.server.yml` — lean HTTP-only compose used on Contabo (no nginx, no SSL)
- `docker-compose.prod.yml` — full nginx+certbot stack, intended for post-domain setup

**Contabo gotchas:**
- Compose variable substitution for postgres needs `--env-file .env.production` on every command
- `Dockerfile.prod` healthcheck uses `127.0.0.1` not `localhost` (BusyBox wget resolves localhost to IPv6 ::1 which Next.js standalone doesn't bind)
- `next.config.ts` has `typescript.ignoreBuildErrors: true` to work around pre-existing strict-mode errors in `src/lib/data.ts`

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Database**: Vercel Postgres (Neon) via `@vercel/postgres` — all queries use **raw SQL** (no ORM)
- **Auth**: NextAuth.js v5 (beta.30) with GitHub OAuth + email/password credentials
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Charts**: Recharts

### Route Groups & Roles

Two user roles control access:
- **`admin`** — full access via `(dashboard)/` route group
- **`agent`** — restricted to `(agent)/` route group (`/my-dashboard`, `/my-pipeline`, `/my-connects`, `/my-analytics`, `/my-jobs`, `/my-performance`, `/my-tasks`)

Middleware (`src/middleware.ts`) enforces auth and redirects agents away from admin routes to `/my-dashboard`.

### Key Files

| File | What it does |
|------|-------------|
| `src/lib/data.ts` | All database queries (~1700 lines of raw SQL) |
| `src/lib/actions.ts` | Server actions (mutations + `revalidatePath`) |
| `src/lib/auth.ts` | NextAuth config, session callbacks, role logic |
| `src/lib/types.ts` | TypeScript interfaces for all entities |
| `src/lib/seed.ts` | Database schema DDL + seed data |
| `src/lib/sheets.ts` | Google Sheets API client |
| `src/lib/alerts.ts` | Alert thresholds + Slack webhook integration |

### Data Flow

1. **Ingestion**: Vollna (Upwork scraper) → n8n (8 per-agent webhooks) → Claude AI proposal → Board task (`POST /api/v1/webhooks/tasks`) + Dashboard event (`POST /api/webhook/n8n`, HMAC verified) → `tasks` + `jobs` tables
2. **Status tracking**: Task Board column move → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` + outcome
3. **Import**: Manual trigger → `POST /api/sync/sheets` → bulk import from Google Sheets
4. **Caching**: Stats endpoints cache results in `stats_cache` table (5-min TTL)

> **ClickUp removed (M8)**: ClickUp webhooks, sync routes, OAuth, API client, and cron job have all been deleted. Job status (`jobs.status`) is now driven entirely by Task Board column moves.

### n8n Integration

- **Instance**: ikonicdev.app.n8n.cloud (v2.42.3)
- **MCP Server**: Connected (21 tools — can create/update/execute workflows)
- **Active workflow**: "multiple webhooks" (EWnZg3svZWwcIRs4) — **35 nodes** as of 2026-05-12 (was 30 pre-Phase 7, +4 Phase 7 splice, +1 bulk-payload guard). 8 Vollna webhooks per agent (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal) → Claude AI proposals → Board task creation → Dashboard webhook. **Phase 7 spliced 2026-05-12**: between Route Job output[0] (the `_result: proceed` branch) and Build GPT Input, 4 new nodes run the relevancy classifier in Shadow mode by default — `IF - Classifier Enabled` (kill-switch on `$env.RELEVANCY_CLASSIFIER_ENABLED`; unset/empty/`'true'` = run, `'false'` = bypass) → `Score Relevancy` (executeWorkflow → `hi71jhPU8tmq7hEp`) → `Route Verdict` (Switch on `effective_decision + request_meta.classifier_mode`) → `End (Audit Only)` (noOp for active-reject / classifier-error paths). Shadow mode means every job is scored and audited but routing is unchanged — the existing AI proposal still drafts. Format ClickUp Task now exposes `relevancyVerdict` top-level on returned items, and Create Board Task - Self-Hosted stamps 15 `_relevancy_*` fields into `custom_fields` (`_relevancy_score`, `_summary`, `_decision`, `_effective`, `_threshold_flipped`, `_reasons`, `_tier`, `_confidence`, `_score_id`, `_dlq_id`, `_evaluated_at`, `_mode_at_decision`, `_model`, `_gates`, `_components`) on every n8n-created Shadow-mode task. `_gates` is an object mapping gate_id (e.g. `1_stack_match`) → `{status: pass|fail|skipped_deterministic, evidence: string}`. `_components` is an object mapping component name (e.g. `skill_match`) → `{value: number, reason: string}` with hardcoded maxes (skill_match=30, portfolio_evidence=20, client_quality=15, competition_position=10, domain_match=10, experience_level_fit=10, red_flags=5). `_relevancy_summary` (added 2026-05-12) carries the LLM's qualitative feedback text for calibration review. `_relevancy_model` (added 2026-05-12) records which LLM produced the verdict (`gemini-2.5-flash` or `deepseek-r1`) so the RelevancyPanel UI can show a "via X" badge. Full PRD: `docs/n8n_workflow_prd.md`.
- **Sub-workflow**: `_relevancy-classifier-core` (hi71jhPU8tmq7hEp) — **ACTIVE as of 2026-05-12** (Phase 7 splice required the sub published first — n8n cloud rejects publishing a parent that references an unpublished sub-workflow via executeWorkflow). Built 2026-05-11. **18 nodes** as of 2026-05-12 afternoon (was 15 before DeepSeek failover): deterministic gate pre-check (JS) + primary LLM call (Gemini 2.5 Flash via OpenRouter) + DeepSeek R1 failover via OpenRouter on Gemini error + threshold application (two twin Validate Output nodes, one per LLM path) + audit-log persist via `/api/relevancy-scores` + DLQ fallback + terminal `Return Verdict` (C12) that reshapes the C10/C11 leaf into a verdict object for `executeWorkflow` callers. Smoke-tested end-to-end on the C0–C10 spine 2026-05-11 (execution 13356: Shayan + synthetic SaaS job → proceed/91/apply_now in 18.2s). Full PRD: `docs/n8n_relevancy_classifier_core_prd.md`. Canonical prompt: `docs/relevancy/mode_a_prompt.md`.
- **Always-emit-score policy (2026-05-12)**: Mode A prompt (both Gemini + DeepSeek agents) ALWAYS computes the 7-component rubric and `total_score`, regardless of decision. The tier is `reject` when `decision=reject` regardless of score. This is intentional — gate-failed jobs still get a numeric score for calibration / threshold-tuning, so downstream dashboards can plot score distributions across all verdicts (not just proceed/review). Before this change, gate-failed paths skipped the rubric and `total_score` was null on rejects. See `docs/job_relevancy_criteria_prd.md` §17 v0.2.2 changelog and `docs/relevancy/mode_a_prompt.md` "DECISION RULES" / "RUBRIC" sections.
- **Reason enum has 16 entries (2026-05-12)**: Migration 020 + Mode A prompt update extended `criteria_versions.reason_enum` for `version='0.2'` from 13 → 16 by appending 3 soft-signal labels — `Client already conducting an interview`, `Short term job checks`, `Red flag`. These are NOT new hard gates; the classifier emits them under existing gate contexts (typically gate 7, 4, or closest) so we can observe production volume before deciding whether to formalize as gates 12/13/14. Re-audit after ~2 weeks of live data. Full list in `docs/job_relevancy_criteria_prd.md` §6.2.
- **Webhook payload**: Nested format with `job`, `client`, `routing`, `scores`, `proposal`, `outcome` fields. Normalized by `/api/webhook/n8n` route.
- **Outcome values received by dashboard**: `proposal_created`, `gpt_error`, `rejected`, `no_profile`, `weekend`, `inactive`, `duplicate`. Computed in `Format Dashboard Event` (fallback: `item.taskName && item.proposal → 'proposal_created'`).
- **Internal `_result` values actually emitted by `Process Job`** (current state, 2026-04-29): only `proceed`, `no_profile`, `rejected`. The `Route Job` Switch has rules for `inactive`, `duplicate`, and `weekend` as well, but those branches are unreachable because `Process Job` never sets those values.
- **n8n credentials for the classifier (2026-05-12 update)**: Classifier's primary LLM is `Gemini 2.5 Flash (OpenRouter)` (lmChatOpenAi, credential `OpenRouter (Relevancy Classifier)` id `hEGZwAd3TT4Sthsf`, base URL `https://openrouter.ai/api/v1`, model `google/gemini-2.5-flash`). Failover LLM is `DeepSeek R1 (OpenRouter)` (credential `OpenRouter (DeepSeek Relevancy Classifier)` id `tRUGc5ZmaiQpZEQP`, same base URL, model `deepseek/deepseek-r1`). Both keys are OpenRouter keys but kept separate for billing/rate-limit isolation. Swapped from `Gemini API (Relevancy Classifier)` (googlePalmApi, id `0gaoWdarY6itka7l`, Google direct) on 2026-05-12 after Google's direct API sustained-rate-limited the classifier (DLQ #87 → #500 in 2hrs, ~95% failure rate). Same underlying Gemini model on primary — Mode A prompt calibration preserved. Old googlePalmApi credential `0gaoWdarY6itka7l` is no longer used by any node but kept in n8n for rollback. `Relevancy Ingest Token (Contabo)` (httpHeaderAuth, id `yXpENDK1cKgFdxp0`) is bound to the classifier's C10/C11 HTTP nodes. The token value lives in `/opt/sales-dashboard/.env.production` as `RELEVANCY_INGEST_TOKEN`.

### n8n → Task Board Architecture

The n8n workflow delivers processed jobs to the **Task Board** after AI proposal generation. As of 2026-04-29, `Format ClickUp Task` fans out to **two** parallel downstreams (Contabo only — see history below):

```
Format ClickUp Task ┬─► Create Board Task - Self-Hosted    → Contabo POST /api/v1/webhooks/tasks   (Bearer n8n-board-sync, tasks table)
                    └─► Format Dashboard Event ──► Send to Self-Hosted Dashboard  → Contabo POST http://157.173.110.62/api/webhook/n8n
```

There are two writes per event: the Board API (`/api/v1/webhooks/tasks`, populates `tasks` table) and the dashboard webhook (`/api/webhook/n8n`, populates `jobs` table + auto-assigns agent / creates profile / adds `vollna-auto` tag). Both active HTTP nodes use `neverError: true` so a transient blip never breaks the pipeline — but with the Vercel parallel retired, a Contabo outage now means lost leads (no failover). See PRD TD-10 / TD-5.

The dashboard payload shape preserves `clickup.taskId` / `clickup.taskUrl` as `null` (legacy fields kept for backward compat with the dashboard schema). Outcome detection falls back to `item.taskName && item.proposal → 'proposal_created'` which is already coded in the Format Dashboard Event Code node.

History: the legacy `Create ClickUp Task` sink was removed on 2026-04-29 (TD-7) — ClickUp had been killed in M8 and the sink was dead weight. The two Vercel-targeting sinks (`Create Board Task` and `Send to Dashboard`) were also removed on 2026-04-29 — the user retired the Vercel deployment and consolidated writes on Contabo. `Process Job`'s profile-mapping fetch still has Vercel as a fallback URL pending a separate decision (PRD §13).

- **Board API**: `POST /api/v1/webhooks/tasks` with Bearer token auth (`n8n-board-sync`). Falls back to default project.
- **Payload mapping**: Task title = `[profile] Job Title`, description = rich formatted proposal + job snapshot. Job metadata stored in `custom_fields` (`_job_id`, `_job_url`, `_budget`, `_skills`, `_proposal`, `_assigned_agent`, `_profile_name`, `_source`, client data)
- **Task-Job linking**: `custom_fields._job_id` links board tasks to the `jobs` table, enabling the 3-column task detail view (task fields | job details | proposal)
- **Status sync**: When a task moves columns on the board → `moveTaskAction()` → `syncJobStatusFromTask()` → `jobs.status` updated to column name

### Database Tables

**Original tables:** `agents`, `profiles`, `jobs`, `sync_log`, `stats_cache`, `alerts`. Schema in `src/lib/seed.ts` and `src/lib/schema.sql`.

**Task management tables (migration 006):** `workspaces`, `projects`, `project_members`, `columns`, `tasks`, `task_assignees`, `task_tags`, `task_tag_map`, `comments`, `activity_log`, `checklist_items`, `file_attachments`, `webhook_configs`, `webhook_event_log`, `notifications`, `notification_preferences`, `saved_views`, `custom_field_definitions`.

Migrations in `src/lib/migrations/`.

### API Conventions

- **Protected routes** check auth via `getServerSession()` or middleware
- **Webhook routes** are public but verify signatures (HMAC SHA256)
- **Cron routes** require `Authorization: Bearer <CRON_SECRET>` header
- Stats API responses are cached in DB; server actions call `revalidatePath()` to bust cache

## Code Patterns

- **No ORM** — write raw SQL with `sql` tagged template from `@vercel/postgres`
- **Server components by default** — pages fetch data with async/await at the component level
- **`"use client"` only when needed** — for interactivity, charts, or browser APIs
- **Path alias**: `@/*` maps to `./src/*`
- **URL state for filters** — job filters are stored in URL search params, not React state
- **Server actions for mutations** — all writes go through `src/lib/actions.ts`, which revalidates paths after changes
- **Smart polling** — `<AutoRefresh interval={N} />` component calls `router.refresh()` on a timer. 5s for task boards, 15s for dashboards. Pauses when tab is hidden. No WebSockets needed.

### Agent Pages

Agents have full dashboard access scoped to their own data. All agent pages force `agentId = session.user.agentId` at the server component level — no query param override possible.

| Agent Route | Mirrors Admin Route | Data Scope |
|-------------|-------------------|------------|
| `/my-dashboard` | `/dashboard` | Own KPIs, funnel, pipeline, recent jobs |
| `/my-pipeline` | `/pipeline` | Own pipeline stages + active jobs |
| `/my-connects` | `/connects` | Own connects usage, ROI, filter quality |
| `/my-analytics` | `/analytics` | Own proposal models, geography, timing, budget |
| `/my-performance` | — | Own win rate trends, response time |
| `/my-jobs` | `/jobs` | Own job list |
| `/my-tasks` | `/tasks` | Assigned boards only |

## Migration Version History

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

## Migration Execution

Migrations run via browser URL (no curl needed):

```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v={VERSION}&secret=YOUR_CRON_SECRET
```

**Latest migration:**
```
http://157.173.110.62/api/migrate?v=020&secret=YOUR_CRON_SECRET
```

Vercel is decommissioned (2026-04-29) — Contabo is the only target. Earlier migrations were dual-target.

Replace `YOUR_CRON_SECRET` with the actual value from Vercel Environment Variables. All migrations are idempotent — safe to re-run.

## Task Management API Routes (Milestone 1)

| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/tasks` | Agent+ |
| GET/PATCH/DELETE | `/api/tasks/[id]` | Agent+ / Admin |
| PATCH | `/api/tasks/[id]/move` | Agent+ |
| GET/POST | `/api/tasks/[id]/comments` | Agent+ |
| PATCH/DELETE | `/api/tasks/[id]/comments/[cid]` | Author (60min) / Admin |
| GET | `/api/tasks/[id]/activity` | Agent+ |
| GET/POST | `/api/projects/[id]/columns` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/columns/[cid]` | Admin |
| PATCH | `/api/projects/[id]/columns/reorder` | Admin |
| POST | `/api/v1/webhooks/tasks` | API Key (Bearer) |
| GET/POST | `/api/projects/[id]/custom-fields` | Member+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| PATCH | `/api/projects/[id]/custom-fields/reorder` | Admin |
| GET/POST | `/api/projects/[id]/saved-views` | Member+ / Admin |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Admin |
| GET | `/api/migrate` | CRON_SECRET |
| PUT | `/api/agents/[id]/assign-profiles` | Admin |
| GET/POST | `/api/profiles/[id]/upwork-snapshot` | GET: Admin or owner-agent / POST: Admin |

### Agent & Profile Management

- **Agent creation**: Admin creates agent via Settings → "Create Agent". Email + random password are auto-generated. Password is hashed with PBKDF2-SHA256 (100k iterations, 16-byte salt, 64-byte key = 128 hex chars). Stored as `salt:hash` in `password_hash` column (TEXT). Plain password shown once in a modal with copy button — never stored.
- **Profile creation**: Admin creates profile via Settings → "Create Profile". Fields: name, unique identifier (used in n8n routing), platform (Upwork/Freelancer/Fiverr/LinkedIn/Other), stack, assigned agent.
- **Agent ↔ Profile assignment**: One agent → many profiles. One profile → only one agent (enforced). Reassignment removes profile from previous agent with confirmation dialog.
- **Bulk assignment**: `PUT /api/agents/[id]/assign-profiles` with `{ profileIds: string[] }` — unassigns profiles not in list, assigns new ones.
- **Dynamic n8n sync**: `GET /api/profiles/mapping` returns profile→agent mapping (`force-dynamic`, no cache). n8n "Process Job" node fetches this via `this.helpers.httpRequest()` on every execution. Admin changes to assignments are reflected in n8n immediately on next job. **Since 2026-05-12** the response also includes a nested `upwork: { title, top_rated_status, hourly_rate, rating, total_jobs, total_hours, last_worked_on, skills_summary, bio, portfolio[3] }` object per profile when an `upwork_profile_snapshots_current` row exists. Process Job propagates this field through to Build GPT Input, which formats a rich `=== FREELANCER PROFILE ===` block into Claude's prompt (title, track record, skills, bio, portfolio highlights). Profiles with no snapshot (currently Laiba) get `upwork: null` and Build GPT Input falls back to the old "Stack Focus + agent" shape.
- **n8n webhook auto-provisioning**: `POST /api/profiles/sync-n8n` creates webhook + respond nodes in n8n workflow when a new profile is created. Requires `N8N_API_URL` + `N8N_API_KEY` env vars.
- **Webhook URL display**: Settings profile table shows auto-generated webhook URL per profile with copy button (format: `https://ikonicdev.app.n8n.cloud/webhook/<slug>-profile-webhook`).
- **Non-proposal outcome handling**: Dashboard webhook (`/api/webhook/n8n`) gracefully skips non-proposal outcomes (no_profile, rejected, weekend, inactive, duplicate) instead of failing with "Missing job_id".
- **Password hashing**: `hashPassword()` in `actions.ts` uses PBKDF2-SHA256. Format: `<32-hex-salt>:<128-hex-hash>`. Verified by `verifyPassword()` in `auth.ts`.

### n8n Integration Gotchas (CRITICAL)

- **No `fetch()` in Code nodes** — n8n Code nodes run in a sandbox. Use `this.helpers.httpRequest()` instead.
- **Merge node must stay on v3.2** — v3.2 gracefully handles partial inputs (one webhook fires, others ignored); v3 passes through on ANY input causing parallel downstream execution and OOM crashes. Do NOT downgrade to v3.
- **Merge `numberInputs` must equal webhook count** — currently 8 (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal).
- **Each Respond node feeds a unique Merge input index** — Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6, Nawal=7. `Merge All Webhooks` has `numberInputs: 8`. Restored on 2026-04-29 via `n8n_update_partial_workflow` (12 ops: remove + re-add for 6 Respond nodes) after a regression in which 7 of 8 Respond nodes had collided on input `0`. Verified live by Vollna firing test jobs that landed on the Task Board correctly. **Do not change this** — Merge v3.2 only guarantees per-agent isolation when each agent has its own dedicated input.
- **`Check Active Hours` node has been REMOVED (2026-04-29)** — the workflow no longer enforces a business-hours / weekend gate. All Vollna webhook events flow `Merge All Webhooks → Process Job` directly, regardless of day or time. Vollna is the gating mechanism: agents pause/resume their own feeds outside working hours. If a future requirement needs business-hours filtering, splice a fresh Code node between `Merge All Webhooks` and `Process Job` — do not look for the old node, it isn't there.
- **Parallel dashboard sinks** — `Format Dashboard Event` fans out to `Send to Dashboard` (Vercel) AND `Send to Self-Hosted Dashboard` (Contabo `157.173.110.62`) in parallel. Both use `neverError: true`. When editing the Format Dashboard Event code, verify both sinks receive the same shape.
- **Structured Output Parser ↔ Gemini Flash 2.5 is broken on this n8n cloud version (2026-05-11)** — three attempts to wire `@n8n/n8n-nodes-langchain.outputParserStructured` (v1.3) to an AI Agent v3.1 using Gemini Flash 2.5 (typeVersion 1) all failed at SCHEMA-INIT time (executionTime 8ms, error "Error in sub-node Structured Output Parser") REGARDLESS of schema shape (`additionalProperties`, explicit keys, `schemaType: 'fromJson'`). **Workaround**: set `hasOutputParser: false`, let Gemini emit raw text, JSON.parse it in a downstream Code node with try/catch fallback. See `docs/n8n_relevancy_classifier_core_prd.md` TD-2.
- **n8n's expression engine on this cloud version does NOT support optional chaining (`?.`)** — flagged on `={{ JSON.stringify({ x: $json.error?.message }) }}`. Use `($json.error && $json.error.message) || 'unknown'` instead.
- **Gemini Flash 2.5 (lmChatGoogleGemini) is at typeVersion 1 on this n8n cloud** — v1.1 is the MCP-recommended latest but is not installed; setting typeVersion 1.1 produces "Install this node to use it" in the n8n UI. Stick with v1 until n8n cloud upgrades.
- **n8n langchain sub-node retry config (`ai_languageModel`, `ai_outputParser`) is structurally IGNORED when the parent AI Agent has `onError: "continueErrorOutput"`** (2026-05-12 update — supersedes earlier same-day note). Sub-nodes don't run as main-flow nodes; they're invoked by the AI Agent. When Gemini errors, the AI Agent CATCHES it and routes via main[1] error output — the agent itself reports `success`, so no retry boundary engages anywhere. Confirmed via classifier sub-execution 13399: `retryOnFail: true, maxTries: 3, waitBetweenTries: 2500` on Gemini Flash 2.5 was set, but execution completed in 1271ms (single try, no retries) when Gemini 503'd. **Correct pattern**: put retry config on the AI Agent node itself (top-level `retryOnFail`/`maxTries`/`waitBetweenTries`). n8n's documented behavior: retries fire BEFORE the `onError: continueErrorOutput` path engages, so keeping `continueErrorOutput` on the AI Agent gives you both retries AND a DLQ fallback after retries exhaust. Currently applied to `hi71jhPU8tmq7hEp` AI Agent `c5-ai-agent`: **3 tries, 2.5s back-off** (worst-case +5s on the 8–20s classifier budget). Note: a 5×5s experiment was tried on 2026-05-12 to absorb sustained Gemini 429 bursts but was reverted same-day after observing it made each call take ~22s under rate-limit conditions, which backed up n8n's serial queue 10+ minutes deep under load (exec 13433 with 466 jobs amplified the cascade). Conclusion: in Shadow mode a higher DLQ rate is cheaper than a slower queue. Don't re-bump retry without also throttling upstream (Vollna batch size, profile concurrency, etc). The Gemini sub-node's retry fields are now `false/1/0` (dead config stripped).
- **n8n cloud doesn't expose custom env vars on this plan tier** — `$env.MY_VAR` resolves to `undefined`. Workarounds: (a) inline the value into the node parameter (chosen for the classifier's ~30KB system prompt); (b) use n8n cloud Variables (Enterprise tier feature, not available here).
- **`executeWorkflowTrigger` cannot be triggered externally** via the n8n MCP's `n8n_test_workflow` (which only supports webhook/form/chat triggers). To test the classifier sub-workflow, pin mock data on the Execute Workflow Trigger node and click "Execute Workflow" in the n8n UI.
- **n8n IF v2.3 strict-mode + `={{ }}` boolean expressions silently fail** — the template interpolation stringifies the expression result. With `parameters.conditions.options.typeValidation: "strict"` and a `boolean.true` / `boolean.false` operator, the stringified value fails the strict type check → **the false branch always fires regardless of the expression's actual value**. Workarounds: (a) use a string-typed operator (e.g. `string.notEquals "false"`) and let `leftValue` be the raw env-var interpolation `={{ $env.MY_FLAG || 'true' }}`; (b) set `typeValidation: "loose"` if you must keep boolean operators with template expressions. Discovered via execution 13375 (Phase 7 K1 patch, 2026-05-12) — K1 was bypassing the classifier 100% of the time.
- **n8n's `executeWorkflow` node replaces the input item with the sub-workflow's output** — downstream Code/Set/IF nodes that previously read `$input.item.json` must switch to `$('UpstreamNode').item.json` (paired-item-aware) to access the original payload. Bit us on 2026-05-12 in `Build GPT Input` post-Phase-7-splice: `$input.item.json` resolved to `Score Relevancy`'s verdict object (`{decision, effective_decision, ...}`) instead of the Process Job payload, throwing `Cannot read properties of undefined (reading 'budget')`. Discovered via execution 13379 (Khansa profile, classifier hit DLQ fallback). Fix: read from `$('Route Job').item.json` since Route Job is the common upstream of all four K1/K3 branches into Build GPT Input.
- **Bulk-payload guard rejects Vollna POSTs >5 jobs (2026-05-12)** — `Guard - Reject Bulk Payloads` Code node sits between `Merge All Webhooks` and `Process Job` in `EWnZg3svZWwcIRs4`. Throws an error if a single webhook payload has `max(body.total, body.projects.length) > 5`. Background: Vollna's Rebekah filter delivered 466 jobs in one POST on 2026-05-12 (exec 13433), `Process Job` iterated and each item fired Gemini sub-workflow serially — at ~22s/call under rate-limit, the execution had 2.5+ hours of runway and saturated Gemini's API which cascaded to all other agents. Guard short-circuits the iteration. Threshold lives as inline literal `BULK_THRESHOLD = 5` in the Code node — edit there if you need to retune. Vollna already got 200 OK from `Respond - X` upstream, so the throw doesn't reach Vollna and it won't retry. Halted executions appear red in the n8n executions list with a clear error message.
- **Claude (AI Agent - Proposal Writer) MUST NEVER refuse a job (2026-05-12)** — rejection decisions belong solely to the relevancy classifier (Shadow now, Active later), not the proposal writer. Pre-fix, Claude would self-refuse wrong-stack jobs and emit `_proposalOk: false` (treating the parser's `_proposalOk` field as a fit gate per its description "Whether the proposal was successfully generated"), which routed via `Proposal OK?` → Extract Error → dashboard `outcome: gpt_error`, and NO board card was created — the rejection was invisible to the Task Board and the upcoming Relevancy Audit page. Example: exec 13406 (Saim + Smartsheet job). Fix applied: (a) prepended a `CRITICAL — ALWAYS DRAFT, NEVER REFUSE` block to `AI Agent - Proposal Writer.parameters.options.systemMessage`; (b) re-described the parser's `_proposalOk` field as "ALWAYS true. This is not a fit gate." If you ever edit the proposal-writer prompt or its parser schema, preserve both — Claude flips back to refusing instantly if the explicit instructions are removed.

### Adding a New Profile/Webhook Node to n8n

When creating a new agent profile webhook in n8n workflow `EWnZg3svZWwcIRs4`, use this blueprint:

**Step 1:** Use `mcp__n8n-mcp__n8n_update_partial_workflow` with these 5 operations:

```
1. addNode: Webhook - {Name}
   - type: n8n-nodes-base.webhook, typeVersion: 2.1
   - parameters: { httpMethod: "POST", path: "{lowercase-name}-profile-webhook", responseMode: "responseNode", options: {} }
   - onError: continueRegularOutput
   - position: [-1408, {previous_y + 224}]  (Rebekah=1136, Nawal=1360, next=1584)

2. addNode: Respond - {Name}
   - type: n8n-nodes-base.respondToWebhook, typeVersion: 1.1
   - parameters: { options: {} }
   - position: [-1216, {same_y_as_webhook}]

3. addConnection: source="Webhook - {Name}", target="Respond - {Name}"

4. addConnection: source="Respond - {Name}", target="Merge All Webhooks", targetIndex={next_index}
   (Current indices: Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6, Nawal=7 → next=8)

5. updateNode: nodeName="Merge All Webhooks", updates: { "parameters.numberInputs": {current + 1} }
   (Currently 8 → next would be 9)
```

**Webhook URL format:** `https://ikonicdev.app.n8n.cloud/webhook/{lowercase-name}-profile-webhook`

**After adding:** Update this section's index list and `numberInputs` count. Also create the profile in dashboard Settings.

### Task Management Key Files

| File | What it does |
|------|-------------|
| `src/lib/task-data.ts` | All task management queries. `getDefaultProject()` auto-creates workspace/project/columns if seed was skipped. Board CRUD, member management, cross-board queries. |
| `src/lib/task-actions.ts` | Server actions: task CRUD, board CRUD, member management + revalidatePath |
| `src/components/tasks/board-header.tsx` | Board toolbar: selector, member avatars, members panel, new task button, rename/delete menu (admin) |
| `src/components/tasks/board-view.tsx` | Horizontal scrolling kanban board; groups tasks by column; per-column "+" button |
| `src/components/tasks/board-column.tsx` | Column with header (color dot, name, WIP count), task cards, empty state |
| `src/components/tasks/task-card.tsx` | Task card: priority badge, assignee avatars, due date, tags, checklist %, counts |
| `src/components/tasks/task-detail-modal.tsx` | Dialog overlay for task detail view — opens on card click instead of navigating |
| `src/components/tasks/task-create-modal.tsx` | Task creation form (title, column, priority, due date, description); supports external trigger from column "+" |
| `src/components/tasks/board-selector.tsx` | Board dropdown with task counts + "New Board" (admin) |
| `src/components/tasks/board-create-dialog.tsx` | Create board dialog (name + description) |
| `src/components/tasks/board-members-panel.tsx` | Slide-out sheet: member list, add/remove/role-change |
| `src/components/tasks/custom-field-renderer.tsx` | Type-specific renderers for 6 field types + compact card display |
| `src/components/tasks/custom-fields-panel.tsx` | Admin slide-out sheet for field CRUD, archive/restore, reorder |
| `src/components/tasks/group-selector.tsx` | Group-by dropdown (status/assignee/priority/label) |
| `src/components/tasks/views-dropdown.tsx` | Saved views popover: load, save, delete |
| `src/components/tasks/custom-field-filter.tsx` | "More Filters" section for custom field conditions |
| `src/app/(dashboard)/tasks/page.tsx` | Admin board page — loads board by `?board=` param, falls back to first/default |
| `src/app/(agent)/my-tasks/page.tsx` | Agent board page — shows first assigned board + cross-board task summary |

### Known Patterns & Gotchas

- **Admin auth**: Admins log in via `ADMIN_CREDENTIALS` env var — they do NOT have a row in `agents` table. Code that queries `agents WHERE role = 'admin'` may find nothing.
- **Agent sidebar detection**: `useNavSections()` uses `pathname.startsWith("/my-")` to show agent nav. All agent routes MUST start with `/my-`.
- **Agent layout**: `(agent)/layout.tsx` renders `<Sidebar>` only. Each agent page includes `<Header title="..." hideFilters />` individually — this shows the top navbar (date picker, theme toggle, user info) without agent/profile filter dropdowns.
- **Auto-seed**: `getDefaultProject()` auto-creates default workspace + project + columns on first access if tables exist but are empty.
- **Board switching**: Admin uses `?board=<id>` URL param + localStorage; agent currently sees only first assigned board (FN-1 audit item).
- **Task creation**: Modal supports external trigger via `triggerOpen` prop + `defaultColumnId` for per-column "+" buttons.
- **Task detail**: Card click opens a modal overlay (`TaskDetailModal`) instead of navigating to `/tasks/[id]`. Direct URL `/tasks/[id]` redirects to `/tasks?task=[id]` which auto-opens the modal.
- **Task create**: "New Task" and column "+" open a full-width create modal with all fields (same layout as detail view).
- **Webhook auto-assignment**: When `_source === "n8n"`, the webhook auto-assigns agent (by name lookup), sets 24h due date, and creates profile + `vollna-auto` tags.
- **Structured fields**: Both create and detail views show editable Job Snapshot (link, budget, skills, posted), Client Intel (location, rating, spent, hires), Routing Info (agent, profile, stack, job ID, generated), and Proposal — all stored in `custom_fields`.
- **Agent header**: All agent pages use `<Header title="..." hideFilters />` — shows date picker, theme toggle, user info, logout. No agent/profile filter dropdowns since data is session-scoped.
- **Member removal**: Uses browser `confirm()` instead of styled dialog (UX-5 audit item); auto-unassigns from tasks.
- **Job-Task status sync**: When a task moves columns → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` to column name. This is the ONLY way job statuses change now.
- **`jobs.status`**: Renamed from `clickup_status` (migration 012). Same values, same queries. Historical data preserved.
- **Legacy ClickUp columns**: `clickup_task_id`, `clickup_task_url` still exist as nullable columns for historical data. Never write to them for new jobs.
- **Connects canonical storage**: `tasks.custom_fields._connects_used` (base spend) and `tasks.custom_fields._boosted_connects` (separate boost amount). Set on every card type — n8n and manual — by the same UI inputs in `task-create-full.tsx`, `task-full-view.tsx`, and `task-detail-drawer.tsx`. `jobs.connects_used` from migration 004 is unused — never read or write. All three connects queries in `data.ts` (`getConnectsUsageByProfile`, `getBoostedConnectsSummary`, `getConnectROIByNiche`) are task-driven, LEFT JOIN to jobs, and date-gated by `COALESCE(j.stage_entered_at, t.created_at)`. `_boosted_connects` is **not** added into the base "Total Used" total — it's surfaced as its own KPI tile from `getBoostedConnectsSummary.totalBoosted`. Manual cards with no `_job_id` and no profile-name task tag aren't attributable to a profile/niche, so they're excluded from `getConnectsUsageByProfile` and aggregated under `'Unspecified'` in `getConnectROIByNiche`; their connects still contribute to `getBoostedConnectsSummary.totalConnectsUsed`.
- **Connects purchase ledger** (migration 016): per-profile budget on the `/connects` and `/my-connects` bars now comes from `SUM(connects_purchases.connects_count)` for that profile, date-bounded by the same range as usage. Entered via `<ConnectsPurchaseForm>` (`src/components/connects/connects-purchase-form.tsx`) on both pages. Auth: agents can ADD only to their own profiles (server-side check in `addConnectsPurchaseAction` against `profiles.agent_id = session.user.agentId`); **only admins can DELETE** any row (`deleteConnectsPurchaseAction` rejects non-admin). Agents have no delete UI. `profiles.connects_budget` is **legacy/unused** post-migration 016 — never read, never written; keep it on the table only so rollback is possible. The hardcoded `150` fallback in `getConnectsUsageByProfile` is gone — a profile with usage but no logged purchases now shows `X used / 0 total` (visible flag that someone forgot to log a purchase). The "Connects Purchased" and "Spend ($)" StatCards on both pages read from `getConnectsBudgetSummary`.
- **Card N/A reason dropdown lives in two REASON_OPTIONS arrays** — `src/components/tasks/task-full-view.tsx` (card detail editor) and `src/components/tasks/custom-field-filter.tsx` (board filter UI). These are NOT auto-derived from `criteria_versions.reason_enum` or from the classifier — they are hardcoded TypeScript literals. **KEEP IN SYNC MANUALLY** with the 16-element classifier reason enum (Mode A prompt + PRD §6.2 + migration 020). When you add/rename a reason, edit all 4 sources: (1) migration SQL, (2) `docs/job_relevancy_criteria_prd.md` §6.2 + Appendix C, (3) `docs/relevancy/mode_a_prompt.md` enum + both AI Agent system messages in n8n sub-workflow `hi71jhPU8tmq7hEp`, (4) both `REASON_OPTIONS` arrays in the two dashboard components. Last sync: 2026-05-12 commit `34d3ae9`.
- **Upwork profile snapshots** (migration 017): rich freelancer-profile JSON (output of `docs/profiles/extract-profile.js`) lives in `upwork_profile_snapshots`, **append-only**. The latest row per `profile_id` has `is_current = TRUE`; older rows are preserved with `is_current = FALSE` so historical evaluation work (classifier calibration, retrospective scoring) can query past profile state. **Default read path is the `upwork_profile_snapshots_current` view** — it filters to `is_current = TRUE` so day-to-day queries feel like a single-snapshot table. The view is what `getUpworkProfileSnapshot(profileId)` reads; `getUpworkProfileSnapshotHistory(profileId, limit)` reads the base table. Write path is the data-layer function `saveUpworkProfileSnapshot(profileId, json)` (in `src/lib/data.ts`) — a single CTE-INSERT statement that demotes the previous current row and inserts the new one atomically. The partial unique index `uq_upwork_snapshot_current_per_profile` enforces the "exactly one current row per profile" invariant at the DB level. The server action `saveUpworkProfileSnapshotAction` wraps it with admin/agent auth (admin can save any profile; agent can save only their own assigned profiles). Auth split: GET API readable by admin OR profile-owner agent; POST API admin-only. UI: `<ProfileUpworkSnapshotSheet>` drawer mounted in the Settings profile table — Current/History/Upload tabs, Upload tab visible to admin only. CLI: `node --import tsx scripts/import-upwork-profile.ts --profile-id <slug> --json <path>` for bulk imports (skips the auth wrapper, calls the data-layer function directly). `skills_summary` is a real TEXT column populated on insert (`json.skills.map(s => s.name).join(", ")`) — `pg_trgm` GIN index supports `ILIKE '%Laravel%'` queries; `data->'skills'` GIN index supports structural matches like `data->'skills' @> '[{"name":"Laravel"}]'::jsonb`. Both indexes are partial (`WHERE is_current = TRUE`) so historical rows don't bloat them.

### ClickUp Removal (IMPORTANT — for AI/dev agents)

ClickUp integration has been **fully removed** as of Milestone 8. The following no longer exist:

| Removed | Was |
|---------|-----|
| `src/lib/clickup.ts` | ClickUp API client |
| `src/app/api/webhook/clickup/` | ClickUp webhook handler |
| `src/app/api/sync/clickup/` | ClickUp sync endpoint |
| `src/app/api/auth/clickup/` | ClickUp OAuth routes |
| ClickUp cron in `vercel.json` | Daily sync at 00:00 UTC |
| `triggerClickUpSync()` | Server action |
| `triggerClickUpFullSync()` | Server action |

**Rules for future development:**
1. **Never** add ClickUp API calls, webhooks, or sync logic
2. **Never** rely on `clickup_task_id` or `clickup_task_url` for new features — they are legacy
3. **Always** use Task Board as the source of truth for job status
4. Job status changes happen ONLY via Task Board column moves (`moveTaskAction` → `syncJobStatusFromTask`)
5. The `jobs.status` column contains the same values as board column names (e.g., "Proposal Submitted", "In Chat", "Won", "Lost")
6. **Board columns** (14 total): Todo, Proposal Submitted, Proposal Views, Prototype Required, Prototype Done, Prototype Submitted, In Chat, Meeting Scheduled, Meeting Done, Negotiation, Lost, On Hold, N/A, Won
7. **Pipeline Now grouping**: Todo | In Progress (Proposal Submitted, Proposal Views, Prototype Required/Done/Submitted, In Chat, On Hold) | Meetings (Meeting Scheduled/Done) | Negotiation
8. KPI calculations in `data.ts` depend on these exact status strings — if board columns are renamed, update the KPI queries
9. **Dashboard counts derive from the Task Board, not jobs lifecycle milestones.** As of 2026-04-27, `getKPIMetrics`, `getAgentKPIMetrics`, `getPipelineStages`, `getConversionFunnel`, `getEnhancedAgentStats`, and `getEnhancedProfileStats` all count `tasks JOIN columns`, not `jobs.proposal_sent_at IS NOT NULL` style lifecycle milestones. This matches the task board exactly — including manually-created "orphan" tasks that have no job linkage. **Date filter is per-metric** (see rule #10). Agent filter uses `task_assignees`. Profile filter uses the linked job's `profile_id`. Win rate is `won / (won + lost)`. Revenue still comes from `jobs.won_value` (orphan tasks have no won_value).
10. **Funnel KPIs are CUMULATIVE, HISTORY-ACCURATE, and FIRST-ENTRY date-filtered** (as of 2026-04-29, commit `ebe8122`). Every task counts only toward stages it has actually visited per `activity_log`, not by funnel-order assumption. Implementation in `getKPIMetrics`, `getConversionFunnel`, `getPipelineStages`, `getEnhancedAgentStats`, `getEnhancedProfileStats`:
    - **Per-metric `move_in_<metric>` CTEs** find `MIN(activity_log.created_at)` of `task_moved` rows where `LOWER(new_value)` is in that metric's funnel-stage set.
    - A `task_visited` (or `agent_scoped_tasks` / `profile_scoped_tasks`) CTE computes `first_<metric>_at` per task as `LEAST(move_in_<metric>.first_in, created_at_fallback)` where the fallback fires for tasks that were created already inside the funnel (no `task_moved` history, or earliest move's `old_value` was already in-funnel).
    - **Cumulative funnel KPIs date-filter on `first_<metric>_at BETWEEN start AND end`** — i.e. "the card's FIRST entry into this metric's stage-or-later set happened in the range." This is what makes "Proposals Sent today" mean "proposals sent today," not "any task whose status was last touched today."
    - **Current-state tiles** (Won, Lost, Bad Leads, Untouched, On Hold, Total Revenue, win rate denominator) keep `LOWER(col_name) = '...'` plus `COALESCE(j.stage_entered_at, t.updated_at, t.created_at) BETWEEN start AND end`.
    - **`total_jobs` (Jobs Received)** uses `t.created_at` (intake time).
    - **Won-shortcut behavior (intentional):** a Won card has `first_<metric>_at` set for every earlier cumulative tile because `won` is included in every funnel-stage set. So a Submitted→Won card today counts in Proposals Viewed / In Chat / Meetings Booked / Meetings Done for today even though it never visited those columns. This is the cumulative semantic ("reached at-least-this-level"); confirmed desired on 2026-04-29.
    - Examples: a Won card moved Proposal Submitted (6 days ago) → Won (today) counts under Proposals Sent for any window covering 6 days ago AND under Won + every cumulative tile for today. A card moved Proposal Submitted (10 days ago) → Meeting Done (yesterday) counts under Meetings Booked + Meetings Done for yesterday's filter, NOT for today's.
    - **Caveat:** relies on `activity_log` integrity — `task_moved` entries are written by `moveTaskAction` (`task-data.ts:1027`); any move that bypasses that path (e.g. raw `PATCH /api/tasks/[id]/move`) is invisible to the funnel.
11. **Default timezone is US Eastern** (`-04:00` fixed EDT) as of 2026-04-29. Set in `src/lib/date-utils.ts` (`resolveTZ`) and mirrored in `src/lib/date-presets.ts` (server-safe util consumed by `parseBoardFiltersFromSearchParams` and the date picker). PKT is opt-in via `?tz=pkt`. The fixed offset does NOT auto-handle EST/EDT DST — swap to `Intl.DateTimeFormat` if winter-time off-by-one is reported.

## Key Reference Files

| File | Purpose |
|------|---------|
| `docs/plan.md` | Execution plan with milestones and checklists |
| `docs/cline.md` | Project history, progress tracking, resume instructions |
| `docs/task_board_cases.md` | All cases, subcases & edge cases for Task Board (3 levels deep) — dev scoping and QA |
| `docs/task_board_ui_audit.md` | UI component audit: 12 components, issues (P0/P1/P2), role matrix, recommended fixes |
| `docs/agent-guide/AGENT_USER_GUIDE.md` | End-user guide for agents — features, stats, lifecycle, common misunderstandings |

## Conversation Continuity

**Always read `docs/cline.md` first** in every new conversation. It contains:
- Full project history and decisions
- Milestone progress tracking
- What's been built and what's next
- Tech stack decisions and rationale

Update `docs/cline.md` after completing each feature (status table + detail section).

Execution plan lives in `docs/plan.md` (v3.1, ClickUp removal). Mark items `[x]` as they're completed.

## Git Commits

Do not add `Co-Authored-By` lines to commit messages.
