# Data Flow & Dashboard Semantics

## Ingestion Flow

1. **Ingestion**: Vollna (Upwork scraper) → n8n (8 per-agent webhooks) → Claude AI proposal → Board task (`POST /api/v1/webhooks/tasks`) + Dashboard event (`POST /api/webhook/n8n`, HMAC verified) → `tasks` + `jobs` tables
2. **Status tracking**: Task Board column move → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` + outcome
3. **Import**: Manual trigger → `POST /api/sync/sheets` → bulk import from Google Sheets
4. **Caching**: Stats endpoints cache results in `stats_cache` table (5-min TTL)

> **ClickUp removed (M8)**: ClickUp webhooks, sync routes, OAuth, API client, and cron job have all been deleted. Job status (`jobs.status`) is now driven entirely by Task Board column moves.

## n8n → Task Board Architecture

The n8n workflow delivers processed jobs to the **Task Board** after AI proposal generation. `Format ClickUp Task` fans out to two parallel Contabo sinks:

```
Format ClickUp Task ┬─► Create Board Task - Self-Hosted    → Contabo POST /api/v1/webhooks/tasks   (Bearer n8n-board-sync, tasks table)
                    └─► Format Dashboard Event ──► Send to Self-Hosted Dashboard  → Contabo POST http://157.173.110.62/api/webhook/n8n
```

There are two writes per event: the Board API (`/api/v1/webhooks/tasks`, populates `tasks` table) and the dashboard webhook (`/api/webhook/n8n`, populates `jobs` table + auto-assigns agent / creates profile / adds `vollna-auto` tag). Both active HTTP nodes use `neverError: true` so a transient blip never breaks the pipeline — but with no parallel target, a Contabo outage now means lost leads (no failover). See PRD TD-10 / TD-5.

The dashboard payload shape preserves `clickup.taskId` / `clickup.taskUrl` as `null` (legacy fields kept for backward compat with the dashboard schema). Outcome detection falls back to `item.taskName && item.proposal → 'proposal_created'` which is already coded in the Format Dashboard Event Code node.

History (n8n workflow snapshots in `docs/*.json` still mention earlier dual-target topology — those are immutable archives. The current live workflow writes Contabo only. ClickUp sinks were removed 2026-04-29 in M8; the dual-Vercel sinks were removed in the same week when the user retired the Vercel deployment).

- **Board API**: `POST /api/v1/webhooks/tasks` with Bearer token auth (`n8n-board-sync`). Falls back to default project.
- **Payload mapping**: Task title = `[profile] Job Title`, description = rich formatted proposal + job snapshot. Job metadata stored in `custom_fields` (`_job_id`, `_job_url`, `_budget`, `_skills`, `_proposal`, `_assigned_agent`, `_profile_name`, `_source`, client data)
- **Task-Job linking**: `custom_fields._job_id` links board tasks to the `jobs` table, enabling the 3-column task detail view (task fields | job details | proposal)
- **Status sync**: When a task moves columns on the board → `moveTaskAction()` → `syncJobStatusFromTask()` → `jobs.status` updated to column name

## Database Tables

**Original tables:** `agents`, `profiles`, `jobs`, `sync_log`, `stats_cache`, `alerts`. Schema in `src/lib/seed.ts` and `src/lib/schema.sql`.

**Task management tables (migration 006):** `workspaces`, `projects`, `project_members`, `columns`, `tasks`, `task_assignees`, `task_tags`, `task_tag_map`, `comments`, `activity_log`, `checklist_items`, `file_attachments`, `webhook_configs`, `webhook_event_log`, `notifications`, `notification_preferences`, `saved_views`, `custom_field_definitions`.

Migrations in `src/lib/migrations/`.

**Proposal feedback (migration 024):** `proposal_feedback` — append-only log of agent feedback on AI-written proposals + regeneration history, doubling as the training corpus. The card's `custom_fields._proposal` holds only the currently-applied text; this table holds the full lineage of `(original_proposal, categories[], note) → regenerated_proposal` triples. Two write paths: `/api/tasks/[id]/proposal-feedback` (feedback-only, `status='feedback'`) and `/api/proposals/regenerate` (calls n8n `proposal-regenerate` webhook, writes `status='regenerated'` + applies the new text to the card via `setTaskProposalText`; records `status='regen_failed'` if n8n is down). Auth reuses `assertCanFlagTaskRelevancy`; regen is rate-limited via `checkProposalRegenRateLimit` (30/hr · 150/day per author). UI: `ProposalFeedbackPanel` under `ProposalBox` in `task-full-view.tsx`. Categories vocabulary: `src/lib/proposal-feedback-reasons.ts`.

## API Conventions

- **Protected routes** check auth via `getServerSession()` or middleware
- **Webhook routes** are public but verify signatures (HMAC SHA256)
- **Cron routes** require `Authorization: Bearer <CRON_SECRET>` header. The Bearer token is bare — do NOT include `Bearer ` inside the secret value, the route handler adds it.
- Stats API responses are cached in DB; server actions call `revalidatePath()` to bust cache

## Relevancy Scores Ingestion (gotchas)

- **`relevancy_scores.total_score` is INTEGER, not NUMERIC.** Some LLMs (DeepSeek r1-distill confirmed 2026-05-18..20) return fractional weighted sums like `82.5`. `insertRelevancyScore` defensively `Math.round()`s the value before insertion (`src/lib/data.ts`). Same applies to `min_score_at_decision`, `input_tokens`, `output_tokens`, `latency_ms` — all INTEGER. Only `confidence` is `numeric(4,3)`.
- **DLQ drain uses Postgres SAVEPOINTs per row.** `drainRelevancyScoresDlq` wraps each `insertRelevancyScore` replay in `SAVEPOINT sp_replay` so a failed replay rolls back to the savepoint, leaving the outer tx healthy for the bookkeeping UPDATE (attempts++/backoff/error_detail). Without this, an aborted replay poisons the whole batch with "current transaction is aborted, commands ignored." Pattern is reusable: any per-row work that calls a function which might throw inside a multi-row transaction should sit inside a savepoint.
- **DLQ payload shape contract.** The DLQ is for **post-verdict audit-log insert failures only** — payloads must conform to `RelevancyScoreInsert` (top-level `decision`, `model`, `prompt_version`, etc.). Parking classifier *inputs* (`{job, profile_context, user_message_json, ...}`) is a misuse — those can never replay through `insertRelevancyScore` and clog the queue. If you see a "junk" cluster in `relevancy_scores_dlq` (rows without a top-level `decision` key), it points to a classifier-side mis-park, not a real ingestion failure.

## Dashboard Count Rules (CRITICAL)

**Dashboard counts derive from the Task Board, not jobs lifecycle milestones.** As of 2026-04-27, `getKPIMetrics`, `getAgentKPIMetrics`, `getPipelineStages`, `getConversionFunnel`, `getEnhancedAgentStats`, and `getEnhancedProfileStats` all count `tasks JOIN columns`, not `jobs.proposal_sent_at IS NOT NULL` style lifecycle milestones. This matches the task board exactly — including manually-created "orphan" tasks that have no job linkage. **Date filter is per-metric** (see funnel section). Agent filter uses `task_assignees`. Profile filter uses the linked job's `profile_id`. Win rate is `won / (won + lost)`. Revenue still comes from `jobs.won_value` (orphan tasks have no won_value).

## Funnel KPIs (CUMULATIVE, HISTORY-ACCURATE, FIRST-ENTRY date-filtered)

As of 2026-04-29, commit `ebe8122`. Every task counts only toward stages it has actually visited per `activity_log`, not by funnel-order assumption. Implementation in `getKPIMetrics`, `getConversionFunnel`, `getPipelineStages`, `getEnhancedAgentStats`, `getEnhancedProfileStats`:

- **Per-metric `move_in_<metric>` CTEs** find `MIN(activity_log.created_at)` of `task_moved` rows where `LOWER(new_value)` is in that metric's funnel-stage set.
- A `task_visited` (or `agent_scoped_tasks` / `profile_scoped_tasks`) CTE computes `first_<metric>_at` per task as `LEAST(move_in_<metric>.first_in, created_at_fallback)` where the fallback fires for tasks that were created already inside the funnel (no `task_moved` history, or earliest move's `old_value` was already in-funnel).
- **Cumulative funnel KPIs date-filter on `first_<metric>_at BETWEEN start AND end`** — i.e. "the card's FIRST entry into this metric's stage-or-later set happened in the range." This is what makes "Proposals Sent today" mean "proposals sent today," not "any task whose status was last touched today."
- **Current-state tiles** (Won, Lost, Bad Leads, Untouched, On Hold, Total Revenue, win rate denominator) keep `LOWER(col_name) = '...'` plus `COALESCE(j.stage_entered_at, t.updated_at, t.created_at) BETWEEN start AND end`.
- **`total_jobs` (Jobs Received)** uses `t.created_at` (intake time).
- **Won-shortcut behavior (intentional):** a Won card has `first_<metric>_at` set for every earlier cumulative tile because `won` is included in every funnel-stage set. So a Submitted→Won card today counts in Proposals Viewed / In Chat / Meetings Booked / Meetings Done for today even though it never visited those columns. This is the cumulative semantic ("reached at-least-this-level"); confirmed desired on 2026-04-29.
- Examples: a Won card moved Proposal Submitted (6 days ago) → Won (today) counts under Proposals Sent for any window covering 6 days ago AND under Won + every cumulative tile for today. A card moved Proposal Submitted (10 days ago) → Meeting Done (yesterday) counts under Meetings Booked + Meetings Done for yesterday's filter, NOT for today's.
- **Caveat:** relies on `activity_log` integrity — `task_moved` entries are written by `moveTaskAction` (`task-data.ts:1027`); any move that bypasses that path (e.g. raw `PATCH /api/tasks/[id]/move`) is invisible to the funnel.

## Response Time to Apply (median, BOTH-halves, drill-down)

As of 2026-06-10. The "Response time to apply" KPI card (`getAvgResponseTime`) is a **median (P50)**, not a mean — backfilled/bounce-back rows left >100h outliers that swung the arithmetic mean. Date window is on `received_at`.

- **Counts BOTH halves of the funnel** so the card can't contradict the Slow Response panel. Sent jobs contribute `proposal_sent_at - received_at`; still-waiting jobs contribute live `NOW() - received_at` via `COALESCE(sent_elapsed, now_elapsed)`. Predicate: `proposal_sent_at IS NOT NULL OR LOWER(status) IN ('to do','todo','new','proposal ready')`.
- **Why:** the old query was `WHERE proposal_sent_at IS NOT NULL` only — survivorship-biased. It saw only the fast jobs that got applied, so it could read "13m typical" while 31 jobs sat unanswered 8–18h in the Slow Response list (those rows have no `proposal_sent_at`, so they were invisible to the median). The two panels measured disjoint populations and could never agree.
- **`n/a` is EXCLUDED** (decision 2026-06-10): bad leads are deliberately never applied to, so they aren't "time to apply." This is the one population difference from `getSlowResponseJobs`, which *does* list `n/a`.
- **Drill-down:** `getResponseTimeJobs` → `/api/dashboard/response-time-jobs` → `ResponseTimeDrillDown` (a SEPARATE path from the count cards' `getKPIMetricTasks`/`KPIMetricDrillDown`, because the median reads `jobs` not the task CTE). It returns the EXACT same job set (same WHERE + same elapsed expr) sorted by elapsed ASC, each row showing per-job wait time, plus a median marker line — so the headline is verifiable by eye. The modal's median is sourced from `getAvgResponseTime` itself (not recomputed from the ≤500-row list) so it can never drift from the card. ⚠ Keep the two functions' predicates in lockstep.

## Connects Efficiency (Most/Least Efficient cards)

As of 2026-06-09. The `/connects` "Most Efficient" / "Least Efficient" cards rank **profiles** by their own `cost_per_win`, not by niche.

- `getConnectsUsageByProfile` returns per-profile `wins` (won tasks that consumed connects, `LOWER(columns.name)='won'`) and `cost_per_win = round(connects_used / wins)`, **`null` when `wins = 0`**. This mirrors `getConnectROIByNiche`'s win convention so the two stay consistent.
- Ranking (in `connects/page.tsx`) only considers profiles with `connects_used > 0`. `cost_per_win = null` (spent connects, won nothing) sorts **last** (treated as `Infinity`) = least efficient; lowest finite `cost_per_win` = most efficient. A profile with no wins is never "most efficient".
- **Gotcha that bit us:** the old code ranked profiles by their *niche's* cost_per_win via `roi.find(...)` and used a `(... ?? Infinity) - (... ?? Infinity)` comparator. `Infinity - Infinity = NaN`, and a NaN-returning sort comparator leaves the array unsorted — so when every niche was winless/unmatched, both `sort(asc)[0]` and `sort(desc)[0]` returned `usage[0]` and the **same profile showed as both most AND least efficient**. The comparator now branches (`sa === sb ? 0 : sa < sb ? -1 : 1`) and a guard ensures `leastEfficient !== mostEfficient`.

## Timezone

**Default timezone is US Eastern** (`-04:00` fixed EDT) as of 2026-04-29. Set in `src/lib/date-utils.ts` (`resolveTZ`) and mirrored in `src/lib/date-presets.ts` (server-safe util consumed by `parseBoardFiltersFromSearchParams` and the date picker). PKT is opt-in via `?tz=pkt`. The fixed offset does NOT auto-handle EST/EDT DST — swap to `Intl.DateTimeFormat` if winter-time off-by-one is reported.

## Agent Pages

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
