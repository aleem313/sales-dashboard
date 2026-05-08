# Upwork Relevancy Scoring AI — Build Plan **v3.2**

**Status:** Engineering-ready · 2026-05-08
**Supersedes:** v3.1 (2026-05-07), v3 (2026-05-06), `upwork-relevancy-scoring-ai-plan-v2.md` (2026-05-06), v1
**Source PRD:** `job_relevancy_criteria_prd.md` v0.2
**Stack:** existing `upwork_profile_snapshots` (migration 017 — already shipped) + `tasks.custom_fields` (Vollna→n8n→Task Board) → n8n classifier sub-workflow → Gemini Flash 2.5 → Postgres (Contabo) + Next.js admin dashboard
**Stable n8n backup:** [`docs/multiple webhooks (07-05-2026 working).json`](./multiple%20webhooks%20%2807-05-2026%20working%29.json) — see [§14 Rollback Strategy](#14-rollback-strategy)

**v3.2 architectural pivot vs v3.1.** The v3.1 plan was Apify-heavy: it scraped Upwork profiles via a managed actor, scraped job pages on demand, and built four n8n workflows (one of which was a daily cron sync). That entire scraping layer is **removed** in v3.2 because the data already exists in our system:

- **Profile data is already in `upwork_profile_snapshots`** (migration 017, shipped). Snapshots are uploaded by the admin via the existing `<ProfileUpworkSnapshotSheet>` drawer in Settings or via `scripts/import-upwork-profile.ts`. The full Upwork freelancer JSON (skills, portfolio, work history, feedback, categories, stats, location, top-rated status, hourly rate, JSS, etc.) lands in the JSONB `data` column. Profiles for Shayan, Saim, and Craig are already loaded; the rest are uploaded as profiles come online. No scraping needed.
- **Job data is already in `tasks.custom_fields`**. Vollna sends job details to n8n; `Format ClickUp Task` writes `_job_id`, `_job_url`, `_budget`, `_skills`, `_proposal`, client snapshot, routing info, and the AI-drafted proposal into the task card's `custom_fields` JSONB. Every card is a complete job snapshot. No scraping needed.

The new manual evaluator therefore takes a **Task Board card URL** (e.g. `http://157.173.110.62/tasks?task=0378386f-9717-479b-b32b-8a7825d0a62a`) plus a **profile picker** (only profiles with `is_current=TRUE` snapshot rows). The backend extracts the `task` UUID, joins `tasks` to read `custom_fields`, joins `upwork_profile_snapshots_current` for the chosen profile, and runs the same classifier sub-workflow used by the auto pipeline.

**Other v3.2 changes:** profile-ingest workflow deleted; profile-sync workflow deleted; `/api/scrape/upwork/*` proxy routes deleted; planned migration 017 schema additions slimmed to a much smaller migration 018 (the existing migration 017 covers what was previously planned). Total engineering effort drops from ~17–18 working days (v3.1) to ~8–10 working days. Cost projection drops from ~$14–20/mo to ~$5–8/mo (only Gemini, no Apify).

**Carried forward from v3.1:** §13 Production Readiness & n8n Update Strategy, §14 Rollback Strategy, §15 Execution Requirements, §16 Identified Gaps. These sections are pruned to reflect the smaller surface area but retain the safe-update protocol, kill-switch, and rollback discipline.

The classifier core itself is unchanged: gates + rubric + Gemini Flash 2.5, packaged as a shared n8n sub-workflow (`_relevancy-classifier-core`) so the existing Vollna auto-pipeline AND the new manual evaluator both call the same scoring engine — one source of truth.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Key Improvements Over v2](#2-key-improvements-over-v2)
3. [Architecture Diagram](#3-architecture-diagram)
4. [n8n Workflows](#4-n8n-workflows)
   - 4.1 `_relevancy-classifier-core` (shared sub-workflow)
   - 4.2 `EWnZg3svZWwcIRs4` (existing — splice unchanged from v2)
   - 4.3 `job-evaluate-manual` (new — task-card front door)
5. [Profile Data Source](#5-profile-data-source)
6. [Job Evaluation Flow](#6-job-evaluation-flow)
7. [Relevancy Scoring Model](#7-relevancy-scoring-model)
8. [Gemini Flash 2.5 Prompt Design](#8-gemini-flash-25-prompt-design)
9. [Data Schemas](#9-data-schemas)
10. [Admin Dashboard Design](#10-admin-dashboard-design)
11. [Performance + Cost Considerations](#11-performance--cost-considerations)
12. [Future Enhancements](#12-future-enhancements)
13. [Production Readiness & n8n Update Strategy](#13-production-readiness--n8n-update-strategy)
14. [Rollback Strategy](#14-rollback-strategy)
15. [Execution Requirements](#15-execution-requirements)
16. [Identified Gaps & Production-Readiness Recommendations](#16-identified-gaps--production-readiness-recommendations)
17. [Appendix A — Open Questions](#appendix-a--open-questions)
18. [Appendix B — Build Order](#appendix-b--build-order)

---

## 1. System Overview

### 1.1 Two entry points, one scoring engine

v3.2 is a single relevancy scoring system reachable via two front doors. Profile ingestion is no longer a workflow — the snapshot uploader (existing UI + CLI) is the third "door" but it doesn't trigger any scoring, just persists profile data.

| Front door | Trigger | Used by | LLM call cadence |
|---|---|---|---|
| **A. Vollna auto-pipeline** | Webhook from Vollna into `EWnZg3svZWwcIRs4` | Live production traffic (~40 jobs/day, capacity 400/day) | ~65% of jobs (35% short-circuit deterministic) |
| **B. Manual task-card evaluation** | Admin pastes task card URL (`/tasks?task=<uuid>`) + picks profile in dashboard | On-demand QA, calibration, edge-case review | 100% of submitted cards |
| *(C. Profile snapshot upload — admin UI / CLI — already shipped per migration 017; not a scoring trigger)* | | | |

Both scoring entry points pass through the same Postgres schema and the same `_relevancy-classifier-core` sub-workflow.

### 1.2 What the admin sees in the dashboard

| Section | Purpose | Data | Status |
|---|---|---|---|
| **Profile Management** (existing — Settings page) | List + add + edit profiles; upload Upwork snapshots via `<ProfileUpworkSnapshotSheet>` drawer | `profiles`, `upwork_profile_snapshots` | **Already shipped** |
| **Task Card Evaluator** *(new)* | Paste a Task Board card URL, pick a stored profile, get a score + breakdown + proposal angles | `tasks` (read), `manual_job_evaluations` (write), `relevancy_scores` (write) | New in v3.2 |
| **Relevancy Audit** *(new)* | Time-series view of classifier accuracy, gate-fail rates by profile/week | `relevancy_scores`, joined to `tasks.column_id` | New in v3.2 |

### 1.3 Single source of truth

- **PRD `job_relevancy_criteria_prd.md` v0.2** is the canonical rule set. The classifier prompt embeds §16 verbatim. Every `relevancy_scores` row stores `criteria_version` so historical scores stay auditable when the PRD changes.
- **`profiles` table** (existing) is the canonical profile registry.
- **`upwork_profile_snapshots` table + `upwork_profile_snapshots_current` view** (existing — migration 017) is the canonical profile-context store. The full Upwork JSON lives in the `data` JSONB column with promoted hot columns for fast filtering.
- **`tasks` table + `tasks.custom_fields`** (existing) is the canonical job-snapshot store. Every Vollna job is already persisted as a Task Board card by the existing n8n pipeline; manual eval reads it back.
- **`relevancy_scores` table** (new in v3.2 — migration 018) is the canonical scoring log for both front doors.

---

## 2. Key Improvements Over v2

v3.2 keeps every architectural improvement v3.1 promised over v2 — the difference is HOW the data arrives. v3.1 scraped Upwork; v3.2 reads from existing internal stores.

| # | v2 weakness | v3.2 fix | Section |
|---|---|---|---|
| 1 | Profile context exists only as `stack_bucket` + `portfolio_tldr` (assumed seeded manually); no automated profile ingestion | Profile data lives in `upwork_profile_snapshots` (migration 017, shipped). Admin uploads a JSON snapshot via the existing `<ProfileUpworkSnapshotSheet>` drawer or `scripts/import-upwork-profile.ts`. Full Upwork freelancer JSON (skills, portfolio, work history, feedback, categories, stats, location) is stored, indexed, and exposed via `upwork_profile_snapshots_current` view. | §5 |
| 2 | No way to evaluate a single ad-hoc job outside the Vollna pipeline | New `job-evaluate-manual` workflow + `/relevancy-evaluator` admin page. Input is a **Task Board card URL** (`/tasks?task=<uuid>`) — the card already holds the full job snapshot in `custom_fields`. | §4.5, §6, §10.3 |
| 3 | Profile data assumed static; no detection of changes | Snapshot history is built-in: append-only rows with `is_current` flag. Re-uploading a fresh snapshot demotes the previous row, preserving full history. No diff workflow needed; the view always returns the latest. | §5 |
| 4 | Classifier logic embedded inline in main workflow → cannot be reused without copy-paste | Extracted into `_relevancy-classifier-core` sub-workflow; main workflow + manual eval both invoke via `executeWorkflow` | §4.1, §4.2 |
| 5 | Skills are free-text strings → "Laravel" vs "laravel" vs "Laravel 10" treated as different | The snapshot's `skills_summary` (joined string) is `pg_trgm`-indexed for fast `ILIKE '%laravel%'` matching; the JSONB `data->'skills'` is GIN-indexed for structural matches. Canonical-slug taxonomy is OPTIONAL in v3.2 (deferred to v3.3 if calibration shows accuracy gaps). | §7.2.1 |
| 6 | No portfolio matching at the data layer; gate 10 was LLM-only | Deterministic substring scan over `data->'portfolio'->>'description'` for job skill keywords. LLM fallback when the substring scan finds nothing. | §7.2.2 |
| 7 | Work history not captured; rubric `skill_match` and `domain_match` were LLM guesses from `headline` | Snapshot's `data->'workHistory'` array (with feedback scores, contract titles, durations) feeds rubric scoring with concrete evidence. | §7.2.3 |
| 8 | "Replay 20 N/A tasks" smoke test was the only validation; no production UI to dogfood | Task-card evaluator IS the ongoing validation surface — admin pastes any historical card URL, sees what the classifier WOULD have said, every eval logged in `relevancy_scores`. | §10.3 |
| 9 | No scraping infrastructure | **Eliminated.** Profile data is uploaded by the admin (one-time per profile, refresh as needed). Job data is already in the Task Board (every Vollna event creates a card). Zero scraping infra, zero Apify cost. | §5, §6 |
| 10 | `criteria_version` stored but no UI to see when it changed | `criteria_versions` table + admin viewer; PRD changelog rows mirror DB rows | §9 |
| 11 | Admin overrides not modeled | `relevancy_overrides` table: when an agent moves a card to N/A despite classifier=proceed (or vice versa), we capture it for calibration | §9 |
| 12 | Profile URL not stored — re-syncing requires admin to remember the URL | Snapshot row carries `profile_url` (promoted hot column) and `data->'identity'->>'profileUrl'`. Re-upload is admin-driven; no n8n "Sync Now" button needed. | §5 |
| 13 | No category-level matching | Snapshot's `data->'jobCategories'` array (with groupName + name, e.g. "Web, Mobile & Software Dev / Web Development") is queryable. Used in rubric `domain_match`. | §7.2.3 |
| 14 | Profile ingestion's HTML-vs-API choice was hand-waved away | **Resolved by separation of concerns.** Snapshot extraction is offline (`docs/profiles/extract-profile.js` runs against a saved Upwork HTML page, producing the JSON ingested by migration 017). The classifier and the dashboard never touch Upwork.com directly. | §5 |
| 15 | No diff visualization | Not applicable in v3.2 — snapshot history is immutable. Audit page shows a per-profile snapshot timeline (uploads count + most-recent extraction date). | §10.4 |

---

## 3. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  ADMIN DASHBOARD (Next.js)                                   │
│  ┌──────────────────────────────┐   ┌──────────────────────────┐   ┌─────────────────────┐   │
│  │ Settings → Profile Snapshots │   │  Task Card Evaluator     │   │  Relevancy Audit    │   │
│  │ (existing — Upload JSON)     │   │  Paste card URL +        │   │  Accuracy / Gates / │   │
│  │ <ProfileUpworkSnapshotSheet> │   │  Pick profile            │   │  Cost / Overrides   │   │
│  └────────┬─────────────────────┘   └────────┬─────────────────┘   └────────┬────────────┘   │
└───────────┼─────────────────────────────────┼──────────────────────────────┼──────────────────┘
            │                                  │                              │
            ▼                                  ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Next.js API routes (Contabo)                                    │
│  POST /api/profiles/:id/upwork-snapshot   → upload JSON (existing — admin only)              │
│  GET  /api/profiles/:id/upwork-snapshot   → read current snapshot (existing — admin/owner)   │
│  POST /api/relevancy/evaluate-task        → forwards to n8n job-evaluate-manual webhook      │
│         body: { task_card_url | task_id, profile_id }                                        │
│  GET  /api/profiles/:id/context           → reads upwork_profile_snapshots_current view +    │
│                                              profiles.thresholds_overrides                   │
│  GET  /api/tasks/:id/job-payload          → reads tasks.custom_fields → canonical job JSON   │
│  POST /api/relevancy-scores               → audit log writer (called by n8n)                 │
│  GET  /api/relevancy-scores/accuracy      → admin metrics                                    │
└──────┬───────────────────────────────────────────────────────────────┬─────────────────────────┘
       │                                                               │
       │                                                               │ (callbacks: write score,
       │                                                               │  write override, etc.)
       ▼                                                               │
┌──────────────────────────────────────────────────────────────────────┴────────────────────────┐
│                          n8n CLOUD (ikonicdev.app.n8n.cloud) — TWO workflows                  │
│                                                                                               │
│  ┌──────────────────────────────────┐                                                         │
│  │  job-evaluate-manual (NEW)       │   J1 Webhook → J2 Validate {task_id, profile_id} →     │
│  │                                  │   J3 Load Task Card (httpRequest GET                    │
│  │                                  │      /api/tasks/:id/job-payload) →                     │
│  │                                  │   J4 Compose payload → J5 Score Relevancy →            │
│  │                                  │   J6 Format Verdict → J7 Respond                       │
│  └─────────────────┬────────────────┘                                                         │
│                    │                                                                          │
│                    ▼ executeWorkflow                                                          │
│  ┌────────────────────────────────────────────────┐                                           │
│  │ _relevancy-classifier-core (NEW)               │  ← shared sub-workflow                    │
│  │  C1 Load Profile Context (snapshot view)       │                                           │
│  │  C2 Deterministic Pre-check                    │                                           │
│  │  C3-4 Prepare Classifier Input (Mode A or B)   │                                           │
│  │  C5 AI Agent — Gemini Flash 2.5                │                                           │
│  │  C6 Validate Classifier Output + Verifier      │                                           │
│  │  C7-9 Build {Reject|Review|Proceed} Payload    │                                           │
│  │  C10 Persist Relevancy Score                   │                                           │
│  └─────────────▲──────────────────────────────────┘                                           │
│                │ executeWorkflow                                                              │
│                │                                                                              │
│  ┌─────────────┴─────────────────────────────────────────────────────────────┐                │
│  │  EWnZg3svZWwcIRs4 (EXISTING — Vollna auto-pipeline)                       │                │
│  │   8 webhooks → Merge → Process Job → Route Job (proceed) ──►              │                │
│  │     invoke _relevancy-classifier-core ──►                                 │                │
│  │     Build GPT Input → AI Agent (Proposal Writer) → Format ClickUp Task →  │                │
│  │     Create Board Task (POST /api/v1/webhooks/tasks)                       │                │
│  └───────────────────────────────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────┐
                    │  Google AI Studio (Gemini)  │
                    │  gemini-2.5-flash           │
                    └─────────────────────────────┘

(No external scraping service. Profile data lives in upwork_profile_snapshots, uploaded via
admin UI / CLI. Job data lives in tasks.custom_fields, written by the existing Vollna pipeline.)
```

---

## 4. n8n Workflows

Two total in v3.2. One shared core, one new front door. (v3.1's `profile-ingest` and `profile-sync` workflows are gone — profile data is uploaded by the admin via the existing UI/CLI, not scraped.)

### 4.1 `_relevancy-classifier-core` (NEW — shared sub-workflow)

**Purpose**: encapsulate the classifier (gates + rubric + LLM + persistence) so it can be invoked from any other workflow via `n8n-nodes-base.executeWorkflow`. Extracted verbatim from v2 §3.2 nodes N1–N10.

**Trigger**: `Execute Workflow` (called by parent workflow). Inputs: `{ profile_id, job, request_meta }`.

**Output**: classifier verdict JSON (see §8.4 schema).

**Internal nodes** (unchanged from v2 §3.2; renamed for clarity):

| ID | Node | Type | Purpose |
|---|---|---|---|
| C1 | `Load Profile Context` | httpRequest | GET `/api/profiles/:id/context` → snapshot-derived skills/portfolio/work-history TL;DR, thresholds |
| C2 | `Deterministic Pre-check` | code | Run gates 2, 3, 4 (when structured), 5, 6, 11 in pure JS |
| C3 | `Gate Switch` | if | `deterministic.failed.length > 0` ? → C7 : → C4 |
| C4 | `Prepare Classifier Input` | set | Compose user message for LLM |
| C5 | `AI Agent — Relevancy Classifier` | langchain.agent | Gemini Flash 2.5 + Structured Output Parser |
| C6 | `Validate Classifier Output` | code | Schema sanity check; retry-once on parse fail; lightweight verifier (regex-scan job description for `loom`/`video`/`record yourself` to catch gate-9 hallucinations — see §16.7 A3) |
| C7 | `Build Reject Payload` | set | Compose verdict object for `decision = reject` |
| C8 | `Decision Switch` | switch | reject / review / proceed |
| C9 | `Build Review Payload` | set | Compose verdict object for `decision = review` |
| C10 | `Persist Relevancy Score` | httpRequest | POST `/api/relevancy-scores` (parallel; `neverError: false`); on failure, payload is parked in `relevancy_scores_dlq` for retry |

**Exit**: returns the validated verdict object to the caller. Caller decides what to do with it (write a Task Board card, return to UI, etc.).

**Why a sub-workflow**: avoids duplicate node config across the two caller workflows; lets us swap the LLM provider (Gemini → Claude → OpenAI) in one place; lets us version the classifier independently from its callers (`prompt_version` advances without touching the auto-pipeline).

### 4.2 `EWnZg3svZWwcIRs4` (EXISTING — Vollna auto-pipeline)

**No structural change from v2.** The classifier splice between `Process Job` (output: proceed) and `Build GPT Input` becomes a single new node:

| Node | Type | Purpose |
|---|---|---|
| `Score Relevancy` | `n8n-nodes-base.executeWorkflow` v1 | `workflowId: <_relevancy-classifier-core ID>`, `mode: 'each'`, passes `{profile_id, job, request_meta: { source: 'auto', task_id: null }}` |

The `Decision Switch` from v2 §3.2 is now inside `_relevancy-classifier-core`, so the parent workflow only sees the verdict. After `Score Relevancy`:

```
Score Relevancy ─► IF (decision === 'proceed') ─► Build GPT Input  (existing)
                                                            ─► Format ClickUp Task with _column from verdict
                                                            (N/A for reject, Todo for review, Proposal Submitted for proceed-after-Writer)
```

Net new nodes in main workflow: **2** (one `executeWorkflow`, one `IF`). Easier to validate, easier to roll back.

### 4.3 `job-evaluate-manual` (NEW)

**Purpose**: admin pastes a Task Board card URL + picks a profile → return a full classifier verdict. Read-only research; doesn't move the card or create new ones.

**Trigger**: `Webhook` POST `/webhook/job-evaluate-manual`, body `{ task_id, profile_id, requested_by }`. The Next.js route `/api/relevancy/evaluate-task` accepts either a raw `task_id` UUID or a `task_card_url` (`http://host/tasks?task=<uuid>` or `http://host/my-tasks?task=<uuid>`); it parses the URL server-side and forwards a normalized `task_id` to n8n.

**Auth**: header `Authorization: Bearer <MANUAL_EVAL_TOKEN>` (n8n Header Auth credential). The dashboard adds the token; the admin's browser never sees it.

#### Node-by-node

| ID | Node | Type | Purpose |
|---|---|---|---|
| J1 | `Webhook (Manual Eval)` | webhook v2.1 | Entry. Validates Bearer token. |
| J2 | `Validate Input` | code | Confirm `task_id` is a UUID and `profile_id` resolves. Throw → 400 if not. |
| J3 | `Load Task Card` | httpRequest v4.2 | GET `/api/tasks/:id/job-payload` (Bearer `n8n-board-sync`). Returns the canonical Job payload (§6.2) extracted from `tasks.custom_fields`. Timeout 10s. `onError: continueErrorOutput` → 404 branch returns 422 "task not found". |
| J4 | `Compose Payload` | set | Wrap as `{ profile_id, job: <step J3 output>, request_meta: { source: 'manual_url', task_id, requested_by } }` |
| J5 | `Score Relevancy` | executeWorkflow v1 | Invoke `_relevancy-classifier-core` (workflowId pinned). retryOnFail: true, maxTries: 2, waitBetweenTries: 1500. |
| J6 | `Format Verdict for UI` | set | Strip internal fields, add `evidence_panel` for dashboard rendering |
| J7 | `Respond` | respondToWebhook | 200 + verdict (or 422 with `_errorDetail` from J3 / J5 error branches) |

The verdict IS persisted in `relevancy_scores` (via C10 inside the sub-workflow) with `evaluation_path = 'manual_url'` and `request_meta.task_id` populated, so we can compare manual-eval distribution vs auto-pipeline distribution over time AND link manual evals to the same physical card the auto pipeline scored.

#### Re-evaluation semantics

If the same `(task_id, profile_id)` pair is evaluated multiple times (admin clicks "Re-run" or repeats the eval after a snapshot upload), each call produces a fresh `relevancy_scores` row. The `task_id` may end up with multiple scores; the audit page treats the most-recent one as canonical for "what does the classifier currently say" while keeping older rows visible in the timeline. No Apify cache to bust — every eval reads the current `tasks.custom_fields` and the current snapshot.

#### Latency budget (visible to user)

| Stage | p95 |
|---|---|
| J3 Load Task Card (Postgres + JSON build) | 200ms |
| C1 profile context (snapshot view) | 200ms (cached) |
| C2 deterministic | 50ms |
| C5 Gemini call | 800ms |
| Total (proceed path) | **~1.3-2s** |
| Total (deterministic reject) | **~500-700ms** (no LLM call) |

UI shows a brief progress indicator (sub-second on most paths): "Loading task…" → "Loading profile context…" → "Running classifier…" → result. Compared to v3.1's 6–16s budget (Apify-bound), v3.2 evaluator is roughly an order of magnitude faster because no external network fetch is involved.

---

## 5. Profile Data Source

v3.2 has no scraping workflow. Profile data is sourced from `upwork_profile_snapshots` — an existing append-only table populated by admin uploads. Migration 017 (already shipped) and the surrounding tooling cover the entire profile-ingest concern.

### 5.1 Existing infrastructure (recap from CLAUDE.md)

| Component | Path | Status | Role |
|---|---|---|---|
| Schema | `src/lib/migrations/017_upwork_profile_snapshots.sql` | Shipped | `upwork_profile_snapshots` table + `upwork_profile_snapshots_current` view + `pg_trgm` GIN index on `skills_summary` + JSONB GIN on `data->'skills'` |
| Extractor (offline) | `docs/profiles/extract-profile.js` | Shipped | Parses a saved Upwork freelancer HTML page → emits the canonical JSON shape (see §5.3) |
| CLI uploader | `scripts/import-upwork-profile.ts` | Shipped | `node --import tsx scripts/import-upwork-profile.ts --profile-id <slug> --json <path>` |
| Data layer | `getUpworkProfileSnapshot(profileId)` / `getUpworkProfileSnapshotHistory(profileId, limit)` / `saveUpworkProfileSnapshot(profileId, json)` | Shipped | Read view, read history, atomic CTE-INSERT writer |
| Server action | `saveUpworkProfileSnapshotAction` | Shipped | Auth wrapper: admin can save any profile; agent can save only profiles where `profiles.agent_id = session.user.agentId` |
| API | `GET/POST /api/profiles/:id/upwork-snapshot` | Shipped | GET readable by admin OR profile-owner agent; POST admin-only |
| Admin UI | `<ProfileUpworkSnapshotSheet>` drawer in Settings → profile table | Shipped | Three tabs: Current / History / Upload (Upload visible to admin only) |

The current snapshot is uploaded once per profile, refreshed on demand (admin re-uploads when a profile changes materially — new portfolio item, JSS jump, headline edit). No cron, no diff workflow, no sync UI; the table's append-only history serves as the audit trail.

**Loaded profiles as of v3.2 release:** Shayan, Saim, Craig (sample data). Other profiles (Sana, Laiba, Khansa, Rebekah, Nawal, Mubashir) need their first snapshot uploaded before they can be used in the manual evaluator. The classifier returns a clean error (`profile_snapshot_missing`) when an evaluation is requested for a profile with zero `is_current` rows.

### 5.2 Snapshot freshness policy

Snapshots are NOT auto-refreshed. The admin owns the upload cadence; the dashboard surfaces age as a soft signal only:

| Snapshot age | UI signal | Block scoring? |
|---|---|---|
| < 30 days | Green | No |
| 30–90 days | Yellow "Refresh recommended" badge on profile row + audit tile | No |
| > 90 days | Red "Stale snapshot" badge | No (still scores; classifier output includes `confidence_warnings: ['stale_snapshot']`) |
| Missing (zero rows) | Red "No snapshot uploaded" badge | **Yes** — classifier returns `profile_snapshot_missing` |

Thresholds configurable per environment via `SNAPSHOT_STALE_DAYS_WARN` / `SNAPSHOT_STALE_DAYS_BLOCK` env vars. Default: 30 / never (warn only).

### 5.3 Snapshot JSON shape (canonical — produced by `extract-profile.js`)

The full Upwork freelancer JSON. Reference example: `docs/profiles/Shayan.json`. Top-level keys consumed by the classifier:

```jsonc
{
  "source": { "file": "Shayan.html", "extractedAt": "2026-05-08T12:42:59Z" },
  "identity": {
    "name": "Shayan S.", "firstName": "Shayan",
    "title": "Full Stack Developer | Laravel | PHP | WordPress | React.js | Node.js",
    "location": { "country": "Pakistan", "city": "Islamabad", "countryCodeIso2": "PK", "countryTimezone": "..." },
    "profileUrl": "https://www.upwork.com/freelancers/~0123506ed5af2698ff",
    "ciphertext": "~0123506ed5af2698ff",
    "contractorTier": 3
  },
  "description": "<full bio, including emoji, Unicode, sectioned formatting>",
  "stats": {
    "rating": 5, "ratingRecent": 5,
    "totalFeedback": 2, "totalJobsWorked": 4, "totalHours": 506,
    "hourlyRate": { "currencyCode": "USD", "amount": 30 },
    "totalEarnings": 0, "topRatedStatus": "top_rated", "topRatedPlusStatus": "top_rated_plus",
    "jobSuccessScore": 1, "memberSince": "2024-08-13T16:41:29Z",
    "lastWorkedOn": "2026-03-08T00:00:00Z", "totalPortfolioItems": 3
  },
  "skills": [{ "uid": "...", "name": "Laravel", "isHighlighted": false }, ...],
  "jobCategories": [{ "groupName": "Web, Mobile & Software Dev", "name": "Web Development" }, ...],
  "portfolio": [{ "uid": "...", "title": "...", "description": "...", "skills": [], "url": null, "createdOn": null }, ...],
  "workHistory": [{ "title": "...", "type": "Hourly", "status": "Closed", "startedOn": "...", "endedOn": "...",
                    "totalHours": 40, "feedback": { "score": 5, "comment": "..." } }, ...],
  "feedback": [{ "id": "...", "jobTitle": "...", "date": "...", "rating": 5, "clientName": "...", "comment": "...", "truncated": true }, ...],
  "agencies": [{ "name": "IKONIC DEV", "topRatedStatus": "hipo", "totalHours": 440 }, ...],
  "languages": [], "certificates": [], "specializedProfiles": [...]
}
```

Promoted hot columns on `upwork_profile_snapshots` (extracted on insert): `name`, `title`, `hourly_rate`, `rating`, `job_success_score`, `top_rated_status`, `total_jobs_worked`, `total_hours`, `last_worked_on`, `profile_url`, `ciphertext`, `skills_summary` (joined string of all skill names — `pg_trgm` indexed for `ILIKE` matching).

Everything else lives in the `data` JSONB column, GIN-indexed on `data->'skills'` for structural matches.

### 5.4 Profile context endpoint (consumed by classifier)

`GET /api/profiles/:id/context` — assembled server-side from `upwork_profile_snapshots_current` + `profiles.thresholds_overrides`:

```jsonc
{
  "profile": {
    "id": "uuid",
    "profile_id": "shayan",                    // slug (matches profiles.profile_id and snapshot.profile_id)
    "name": "Shayan S.",
    "headline": "Full Stack Developer | Laravel | PHP | WordPress | React.js | Node.js",
    "skills": ["Laravel","PHP","WordPress","React","Node.js","Vue.js","TypeScript","MySQL", ...],
    "skills_summary": "Full-Stack Development, Laravel, PHP, WordPress, ...",
    "portfolio_tldr": [
      { "title": "Landscale management platform — Laravel", "description_excerpt": "...", "tech_stack_inferred": ["laravel","wordpress","aws"] }
    ],
    "work_history_tldr": [
      { "title": "Full-Stack Developer (Laravel + React/Next.js) for Legacy SaaS CRM Upgrade & Development",
        "type": "Hourly", "status": "Closed", "totalHours": 40, "feedback_score": 5 }
    ],
    "categories": [
      { "groupName": "Web, Mobile & Software Dev", "name": "Ecommerce Development" },
      { "groupName": "Web, Mobile & Software Dev", "name": "Web Development" }
    ],
    "stats": {
      "rating": 5, "jss": 100, "top_rated_status": "top_rated", "top_rated_plus": true,
      "hourly_rate_usd": 30, "total_jobs": 4, "total_hours": 506, "last_worked_on": "2026-03-08"
    },
    "country": "Pakistan",
    "snapshot_age_days": 0,
    "snapshot_extracted_at": "2026-05-08T12:42:59Z",
    "_warnings": []                              // populated when snapshot is stale, missing fields, etc.
  },
  "thresholds_overrides": {
    "client_spend_floor": null,
    "freshness_window_hours": 24,
    "hourly_floor_usd": null
  },
  "criteria_version": "0.2",
  "context_generated_at": "2026-05-08T13:00:00Z"
}
```

The `tech_stack_inferred` field on portfolio items is computed at endpoint-build time by token-matching the portfolio description against the profile's `skills` array. This gives gate 10 (`portfolio_match`) a deterministic substring-overlap target without requiring a curated taxonomy.

**Caching**: Next.js wraps this with `unstable_cache` (5 min TTL, tagged by `profile-context-<id>`); n8n falls back to its own static data cache (1 hour TTL) if the endpoint is briefly unavailable. The cache is invalidated by `revalidateTag(\`profile-context-${id}\`)` on `saveUpworkProfileSnapshotAction` success.

### 5.5 Profile snapshot maintenance (admin workflow)

The admin uploads a snapshot when:

1. Onboarding a new profile (one-time setup).
2. The profile's Upwork page changes materially (new portfolio item, JSS rebracket, headline rewrite, top-rated status change, agency change).
3. Calibration cycles request a fresh snapshot for retrospective scoring.

Steps:

```
# 1. Open the profile's Upwork page in a browser, save the rendered HTML
#    (Cmd-S on Mac, Ctrl-S on Windows). Save to docs/profiles/<name>.html.

# 2. Run the extractor
node docs/profiles/extract-profile.js docs/profiles/<name>.html > docs/profiles/<name>.json

# 3a. Upload via UI (preferred for ad-hoc):
#     Settings → profile row → "Upwork Snapshot" → "Upload" tab → paste JSON
#
# 3b. Or upload via CLI (preferred for batch):
node --import tsx scripts/import-upwork-profile.ts --profile-id <slug> --json docs/profiles/<name>.json
```

After upload, the profile-context endpoint cache is busted, the audit page snapshot timeline gains a new entry, and any subsequent classifier call sees the new data.

---

## 6. Job Evaluation Flow

### 6.1 Admin pastes a Task Board card URL

#### 6.1.1 UI sequence

1. Admin opens `/relevancy-evaluator`.
2. Paste box: "Task Board card URL" (validated client-side against the patterns `^https?://[^/]+/(tasks|my-tasks)\?task=[0-9a-f-]{36}$`). Raw UUIDs are also accepted as a paste-and-go convenience.
3. Profile picker: dropdown of profiles where `upwork_profile_snapshots_current` has a row. Profiles without a snapshot are listed but disabled with the tooltip "Upload an Upwork snapshot first" linking to Settings.
4. Click "Evaluate" → loading state.
5. UI POSTs `/api/relevancy/evaluate-task` with `{ task_card_url | task_id, profile_id }`.
6. Backend parses the URL → resolves `task_id`. Forwards to n8n `job-evaluate-manual` webhook (synchronous; n8n returns when verdict is ready).
7. UI shows brief progress (typically sub-second): 3 stages (validate → load → classify). No SSE needed at v3.2 latencies, but the `EventSource`-ready endpoint is built so streaming can be enabled if Gemini latency creeps up.
8. Result panel renders:
   - Headline verdict (proceed / reject / review) + tier
   - **What this card actually has** banner — current column on the board, current assignee, age in days. Helps the admin compare "what the classifier says" with "what the agent did".
   - Hard gate grid (11 rows: pass/fail/skipped, evidence)
   - Rubric breakdown (7 components, value/max, reason)
   - Top 3 proposal angles (only on proceed)
   - "Re-run" button (re-reads `tasks.custom_fields` AND `upwork_profile_snapshots_current` — useful after a snapshot upload)
   - "Open card" button (deep link back to `/tasks?task=<uuid>` so the admin can see the card itself)

#### 6.1.2 What's persisted

Every manual evaluation writes:

- One row to `manual_job_evaluations` (the request: who, when, task_id, profile_id, source)
- One row to `relevancy_scores` (the verdict; `evaluation_path = 'manual_url'`, `task_id` populated)

Linked by `manual_job_evaluations.score_id → relevancy_scores.id`.

**No card is created** by manual evaluation — the input IS already a card. The eval is a read-only research tool; if the admin wants to act on the verdict (move the card to N/A, add a tag, etc.), they do that on the Task Board itself with the existing controls. v3.1's "Save to Task Board" button (and the `/api/relevancy/promote-to-card` route it called) is dropped in v3.2 — there's nothing to promote.

### 6.2 Job payload schema (extracted from `tasks.custom_fields`)

The `GET /api/tasks/:id/job-payload` endpoint reads a single `tasks` row and projects it into the canonical shape consumed by the classifier:

```jsonc
{
  "task_id": "0378386f-9717-479b-b32b-8a7825d0a62a",
  "task": {
    "title": "[Sana] Build Laravel Stripe integration for SaaS billing",
    "current_column": "Proposal Submitted",
    "current_assignee_name": "Sana",
    "created_at": "2026-05-06T08:14:00Z",
    "stage_entered_at": "2026-05-06T08:14:00Z"
  },
  "job_id": "~01abc123",                           // tasks.custom_fields._job_id (Upwork stable ID)
  "url": "https://www.upwork.com/jobs/~01abc123",  // tasks.custom_fields._job_url
  "title": "Build Laravel Stripe integration for SaaS billing",
  "description": "We need a senior dev to integrate Stripe...",
  "skills_required": ["Laravel","Stripe","PHP","API Integration"],   // raw from Upwork via tasks.custom_fields._skills
  "category": null,                                // not always populated by Vollna; classifier handles missing
  "budget_type": "hourly",                         // tasks.custom_fields._budget_type
  "budget_min": 35,
  "budget_max": 60,
  "fixed_amount": null,
  "client": {
    "country": "United States",                    // tasks.custom_fields._client_country
    "total_spent": 18355,
    "hires": 26,
    "rating": 4.97,
    "payment_verified": true,
    "member_since": "2018-04-12"
  },
  "proposals_count": 12,                           // tasks.custom_fields._proposals_count
  "interviewing_count": 1,
  "invites_sent_count": 0,
  "hires_made_count": 0,
  "posted_at": "2026-05-06T08:14:00Z",             // tasks.custom_fields._posted_at
  "source": "manual_url",                          // always "manual_url" from this endpoint
  "card_age_days": 0,
  "_proposal_already_drafted": "...",              // tasks.custom_fields._proposal — surfaced for the UI but NOT fed to classifier
  "_assigned_agent": "Sana",                       // tasks.custom_fields._assigned_agent
  "_profile_name": "sana"                          // tasks.custom_fields._profile_name (matches profiles.profile_id)
}
```

Vollna-fed jobs (auto pipeline) arrive in essentially the same shape from `Process Job`'s normalization step; the only difference is `source: "vollna"` and the absence of `task_id` / `task` / `card_age_days` (the auto pipeline scores BEFORE the card is created, so there's no card to point at). The classifier ignores those fields when missing.

#### 6.2.1 Field-mapping reference (Vollna → custom_fields → job-payload)

| Job-payload field | Source on `tasks` row | Notes |
|---|---|---|
| `job_id` | `custom_fields._job_id` | Upwork's stable ID, `~01...` format |
| `url` | `custom_fields._job_url` | |
| `title` | `tasks.title` (after stripping `[profile]` prefix) | |
| `description` | `custom_fields._job_description` | n8n's `Format ClickUp Task` writes this |
| `skills_required` | `custom_fields._skills` | Array of raw Upwork skill names |
| `budget_*` | `custom_fields._budget`, `_budget_type`, `_budget_min`, `_budget_max`, `_fixed_amount` | |
| `client.*` | `custom_fields._client_country`, `_client_total_spent`, `_client_hires`, `_client_rating`, `_client_payment_verified` | |
| `proposals_count` | `custom_fields._proposals_count` | The freshness signal Vollna captures at intake |
| `posted_at` | `custom_fields._posted_at` | |
| `_proposal_already_drafted` | `custom_fields._proposal` | The proposal n8n's AI Agent already wrote — kept for UI display, NOT fed back into the classifier (would create circular bias) |
| `_assigned_agent` | `custom_fields._assigned_agent` | Display only |
| `_profile_name` | `custom_fields._profile_name` | Used to detect mismatches: if admin selects a different profile than the one the auto-pipeline routed to, UI flashes a yellow note "evaluating against a different profile than the auto-pipeline used" |

#### 6.2.2 Missing-field handling

If a card lacks a field (older cards from before Vollna started populating it, manual cards never linked to a Vollna job), the endpoint returns `null` for that field and includes a `_missing_fields: [...]` array. The classifier:

- Treats missing `proposals_count` as gate 3 `unverified` (don't reject, but flag in evidence).
- Treats missing `client.*` fields as gate 5/6 `unverified` (don't reject; LLM may still find evidence in description text).
- Treats missing `posted_at` as gate 2 `unverified` (don't reject).

This makes the manual evaluator robust against historical cards that pre-date the current `Format ClickUp Task` schema.

### 6.3 The classifier doesn't care about the front door

Inside `_relevancy-classifier-core`, the per-job user message is the same JSON shape. The only differences:

- `request_meta.source` (`auto` vs `manual_url`) — stored in `relevancy_scores.evaluation_path` for analytics. Never used for decision logic.
- `request_meta.task_id` — populated for `manual_url` evaluations (the input IS a card), null for `auto` evaluations (no card exists yet).

This is v3.2's design leverage: one classifier core, two callers, identical scoring logic.

---

## 7. Relevancy Scoring Model

### 7.1 Layered architecture (carried over from v2 §4.1)

- **Layer 1 — 11 Hard gates.** Any single fail → `decision: reject` with verbatim PRD §6.2 label(s).
- **Layer 2 — 7-component rubric (0-100).** Only when Layer 1 fully passes.

### 7.2 What changes in v3.2 vs v2

#### 7.2.1 Gate 1 (`stack_match`) — hybrid via snapshot fields

v2: pure LLM check.
v3.2:
1. **Deterministic first** — for each job skill, run a case-insensitive substring match against the snapshot's `skills_summary` column. Implementation: `WHERE EXISTS (SELECT 1 FROM upwork_profile_snapshots_current s WHERE s.profile_id = $1 AND s.skills_summary ILIKE ANY(ARRAY[<job_skills>]))`. Backed by the `pg_trgm` GIN index — sub-millisecond at our scale. Considered a pass if at least 1 of the job's skills appears verbatim or as a substring in the profile's skill names.
2. **Structural fallback** — when ILIKE finds nothing, try `data->'skills' @> '[{"name":"<skill>"}]'::jsonb` for an exact name match (catches edge cases where `ILIKE` would falsely fire on a partial substring like "PHP" in "PHPMyAdmin").
3. **LLM fallback** — if both deterministic checks return empty, defer to the classifier LLM with the snapshot's full skill array + job description. The LLM resolves semantic equivalence ("Headless CMS dev" job vs profile listing "WordPress + Next.js").

This catches the obvious cases (Laravel job + profile with "Laravel" in skills_summary) at zero LLM cost and only burns tokens when the match requires semantic judgment. Compared to v3.1's curated-taxonomy approach, this trades 1–2% accuracy on canonicalization edge cases for zero seed-data maintenance cost.

#### 7.2.2 Gate 10 (`portfolio_match`) — hybrid via snapshot portfolio

v2: pure LLM check.
v3.2:
1. **Deterministic first** — substring scan. For each job skill, check whether ANY portfolio item's `title` or `description` contains the skill name (case-insensitive). Implementation in the C1 endpoint at materialization time: `tech_stack_inferred[]` is computed per portfolio item; the C2 deterministic checker tests `job.skills_required ∩ tech_stack_inferred`. If non-empty → pass.
2. **LLM fallback** — when no overlap, the LLM receives the full `portfolio_tldr[]` (title + description excerpt for each item) and decides whether anything is "close enough" semantically.
3. **Soft-pass for empty portfolios** — if `data->'portfolio'` is empty AND the profile is `top_rated_status='top_rated'` OR `job_success_score >= 90`, gate 10 soft-passes with `gate_10_softpassed: true` in evidence (see §16.8 E1).

#### 7.2.3 Rubric anchoring with real work history + categories

v2 rubric component `domain_match` was an LLM guess from `headline`. v3.2 passes:
- `work_history_tldr[]` — top 5 from `data->'workHistory'`, ordered by recency. Each entry includes title, type, status, hours, feedback score + comment.
- `categories[]` — `data->'jobCategories'` (e.g. "Web, Mobile & Software Dev / Web Development", "Web, Mobile & Software Dev / Ecommerce Development").
- `feedback[]` excerpts — `data->'feedback'` (top 3, truncated descriptions allowed).

These give `domain_match` and `skill_match` concrete evidence to cite. Rubric stability rises — the LLM is no longer reasoning from a 200-char headline.

#### 7.2.4 Per-profile threshold overrides

`profiles.thresholds_overrides JSONB` (new column in migration 018) — a profile owner can override the default threshold per gate. Example: Khansa allowed to bid on lower-spend clients ($500 vs default $1000). Loaded by C1, included in `relevancy_scores.thresholds_used` for audit.

#### 7.2.5 Snapshot-source fields used by each gate

| Gate | Job-payload source | Snapshot source |
|---|---|---|
| 1 stack_match | `skills_required[]` | `skills_summary` (ILIKE) + `data->'skills'` (structural) |
| 2 freshness | `posted_at` | n/a |
| 3 proposal_saturation | `proposals_count` | n/a |
| 4 hourly_floor | `budget_min/max`, `budget_type` | `data->'stats'->>'hourlyRate'->>'amount'` for cross-check sanity |
| 5 client_spend_floor | `client.total_spent` | n/a |
| 6 client_rating_floor | `client.rating`, `client.hires` | n/a |
| 7 job_availability | `description` (LLM scan) | n/a |
| 8 no_location_lockin | `description` (LLM scan) | `data->'identity'->'location'->>'country'` (LLM uses to judge "EU only" vs profile country) |
| 9 no_video_proposal | `description` (LLM + verifier regex) | n/a |
| 10 portfolio_match | `skills_required[]` | `data->'portfolio'[*]->'title'/'description'` (substring) |
| 11 no_duplicate | `job_id` | n/a (looked up against `relevancy_scores` history) |
| Rubric `skill_match` | `description`, `skills_required` | `skills`, `skills_summary` |
| Rubric `domain_match` | `description` | `workHistory`, `jobCategories`, `feedback` |
| Rubric `experience_level_fit` | `description` (seniority hints), `budget_*` | `stats.jobSuccessScore`, `stats.topRatedStatus`, `stats.hourlyRate.amount`, `stats.totalHours` |
| Rubric `portfolio_evidence` | `skills_required` | `portfolio[*]` |
| Rubric `client_quality` | `client.*` | n/a |
| Rubric `competition_position` | `proposals_count`, `interviewing_count`, `posted_at` | n/a |
| Rubric `red_flags` | `description` | n/a |

### 7.3 The full gate table (v3.2)

Identical to v2 §4.2 but with the deterministic/LLM split column updated:

| Gate | Threshold | Reason label | v3.2 checker |
|---|---|---|---|
| 1 stack_match | ≥1 substring match in `skills_summary` OR structural `data->'skills'` match | `Out of stack` | **Deterministic first** (`pg_trgm` ILIKE + JSONB containment), LLM fallback |
| 2 freshness | ≤24h | `Old job` | Deterministic |
| 3 proposal_saturation | <30 | `Too many invites` | Deterministic |
| 4 hourly_floor | ≥$25 (if hourly) | `Low Higher rate` | Deterministic (structured) / LLM (text) |
| 5 client_spend_floor | ≥$1,000 | `Client Low spending` | Deterministic |
| 6 client_rating_floor | ≥4.0 (or null + 0 hires) | `Bad rating client` | Deterministic |
| 7 job_availability | open | `Job unavailable` / `Already hired` | LLM (text scan) |
| 8 no_location_lockin | no residency lock | `Location loc` | LLM (semantic) |
| 9 no_video_proposal | no video required | `Video Proposal` | LLM (text scan) + regex verifier (§16.7 A3) |
| 10 portfolio_match | ≥1 mappable item OR top_rated/JSS≥90 soft-pass | `Portfolio unavailable` | **Deterministic first** (substring scan over snapshot portfolio), LLM fallback |
| 11 no_duplicate | not seen 30d | `Duplicate` | Deterministic |

After v3.2's hybrid changes: **6 gates fully deterministic, 2 hybrid, 3 LLM-only.** When all hybrids resolve deterministically, the LLM only needs to evaluate gates 7, 8, 9 + the rubric — significantly tightening the prompt and the token cost.

### 7.4 Soft signals (carried unchanged from PRD §8 / v2 §4.5)

7 soft signals embedded as `evidence` in rubric component reasons. Never auto-reject.

---

## 8. Gemini Flash 2.5 Prompt Design

### 8.1 Two prompt modes

v2 had one prompt for everything. v3 splits into two by token-budget pressure:

| Mode | When | System instruction size | Output schema |
|---|---|---|---|
| **A. Full classify** | Front door A or B; deterministic incomplete | ~7,000 tokens (full §16 library) | Full schema (gates + components + verdict) |
| **B. Edge-only** | Front door A; deterministic resolved gates 1-6, 11; only gates 7, 8, 9 + rubric remain | ~3,500 tokens (subset library: Job unavailable, Location loc, Video Proposal proceed examples + rubric) | Trimmed schema (only relevant gates + components) |

Selecting between modes happens in C4 (`Prepare Classifier Input`) based on the deterministic results from C2.

Mode B saves ~50% input tokens on the most common path. Cumulative savings stack with Gemini's implicit caching.

### 8.2 System instruction (Mode A — production v1)

Identical to v2 §5.3. Reproduced here only for reference; do NOT duplicate-edit. The canonical version lives in n8n env var `RELEVANCY_SYSTEM_PROMPT_A`.

### 8.3 System instruction (Mode B — edge-only)

```
You are the Rising Lions Upwork Relevancy Classifier (edge-only mode).

The deterministic checker has already evaluated gates 1-6 and 11. Trust those results.
Your job: evaluate the LLM-only gates (7 job_availability, 8 no_location_lockin, 9 no_video_proposal) and assign a 7-component rubric score IF all gates pass.

[verbatim 13 reason labels]
[only relevant §16 examples — Job unavailable rejects, Location loc rejects, Video Proposal rejects, plus 5 high-quality proceed examples for rubric calibration]
[rubric definition]
[output rules]
```

### 8.4 Output schema (v3)

Same as v2 §5.4 with three additions:

```jsonc
{
  // ... v2 fields ...
  "request_meta": {
    "source": "auto | manual_url | shadow",
    "task_id": "string|null",
    "thresholds_used": { ... },        // snapshot of effective thresholds
    "deterministic_resolved": ["1_stack_match","2_freshness", ...],
    "llm_resolved": ["7_job_availability", ...]
  },
  "evidence_panel": {
    // human-readable bundle for the dashboard UI
    "strengths": ["Stripe + Laravel portfolio direct match", "Client $18k spent, 26 hires"],
    "weaknesses": ["12 proposals already submitted (high but under cap)"],
    "match_explanation": "Job needs Laravel + Stripe billing; profile has direct portfolio piece + multi-tenant SaaS work."
  }
}
```

`evidence_panel` is generated by the LLM (extra ~150 tokens output) when `request_meta.source = 'manual_url'` and skipped when `source = 'auto'` (the auto pipeline doesn't render UI).

### 8.5 Token optimization strategy (v3 update)

| Lever | Saving over v2 |
|---|---|
| Mode B for common deterministic-resolved path | -50% input tokens vs Mode A |
| Skip `evidence_panel` for auto pipeline | -150 output tokens |
| Skip rubric scoring on reject (already in v2) | -200 output tokens |
| Cache mode-A and mode-B system instructions separately | Each cached after first call (Gemini implicit caching applies per-instruction) |
| Truncate job description to 1500 chars (already in v2) | -15% input |

### 8.6 Calls per evaluation

| Front door | Calls | Why |
|---|---|---|
| Auto pipeline (deterministic reject) | 0 | No LLM needed |
| Auto pipeline (LLM reject after deterministic pass) | 1 | Mode A or B |
| Auto pipeline (proceed) | 1 | Mode A or B |
| Manual task-card eval | 1 | Always Mode A (paranoid; admin wants full breakdown) |
| Profile snapshot upload | 0 | Pure DB write — never invokes the classifier |

Single call per evaluation. No fan-out, no second-pass review.

---

## 9. Data Schemas

### 9.1 Already shipped: migration 017 (`upwork_profile_snapshots`)

The profile-context store is already in place. v3.2 does NOT modify migration 017. For reference (full DDL in `src/lib/migrations/017_upwork_profile_snapshots.sql`):

- `upwork_profile_snapshots` — append-only, partial unique index `WHERE is_current = TRUE` enforces "one current row per profile". Promoted hot columns (name, title, hourly_rate, rating, job_success_score, top_rated_status, total_jobs_worked, total_hours, last_worked_on, profile_url, ciphertext, skills_summary). Full Upwork JSON in `data JSONB`.
- `upwork_profile_snapshots_current` — view, default read path.
- Indexes: `idx_upwork_snapshot_profile`, `idx_upwork_snapshot_extracted_at`, `idx_upwork_snapshot_top_rated` (partial WHERE current), `idx_upwork_snapshot_skills_trgm` (GIN on skills_summary), `idx_upwork_snapshot_skills_jsonb` (GIN on data->'skills').
- `pg_trgm` extension installed.

### 9.2 New: migration 018 — relevancy scoring tables

```sql
-- Per-profile gate threshold overrides. JSONB keeps the schema flexible.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS thresholds_overrides JSONB DEFAULT '{}'::jsonb;

-- Criteria version snapshot (immutable history of PRD versions).
CREATE TABLE IF NOT EXISTS criteria_versions (
  version          TEXT PRIMARY KEY,
  prd_changelog    TEXT NOT NULL,
  thresholds       JSONB NOT NULL,                  -- snapshot of all gate thresholds at this version
  reason_enum      TEXT[] NOT NULL,                 -- snapshot of valid rejection reasons (PRD §6.2 labels, typos preserved)
  output_schema    JSONB,                           -- expected Gemini structured-output schema for this version (A10)
  prompt_versions  TEXT[],                          -- prompt versions compatible with this criteria version
  effective_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Canonical scoring log for both auto pipeline and manual evaluator.
CREATE TABLE IF NOT EXISTS relevancy_scores (
  id                BIGSERIAL PRIMARY KEY,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  job_external_id   TEXT,                                                       -- Upwork stable job ID
  profile_id        TEXT REFERENCES profiles(profile_id),
  decision          TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),
  rejection_reasons TEXT[],
  gates_passed      INTEGER[] CHECK (gates_passed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
  gates_failed      INTEGER[] CHECK (gates_failed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
  gates_evidence    JSONB,                                                      -- per-gate evidence for audit
  components        JSONB,                                                      -- 7 rubric components
  total_score       INTEGER,
  tier              TEXT,
  confidence        NUMERIC(4,3),
  confidence_warnings TEXT[],                                                   -- e.g. ['stale_snapshot','non_english_description']
  proposal_angles   TEXT[],
  evidence_panel    JSONB,                                                      -- human-readable bundle for UI (manual eval only)
  summary           TEXT,
  missing_signals   TEXT[],
  thresholds_used   JSONB,                                                      -- snapshot of effective thresholds at score time
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  prompt_mode       TEXT NOT NULL CHECK (prompt_mode IN ('A_full','B_edge')),
  criteria_version  TEXT NOT NULL REFERENCES criteria_versions(version),
  evaluation_path   TEXT NOT NULL CHECK (evaluation_path IN ('deterministic','llm','llm_after_deterministic','manual_url','shadow')),
  request_id        UUID,                                                       -- propagated from ingress; lets us trace one job end-to-end (L2)
  source            TEXT CHECK (source IN ('auto','manual_url')),
  requested_by      TEXT,                                                       -- session.user.id from server, never trusted from body (S2)
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  evaluated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rs_task        ON relevancy_scores (task_id);
CREATE INDEX IF NOT EXISTS idx_rs_profile     ON relevancy_scores (profile_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_decision    ON relevancy_scores (decision);
CREATE INDEX IF NOT EXISTS idx_rs_evaluated   ON relevancy_scores (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_source      ON relevancy_scores (source, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_request     ON relevancy_scores (request_id);

-- DLQ for failed score writes (I2 — never block the parent verdict on the audit-log write).
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

-- Manual evaluator request log.
CREATE TABLE IF NOT EXISTS manual_job_evaluations (
  id              BIGSERIAL PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id      TEXT NOT NULL REFERENCES profiles(profile_id),
  score_id        BIGINT REFERENCES relevancy_scores(id),
  requested_by    TEXT NOT NULL,
  load_status     TEXT CHECK (load_status IN ('success','partial','failed')),
  load_error      TEXT,                                                         -- when task lookup or snapshot read fails
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mje_profile ON manual_job_evaluations (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mje_task    ON manual_job_evaluations (task_id, created_at DESC);

-- Override capture: agent moves a card classifier-said-proceed to N/A (or vice versa).
CREATE TABLE IF NOT EXISTS relevancy_overrides (
  id                  BIGSERIAL PRIMARY KEY,
  score_id            BIGINT NOT NULL REFERENCES relevancy_scores(id),
  task_id             UUID NOT NULL REFERENCES tasks(id),
  classifier_decision TEXT NOT NULL,
  agent_action        TEXT NOT NULL,                                            -- e.g. 'moved_to_na', 'moved_to_proposal_submitted'
  agent_id            UUID REFERENCES agents(id),
  override_reason     TEXT[],                                                   -- multi-select, mirrors PRD §6.2 labels (typos preserved)
  source              TEXT CHECK (source IN ('auto','manual_url')),             -- snapshot of the score's source for audit filtering (E17)
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_overrides_score ON relevancy_overrides (score_id);
CREATE INDEX IF NOT EXISTS idx_overrides_task  ON relevancy_overrides (task_id, created_at DESC);

-- Bust stats cache.
DELETE FROM stats_cache;
```

What's NOT in v3.2's migration (versus v3.1):

| v3.1-planned table | v3.2 status | Why |
|---|---|---|
| `profile_stacks` | DROPPED from plan | `upwork_profile_snapshots.skills_summary` + `data->'skills'` cover this |
| `profile_portfolios` | DROPPED | `data->'portfolio'` array covers this |
| `profile_work_history` | DROPPED | `data->'workHistory'` array covers this |
| `profile_categories` | DROPPED | `data->'jobCategories'` array covers this |
| `profile_versions` | DROPPED | `upwork_profile_snapshots` history (`is_current=FALSE` rows) IS the version table |
| `skills_taxonomy` | DEFERRED to v3.3 | Trigram + JSONB containment covers stack_match deterministically without canonical slugs. Calibration data (after shadow phase) decides whether the small accuracy lift is worth the seed-curation cost. |
| `profiles.upwork_url` | DROPPED | `upwork_profile_snapshots.profile_url` covers this |
| `profiles.headline/description/hourly_rate/jss_score/top_rated/total_earnings/country/timezone` | DROPPED | Snapshot's promoted hot columns + `data` JSONB cover all of these |
| `profiles.ingest_status/last_synced_at` | DROPPED | Snapshot's `extracted_at` + the existence of an `is_current` row are the equivalent signals |

Net new objects in v3.2: 1 column (`profiles.thresholds_overrides`), 5 tables (`criteria_versions`, `relevancy_scores`, `relevancy_scores_dlq`, `manual_job_evaluations`, `relevancy_overrides`).

### 9.3 Migration 018 rollback (`018_rollback.sql`)

The forward migration is mostly additive (one column, five new tables — none of them referenced by existing rows). Rollback is safe at any time before the classifier ships:

```sql
DROP TABLE IF EXISTS relevancy_overrides;
DROP TABLE IF EXISTS manual_job_evaluations;
DROP TABLE IF EXISTS relevancy_scores_dlq;
DROP TABLE IF EXISTS relevancy_scores;
DROP TABLE IF EXISTS criteria_versions;
ALTER TABLE profiles DROP COLUMN IF EXISTS thresholds_overrides;
```

Once the classifier is live and `relevancy_scores` rows accumulate, rollback loses calibration data — see §14.6.

### 9.4 Job payload schema (canonical, used by both front doors)

See §6.2 for the full structure. The only schema-level difference between auto and manual sources is which fields are populated; the classifier handles missing fields gracefully (§6.2.2).

### 9.5 Activity log additions

```sql
-- New action types written by the dashboard / classifier
INSERT INTO activity_log (entity_type, entity_id, action, payload) VALUES
  ('profile', $profile_id::TEXT, 'profile_snapshot_uploaded', '{"extracted_at":"2026-05-08T...","skills_count":18}'),
  ('task',    $task_id::TEXT,    'relevancy_scored', '{"decision":"proceed","tier":"apply_now","total":93,"score_id":123}'),
  ('task',    $task_id::TEXT,    'relevancy_overridden', '{"score_id":123,"agent_action":"moved_to_na","reason":"Out of stack"}');
```

The override action is written by the existing `moveTaskAction` (`task-data.ts:1027`) when v3.2 ships — see Phase 17 in Appendix B.

---

## 10. Admin Dashboard Design

### 10.1 Routes

v3.2 adds only TWO new admin routes — Profile Management already exists in Settings via the snapshot drawer.

| Route | Component | Server data | Status |
|---|---|---|---|
| `/settings` → profile table → "Upwork Snapshot" drawer | `<ProfileUpworkSnapshotSheet>` | `upwork_profile_snapshots` (Current / History tabs) + Upload tab | **Already shipped** |
| `/relevancy-evaluator` | `TaskCardEvaluator` | Paste card URL + profile picker + result panel | **NEW** |
| `/relevancy-audit` | `RelevancyAudit` | Time-series, gate-fail rates, override rate, snapshot freshness | **NEW** |

Both new routes are admin-only. Agents get a redirect to `/my-dashboard`.

v3.1 routes that DROPPED in v3.2:

- `/profiles` → already covered by Settings → profile table
- `/profiles/new` → already covered by Settings → "Create Profile"
- `/profiles/:id` → already covered by `<ProfileUpworkSnapshotSheet>`
- `/profiles/:id/sync` → no sync; admin re-uploads the snapshot

### 10.2 Profile snapshot UX (existing, recap)

The shipped `<ProfileUpworkSnapshotSheet>` (mounted in Settings → profile row → "Upwork Snapshot" link) handles all profile-data UX:

- **Current tab** — shows the active snapshot's promoted columns + key data fields. Read-only.
- **History tab** — chronological list of all snapshots (current + prior). Each row links to the JSON viewer.
- **Upload tab** (admin only) — paste JSON or attach a file → calls `saveUpworkProfileSnapshotAction` which writes via the atomic CTE-INSERT data layer function.

No "Sync Now" button. Re-upload is the manual refresh mechanism.

### 10.3 Task Card Evaluator page

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Relevancy Evaluator                                                                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Task Card:  [http://157.173.110.62/tasks?task=0378386f-9717-...           ] [↻]   │
│ Profile:    [Shayan ▼]                       (Sana, Laiba, Khansa, Rebekah        │
│                                               disabled — no snapshot uploaded)    │
│                                                          [Evaluate]                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ⏳ Loading task → Loading profile context → Running classifier...                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Result rendering:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Verdict: PROCEED · Tier: apply_now · Total: 93/100 · Confidence: 0.91             │
│ Build Laravel Stripe integration for SaaS billing                                  │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Hard Gates                                                                         │
│ ✓ 1 stack_match    "job needs Laravel + Stripe; profile has both + portfolio"     │
│ ✓ 2 freshness        skipped_deterministic (posted 5h ago)                         │
│ ✓ 3 proposal_satur. skipped_deterministic (12 < 30)                                │
│ ✓ 4 hourly_floor    skipped_deterministic ($35 ≥ $25)                              │
│ ✓ 5 client_spend    skipped_deterministic ($18,355 ≥ $1,000)                      │
│ ✓ 6 client_rating   skipped_deterministic (4.97 ≥ 4.0)                            │
│ ✓ 7 job_avail.      "no 'filled' indicators in description"                        │
│ ✓ 8 location        "no residency requirement"                                     │
│ ✓ 9 video_proposal  "no video/loom mention"                                        │
│ ✓ 10 portfolio       skipped_deterministic (Stripe+Laravel piece matches)          │
│ ✓ 11 no_duplicate    skipped_deterministic                                         │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Rubric                                                                             │
│ skill_match           28/30   Laravel + Stripe both in stack and demonstrated     │
│ portfolio_evidence    20/20   Stripe + Laravel subscription billing direct mirror  │
│ client_quality        14/15   $18k spent, 26 hires, 4.97 rating — strong          │
│ competition_position   8/10   12 proposals at <2h fresh — manageable              │
│ domain_match           9/10   SaaS billing aligns with multi-tenant SaaS work     │
│ experience_level_fit   9/10   Senior request matches JSS 98 / $65/hr               │
│ red_flags              5/5    Specific scope, clear stack, no template feel       │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Top Proposal Angles                                                                │
│ 1. Lead with the Stripe + Laravel subscription billing portfolio piece            │
│ 2. Reference multi-tenant SaaS auth experience to signal billing scoping           │
│ 3. Quote a 2-week MVP with webhook + retry handling                               │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Card status today:  Column = Proposal Submitted · Assignee = Sana · Age = 3d      │
│ Auto-pipeline ran:  2026-05-06 08:14 → decision = proceed (score 91)              │
│ ⚠  Re-evaluating against `shayan` (auto-pipeline used `sana`)                      │
├────────────────────────────────────────────────────────────────────────────────────┤
│ [↻ Re-run]  [Open card in Task Board]  [Copy verdict JSON]                        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

The "Card status today" + "Auto-pipeline ran" rows let the admin compare what the classifier would say NOW (with current data + selected profile) against what it said AT INTAKE (historical Vollna run). Powerful for calibration: a card the auto pipeline scored as `proceed` that's still sitting in `Todo` 3 days later is a candidate for re-evaluation against an alternative profile, or for a snapshot refresh.

### 10.4 Relevancy Audit page

| Tile | Source query | Purpose |
|---|---|---|
| Decision distribution (proceed / reject / review) | `SELECT decision, COUNT(*) FROM relevancy_scores WHERE evaluated_at >= ?` | Sanity baseline |
| Gate-fail rate × profile × week | `SELECT profile_id, unnest(gates_failed), COUNT(*) FROM relevancy_scores GROUP BY ...` | "Is Khansa rejecting more 'Out of stack' than Sana?" (PRD §10.4) |
| Classifier-vs-agent agreement | `JOIN relevancy_scores rs ON rs.task_id = tasks.id; agreement = rs.decision='reject' AND tasks.column = N/A` | Accuracy metric |
| Override rate | `COUNT(relevancy_overrides) / COUNT(relevancy_scores) WHERE source='auto'` | "How often do agents disagree with the classifier?" |
| Latency p95 by mode | `percentile_cont(0.95) FROM relevancy_scores GROUP BY prompt_mode` | Performance SLO |
| Cost projection | `SUM(input_tokens + output_tokens) × $/token` | Monthly burn |
| Snapshot freshness × profile | `SELECT profile_id, MAX(extracted_at), COUNT(*) FROM upwork_profile_snapshots GROUP BY profile_id` | Highlights profiles overdue for a refresh |
| Manual eval volume × admin × week | `SELECT requested_by, DATE_TRUNC('week', created_at), COUNT(*) FROM manual_job_evaluations GROUP BY ...` | Who's calibrating, how often |

### 10.5 Data flow: frontend → backend → n8n

```
React Component (TaskCardEvaluator)
  │ click "Evaluate"
  ▼
useMutation(POST /api/relevancy/evaluate-task with { task_card_url, profile_id })
  │
  ▼
Next.js Route Handler
  │ - validate session (admin only)
  │ - parse task UUID from card URL (server-side regex)
  │ - look up profile snapshot (404 if missing)
  │ - rate-limit check (60/hr per admin)
  │ - generate request_id (UUID v4)
  │ - sign payload with MANUAL_EVAL_TOKEN
  ▼
n8n Webhook (job-evaluate-manual)
  │ J3 Load Task Card (httpRequest to /api/tasks/:id/job-payload)
  │ J4 Compose payload
  │ J5 Score Relevancy (executeWorkflow → _relevancy-classifier-core)
  │     C1 Load Profile Context (httpRequest to /api/profiles/:id/context)
  │     C2 Deterministic Pre-check
  │     [C3..C5] Gemini Mode A
  │     C6 Validate + Verifier
  │     C10 Persist Score (POST /api/relevancy-scores)
  │ J6 Format Verdict
  │ J7 Respond
  ▼
Next.js Route Handler returns 200 + verdict
  │
  ▼
React useMutation onSuccess → render result panel
```

All n8n → Next.js callbacks use the same `n8n-board-sync` Bearer token already in production (CLAUDE.md). The new `MANUAL_EVAL_TOKEN` only authenticates the dashboard → n8n direction (it gates the webhook entry).

---

## 11. Performance + Cost Considerations

### 11.1 Cost summary

| Service | Driver | Monthly cost @ baseline (40 jobs/day, 8 profiles) |
|---|---|---|
| Gemini Flash 2.5 (auto pipeline) | ~780 LLM calls/month (60% × 1300 jobs) | ~$5.60 |
| Gemini Flash 2.5 (manual evals) | 300 calls/month, full Mode A | ~$2.40 |
| Postgres (Contabo) | Existing infra | $0 incremental |
| n8n cloud | Existing | $0 incremental |
| **Total monthly** | | **~$5–8** |

Scales linearly with traffic. At 400 jobs/day (10× baseline) → ~$50-80/month, all Gemini.

Compared to v3.1 (~$14–20/mo with Apify), v3.2 is ~2-3× cheaper at baseline. The savings free up budget for higher-tier Gemini models (e.g. Gemini 2.5 Pro for the manual evaluator) if calibration data shows accuracy gaps.

### 11.2 Latency budget (v3.2 fresh, no cache)

| Front door | Target p95 | Stages |
|---|---|---|
| Auto pipeline (deterministic reject) | ~250ms | C1 + C2 + write |
| Auto pipeline (LLM proceed) | ~1.5s | C1 + C2 + C5 + write |
| Manual task-card eval (deterministic reject) | ~500ms | J3 (DB) + C1 + C2 + write |
| Manual task-card eval (LLM proceed) | ~1.3-2s | J3 + C1 + C2 + C5 + write |
| Profile snapshot upload (UI) | ~1s | one INSERT + cache bust |
| Profile snapshot upload (CLI) | ~500ms | direct data-layer call |

The auto pipeline stays inside the existing 5-20s end-to-end PRD §10.4 budget. The dominant tail is Vollna (memory `latency_vollna_bound.md`: p95 = 10 minutes) — adding the classifier adds <2s, which is invisible against that tail.

The manual evaluator is **roughly an order of magnitude faster than v3.1** because no external scrape is involved. Both `/api/tasks/:id/job-payload` and the snapshot view read are single-row Postgres lookups.

### 11.3 Throughput

- Gemini: 1000 RPM, 1M tokens/min. We're at ~30-50 RPM peak. Plenty.
- n8n cloud workflow: ~10 RPS sustained. Plenty.
- Postgres: writes are tiny (<10 KB/scoring). Reads on `tasks.custom_fields` and `upwork_profile_snapshots_current` are sub-millisecond at our scale.
- Manual evaluator concurrency cap: 60/hr per admin user (rate-limit, §16.3 R1). Aggregate cap is governed by Gemini quota, not our infra.

### 11.4 Caching strategy

| Layer | What | TTL | Invalidator |
|---|---|---|---|
| Next.js `unstable_cache` | `/api/profiles/:id/context` response | 5 min, tagged `profile-context-<id>` | `revalidateTag` on `saveUpworkProfileSnapshotAction` success |
| Next.js `unstable_cache` | `/api/tasks/:id/job-payload` response | 30 sec | `revalidateTag` on `moveTaskAction` (column change can flip card status) |
| n8n static data | Profile context fallback | 1 hour | None (TTL only) |
| Gemini implicit cache | System instruction (Mode A & B separately) | Provider-managed | None |
| Postgres query cache | `relevancy_scores` aggregates for audit page | 60s | None (read-only analytics) |

### 11.5 Observability hooks

| Signal | Source | Surface |
|---|---|---|
| Per-call token + latency | C10 → relevancy_scores | Audit page |
| Override rate weekly | View on `relevancy_overrides` | Audit page |
| Stale snapshot alert | `upwork_profile_snapshots_current WHERE extracted_at < NOW() - INTERVAL '60 days'` | Admin nav badge + audit tile |
| Missing-snapshot alert | `profiles WHERE active = TRUE AND profile_id NOT IN (SELECT profile_id FROM upwork_profile_snapshots_current)` | Settings page + audit tile |
| Gemini error rate | n8n executions filter | n8n exec page; alert if > 5%/day |
| DLQ depth | `relevancy_scores_dlq WHERE resolved_at IS NULL` | Audit page; alert at >10 unresolved |
| Manual eval load failures | `manual_job_evaluations WHERE load_status = 'failed'` | Audit page; alert at >5%/week |

### 11.6 Failure modes & blast radius

| Failure | Blast | Mitigation |
|---|---|---|
| Gemini API down | Auto pipeline + manual evals fall to `decision='review'` with `_errorDetail='gemini_unavailable'`; cards still flow but unscored | Existing v2 behavior: review queue, no silent loss. Kill-switch (§13.5) reverts to v2-pre-classifier behavior in <30s. |
| Postgres write fails (relevancy_scores) | Verdict still returned to caller; row goes to `relevancy_scores_dlq` for retry | Background worker drains DLQ every 30s for 10 min, then escalates. Alert. |
| Snapshot missing for chosen profile | Manual eval returns 422 with `profile_snapshot_missing` | UI shows the snapshot upload CTA inline. Auto pipeline never hits this — it routes by profile name set upstream by `Process Job`. |
| Snapshot stale (>60 days) | Classifier scores normally, adds `confidence_warnings: ['stale_snapshot']` | Audit page badge; admin re-uploads when convenient |
| Task card not found (manual eval) | Endpoint returns 422 with `task_not_found` | UI shows a clear error. Likely cause: admin pasted a stale URL after the card was deleted. |
| Task card has no `_job_id` (manual card) | Classifier treats as `unverified` for Gate 11 (no_duplicate); other gates work normally | Documented in §6.2.2. Manual cards are scoreable; results flagged with `missing_signals: ['job_id']`. |
| n8n cloud unreachable | Manual evaluator returns 502; auto pipeline backs up at Vollna webhooks (existing behavior) | Status banner. Both surfaces recover automatically when n8n returns. |
| Migration 018 column-add failure | Dashboard partial deploy | Migration 018 is fully additive + idempotent. Roll back via `018_rollback.sql` (only safe if `relevancy_scores` is empty — see §14.6). |

---

## 12. Future Enhancements

### 12.1 v3.x (post-launch, low effort)

| # | Enhancement | Effort | Trigger |
|---|---|---|---|
| 1 | Bulk re-evaluation: select N task cards from audit page, re-score against the chosen profile | 4h | Calibration after a snapshot upload |
| 2 | "Why did this fail?" deep-dive: click a failed gate in audit, see all examples | 1d | Calibration cycles |
| 3 | Slack notification on apply_now tier (per-profile opt-in) | 4h | PRD §10.5 v1 |
| 4 | A/B prompt versioning (10% to v_next, compare outcomes) | 2d | Tuning rubric weights |
| 5 | Snapshot freshness reminders: auto-Slack the admin when any active profile's snapshot crosses 60 / 90 days | 4h | Operational hygiene |
| 6 | Cron-based shadow scoring of Vollna jobs that bypassed n8n | 1d | Data completeness |

### 12.2 v4 (medium effort)

| # | Enhancement | Effort | Why |
|---|---|---|---|
| 1 | Skills taxonomy + canonicalization layer (revisit if calibration shows accuracy gaps) | 3-5d | Tighter gate-1 deterministic path; cross-profile skill rollups |
| 2 | Skill-level win-rate analytics (post PRD §9.3 fix) | 1w | "Which skills convert?" |
| 3 | Vollna feed auto-tightening: take recurring `Out of stack` keywords and propose Vollna config edits | 1w | PRD §10.6 |
| 4 | Cross-platform support (Freelancer, Fiverr) — alternative snapshot extractors + custom_fields shapes | 2w | Demand-driven |
| 5 | Live job-watcher: monitor a saved search URL hourly, evaluate each new job, alert on apply_now | 1w (requires reintroducing scraping) | Premium positioning |
| 6 | Auto snapshot extractor: replace manual HTML save with a headless-browser job (Playwright) that re-scrapes a profile's Upwork page on a schedule | 1-2w | Reduce admin toil; only worth doing if v3.2 calibration shows snapshot staleness is a real problem |

### 12.3 Out of v3 scope (carry from v2)

- Replacing the Proposal Writer (still Claude Haiku 4.5)
- Multi-LLM ensemble
- Embedding-based portfolio matching (lexical + LLM is enough at this scale)

---

## 13. Production Readiness & n8n Update Strategy

The v3 plan splices into the **live** workflow `EWnZg3svZWwcIRs4` that currently processes ~40 jobs/day end-to-end (Vollna → ClickUp Task Board). Any change must preserve existing functionality. This section documents the safe-update protocol and the operational guardrails missing from v2.

### 13.1 Safe n8n workflow update protocol

Every change to `EWnZg3svZWwcIRs4` (or any production workflow) MUST follow this order. The `n8n-workflow-keeper` agent is the only sanctioned executor.

**Pre-flight (before any edit):**

1. **Snapshot current state** — call `n8n_get_workflow` and write the result to `docs/multiple-webhooks-<YYYY-MM-DD-HHMM>-pre-update.json`. Commit before the edit lands.
2. **Pull `n8n_workflow_versions`** — record `versionId` for fast revert via the n8n UI.
3. **Verify the stable backup exists** — `docs/multiple webhooks (07-05-2026 working).json` must be present and parseable. This is the canonical fallback (see §14).
4. **`n8n_validate_workflow`** on the current state to catch pre-existing errors before our edit gets blamed for them.
5. **Pause Vollna feeds** for high-risk changes (anything touching `Process Job`, `Route Job`, or `Merge All Webhooks`). For low-risk additive splices (new sub-workflow invocation), keep traffic flowing but watch executions.

**Edit:**

6. **Always use `n8n_update_partial_workflow`** with explicit `addNode`, `addConnection`, `updateNode`, `removeConnection` operations. NEVER use `n8n_update_full_workflow` for incremental edits — it overwrites position metadata, destroys sticky notes, and makes diffs unreviewable. `n8n_update_full_workflow` is reserved for rollback (§14) only.
7. **Pin every new node's `typeVersion`** explicitly. The n8n keeper agent has node-version compatibility memory; trust it but verify with `mcp__n8n-mcp__get_node` if unsure.
8. **Set `onError` explicitly** on every new HTTP / Apify / executeWorkflow node. Default to `continueRegularOutput` for sinks (don't block pipeline on a logging failure) and `continueErrorOutput` for fetches that have a fallback path. Never leave it implicit.
9. **No inline secrets.** All API tokens reference n8n credentials by ID. Ingest tokens live in the `Header Auth` credential type.
10. **Wire one branch at a time.** A 3-node splice gets shipped in 3 partial updates with validation between each, not one big diff.

**Post-flight:**

11. **`n8n_validate_workflow`** after every partial update. Reject the change if any error severity surfaces.
12. **`n8n_test_workflow`** with a known-good fixture (a recent successful execution from the n8n exec log) to confirm the splice doesn't break the happy path.
13. **Watch executions for 1 hour** post-deploy. Any new error pattern → revert via §14.
14. **Update `docs/n8n_workflow_prd.md`** with: new node names, IDs, typeVersions, position coordinates, and a one-line purpose. Update `CLAUDE.md` § "n8n Integration" if the topology changed.
15. **Tag the success** — call `n8n_get_workflow` again, write `docs/multiple-webhooks-<date>-stable.json`, and commit. The newest stable file becomes the next §14 rollback target after a 7-day soak.

### 13.2 Documentation standard for new n8n nodes

Every new node MUST be paired with:

| Artifact | Where | Purpose |
|---|---|---|
| **Sticky note** | n8n canvas, adjacent to the node | One paragraph: purpose, inputs, outputs, failure modes |
| **PRD entry** | `docs/n8n_workflow_prd.md` § "Nodes" | Permanent record |
| **CLAUDE.md gotcha** | `CLAUDE.md` § "n8n Integration Gotchas" | Only if the node has a non-obvious constraint (e.g., "Merge v3.2 only — do not downgrade") |
| **Memory entry** | `n8n_multiple_webhooks_workflow.md` | If the node represents a topology change |

The n8n-workflow-keeper agent enforces this as part of every successful change.

### 13.3 Workflow ownership matrix

| Workflow | Risk class | Edit gate | Pause traffic? |
|---|---|---|---|
| `EWnZg3svZWwcIRs4` (Vollna auto-pipeline) | **HIGH** — live revenue path | n8n-workflow-keeper + signed-off by user | Yes, for `Process Job` / `Route Job` / `Merge` edits |
| `_relevancy-classifier-core` (NEW) | Medium — but invoked by HIGH | Same as above | No (parent fails open to `review`) |
| `job-evaluate-manual` (NEW) | Low — admin tool | n8n-keeper | No |

### 13.4 Migration 018 update strategy

- **Idempotency** — every `CREATE TABLE` uses `IF NOT EXISTS`; the single `ALTER TABLE` uses `ADD COLUMN IF NOT EXISTS`. Re-runs are safe.
- **Order** — run migration 018 BEFORE deploying any code that reads the new tables. The tables are net-new so there's no old-row interaction concern.
- **Forward compatibility** — code MUST treat `relevancy_scores` rows as optional (a card can exist without a score) for one full deploy cycle. This is a permanent state, not transitional — manually-created cards never get an auto-pipeline score.
- **Rollback** — `018_rollback.sql` drops all five new tables and removes the `thresholds_overrides` column. Safe BEFORE any score is written; loses calibration data after.
- **Pre-deploy snapshot** — `pg_dump` the affected schemas (mostly empty pre-migration) to a timestamped file in `/var/backups/postgres/` on Contabo before applying. Migration 017 is already shipped — do NOT re-run or re-snapshot it.

### 13.5 Shadow-mode rollout (Phase 12 expansion)

Phase 12 in Appendix B says "Shadow rollout, 1 week, write to log only." Operationalized:

1. `Score Relevancy` node ships with `decision` output **NOT WIRED** to the routing branch. The IF after it stays on its v0 (`{{$json.decision === 'proceed'}}`) but downstream of that IF, both branches go to `Build GPT Input` — i.e. the classifier opinion is recorded but ignored.
2. `relevancy_scores` rows accumulate with `evaluation_path = 'shadow'`.
3. Daily review by Waqas: pivot decisions × actual agent action 24h later. If classifier-says-reject + agent-moves-to-N/A agreement ≥ 85% on Day 7 → flip to active routing (Phase 14).
4. A kill-switch n8n env var `RELEVANCY_CLASSIFIER_ENABLED` (boolean) lets the parent workflow short-circuit the executeWorkflow node if anything goes sideways. Default: `true`. The IF before `Score Relevancy` reads `$env.RELEVANCY_CLASSIFIER_ENABLED !== 'false'`. Toggling to `false` reverts to v2 behavior in <30s without redeploy.

---

## 14. Rollback Strategy

> **If any workflow update breaks functionality, immediately revert using:**
> **`docs/multiple webhooks (07-05-2026 working).json`**
>
> **Treat this file as the stable backup workflow. Always export workflow backups before major updates.**

### 14.1 Trigger conditions

Roll back when ANY of the following is observed within the first hour after a deploy:

- `n8n_validate_workflow` reports new errors not present pre-deploy
- New executions show error rate > 5% (where pre-deploy was <1%)
- Vollna jobs stop landing on the Task Board (zero board-task creates in 15 min during business hours)
- Dashboard `/api/webhook/n8n` 4xx/5xx rate exceeds 10/min
- Gemini error rate >10% over 50+ calls
- DLQ depth (`relevancy_scores_dlq WHERE resolved_at IS NULL`) climbs above 50 in 1 hour
- Manual evaluator `load_status='failed'` rate exceeds 20% over 50+ requests
- Any human report: "no proposals are getting drafted"
- The `RELEVANCY_CLASSIFIER_ENABLED` kill-switch (§13.5) doesn't restore healthy behavior within 5 minutes

### 14.2 Rollback procedure (n8n workflow)

```
# Step 1 — pause incoming traffic
- Disable all 8 Vollna webhook entries on Vollna's side (or set
  RELEVANCY_CLASSIFIER_ENABLED=false if only the splice is broken)

# Step 2 — restore the stable workflow snapshot
- Read docs/multiple webhooks (07-05-2026 working).json
- Use n8n_update_full_workflow with the JSON contents
  (this is the ONLY sanctioned use of n8n_update_full_workflow)
- The file represents the validated workflow as of 2026-05-07

# Step 3 — validate
- n8n_validate_workflow → expect 0 errors
- n8n_workflow_versions → confirm new version pointer

# Step 4 — smoke test
- Fire a synthetic Vollna webhook with a known-good fixture
- Confirm one Task Board card lands within 60s
- Confirm /api/webhook/n8n receives the matching dashboard event

# Step 5 — re-enable traffic
- Re-enable Vollna webhooks (or unset the kill-switch)

# Step 6 — post-mortem
- Tag the failed forward-deploy in commit history
- Write a memory entry under E--laragon-www-sales-dashboard/memory/
- Update docs/n8n_workflow_prd.md changelog
```

### 14.3 Rollback procedure (database, migration 018)

Migration 017 (`upwork_profile_snapshots`) is already shipped and IS NOT a v3.2 rollback target — never drop it. The relevant rollback target is migration 018 (the relevancy-scoring tables added by this plan).

Migration 018 is fully additive. A true rollback (drop tables, drop the column) is only safe if NO score has been written:

```
# Only if zero relevancy_scores rows exist AND zero relevancy_scores_dlq rows exist
psql -f src/lib/migrations/018_rollback.sql
```

If `relevancy_scores` has rows → do NOT drop. Instead:
- Stop reads (revert dashboard code first)
- Leave tables in place; they're inert until something queries them
- The `profiles.thresholds_overrides` column (nullable, default `'{}'::jsonb`) is harmless and never needs to be dropped.

### 14.4 Rollback procedure (admin dashboard)

```
git revert <commit-hash>
# Vercel: auto-deploys on push (Vercel decommissioned per CLAUDE.md but kept here for completeness)
# Contabo: GitHub Actions deploys on push to main
# Verify: curl http://157.173.110.62/api/health
```

If the rollback commit reintroduces a different bug:
- `git push origin main --force-with-lease` is permitted ONLY with explicit user approval
- Otherwise create a forward fix

### 14.5 Backup discipline

| Backup | When created | Retention | Purpose |
|---|---|---|---|
| `docs/multiple webhooks (07-05-2026 working).json` | Pre-v3 baseline | Permanent | Stable rollback target until next 7-day-soak success |
| `docs/multiple-webhooks-<date>-pre-update.json` | Before each partial update | 30 days, then archive | Per-change rollback |
| `docs/multiple-webhooks-<date>-stable.json` | After 7-day soak with no incidents | Permanent (replaces previous stable) | New rollback baseline |
| `n8n_workflow_versions` | Automatic (n8n cloud) | Provider-managed | Quick UI revert |
| `pg_dump` snapshot | Before migration 018 | 90 days | DB rollback |

The "newest stable" rule: only one file at a time has the `(working)` suffix. After a 7-day-clean window, rename the new snapshot, archive the previous stable, and update `CLAUDE.md` and the rollback memory entry to point at the new file.

### 14.6 What MUST NOT be rolled back

- Migration 017 (`upwork_profile_snapshots` + view + indexes). Already shipped and serving production reads.
- The `profiles.thresholds_overrides` column (nullable, default `'{}'::jsonb`, harmless).
- `criteria_versions` rows (append-only audit history).
- `relevancy_scores` rows in shadow mode (observation-only — losing them loses calibration evidence).
- `upwork_profile_snapshots` rows of any kind (uploaded by humans; non-reproducible without re-uploading).

Rolling any of these back loses irreplaceable evidence with no upside.

---

## 15. Execution Requirements

The user (Waqas) MUST provide the following before Phase 1 of Appendix B can start. This list is exhaustive — engineering will block on any missing item.

### 15.1 API keys & secrets

v3.2 needs FEWER secrets than v3.1 (no Apify, no profile-ingest/sync workflows).

| Secret | Provider | Where it lives | Used by |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | n8n credentials | `_relevancy-classifier-core` |
| `MANUAL_EVAL_TOKEN` | Generated (32-byte random) | n8n Header Auth credential + dashboard env | Webhook auth on `job-evaluate-manual` |
| `CRITERIA_PRD_VERSION` | Hardcoded `0.2` | n8n env | Embedded in classifier prompt; mirrors `criteria_versions.version` |
| `RELEVANCY_CLASSIFIER_ENABLED` | Boolean | n8n env | Kill-switch (§13.5) |
| `GEMINI_DAILY_TOKEN_CAP` | Integer (default 1,000,000) | Dashboard env | Cost guard alert threshold |
| `RATE_LIMIT_BACKEND` | `postgres` \| `upstash` (default `postgres`) | Dashboard env | Manual evaluator rate limiting |
| `SNAPSHOT_STALE_DAYS_WARN` | Integer (default 30) | Dashboard env | Audit page snapshot freshness threshold |
| `N8N_API_KEY` | n8n cloud | Dashboard env (already present) | n8n MCP / partial-update operations |
| `N8N_API_URL` | `https://ikonicdev.app.n8n.cloud/api/v1` | Dashboard env (already present) | Same |
| `n8n-board-sync` Bearer | Existing | Dashboard env (already present) | n8n → Next.js callbacks |
| `N8N_WEBHOOK_SECRET` | Existing | Dashboard env (already present) | HMAC signing on n8n → /api/webhook/n8n callbacks |
| (Optional) `SLACK_ALERT_WEBHOOK` | Slack | Dashboard env | Relevancy + DLQ + stale-snapshot alerts |
| (Optional) `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash | Dashboard env | Only needed if `RATE_LIMIT_BACKEND=upstash` |

Net new secrets to provision for v3.2: **2** (`GEMINI_API_KEY`, `MANUAL_EVAL_TOKEN`). Everything else is either already present or has a sensible default.

### 15.2 Third-party accounts

| Account | Plan | Why | Cost ceiling |
|---|---|---|---|
| **Google AI Studio** | Free tier OK at current volume | Gemini Flash 2.5. Move to paid if traffic >10× baseline. | N/A on free; budget alert at $20/mo if paid |
| **Slack** (optional) | Existing workspace | Alerting | Free |
| **Upstash** (optional) | Free tier OK | Only needed if Postgres-backed rate-limit hits scale issues | Free tier covers ~10k req/day |

Net new accounts: **1** (Google AI Studio — anyone on the team can provision the API key in 5 minutes).

### 15.3 Infrastructure access

| Resource | Status | Notes |
|---|---|---|
| Contabo SSH | Already in memory | `id_ed25519` key path documented |
| Postgres write access on Contabo | Already configured | DATABASE_URL in env |
| n8n MCP server | Already configured | Memory `n8n_mcp_server.md` |
| GitHub repo write | User has admin | Required for migration push + dashboard deploy |
| Vercel | **Decommissioned 2026-04-29** | Skip Vercel-targeting steps unless user reverses decision |

### 15.4 Decisions required from user (Appendix A blockers)

These MUST be resolved before Phase 1 begins:

| # | Question | Decision needed | Recommendation |
|---|---|---|---|
| 1 | Snapshot freshness policy | Block scoring when snapshot is older than N days, or always score with a warning? | v3.2 default: warn at 30 days, never block (admin owns refresh cadence) |
| 2 | Profile-thresholds storage | JSONB column vs dedicated table | v3.2 picks JSONB on `profiles.thresholds_overrides`; user confirms |
| 3 | Manual eval against `active=false` profiles allowed? | Yes/No | v3.2 default: yes |
| 4 | Override "why" prompt | Optional input vs required | v3.2 default: optional |
| 5 | Skills taxonomy | Build now (curate ~500 slugs) vs defer to v3.3 if calibration shows accuracy gaps | v3.2 default: defer (snapshot's `skills_summary` ILIKE + JSONB containment is sufficient for the deterministic gate-1 path) |
| 6 | Reason label typo migration timing | Pre-launch vs post-shadow | v3.2 default: post-shadow |
| 7 | Manual eval against cards on a different profile than the auto-pipeline used | Block, warn, or allow silently | v3.2 default: warn (yellow note in result panel) |
| 8 | Rate-limit backend | Postgres-backed counter vs Upstash Redis | v3.2 default: Postgres (no extra service); switch to Upstash if scale issues |
| 9 | Re-evaluation idempotency | Each click writes a new score, OR replaces the most-recent score for `(task_id, profile_id)` | v3.2 default: append (each eval is a separate row; audit page treats most-recent as canonical) |

### 15.5 Stakeholder sign-offs

- **PRD freeze** — `docs/job_relevancy_criteria_prd.md` v0.2 (already signed per current state).
- **Vollna pause window approval** — for high-risk n8n splices and shadow-rollout calibration cycles.
- **Per-agent threshold approvals** — each agent (or owner) signs off on their `thresholds_overrides` JSONB before active rollout.
- **Cost ceilings** — explicit Apify + Gemini monthly cap from Waqas.

### 15.6 Things that are NOT required from the user

For clarity on scope:

- **No Apify account, no Apify API token, no Upwork scraping infra.** v3.2's profile data comes from the existing `upwork_profile_snapshots` table (admin-uploaded JSON). v3.2's job data comes from existing `tasks.custom_fields` (Vollna-driven, already populated). Neither requires any external service.
- **No `apify/upwork-public-profile-scraper` or `epctex/upwork-scraper` evaluation.** No actor selection spike. No actor-output schema validation.
- ClickUp credentials — ClickUp is fully decommissioned (see CLAUDE.md). Do not request.
- New Vercel env vars — Vercel is decommissioned.
- New Postgres database — uses existing Contabo Postgres.
- Custom n8n hosting — uses existing n8n cloud.
- New domain or SSL — Contabo over HTTP; HTTPS is post-domain (CLAUDE.md).
- **No new admin UI for profile management.** The existing Settings → profile table + `<ProfileUpworkSnapshotSheet>` drawer covers all profile CRUD and snapshot upload. v3.2 only adds two new pages: `/relevancy-evaluator` and `/relevancy-audit`.

---

## 16. Identified Gaps & Production-Readiness Recommendations

This section catalogs gaps in v3.2 and provides actionable recommendations. Every recommendation is non-breaking for existing functionality. Apify-related items from v3.1 are removed.

### 16.1 Security hardening

| # | Gap | Risk | Recommendation |
|---|---|---|---|
| S2 | `requested_by` taken from request body | Spoofable — could falsely attribute manual evals | Always derive `requested_by` from `getServerSession()`, never from body. Body field, if present, is ignored. |
| S3 | HMAC signing on n8n → Next.js callbacks not detailed | Replay risk on `/api/webhook/n8n` and the new callback endpoints | Document the signing scheme: `X-Signature: sha256=<hmac(body, secret)>` + `X-Timestamp` + 5-min replay window. Reject duplicates by `(timestamp, hash)` cache (Redis or in-process LRU). |
| S4 | No rotation policy for `MANUAL_EVAL_TOKEN`, `n8n-board-sync`, `N8N_WEBHOOK_SECRET` | Long-lived secrets are exposure-prone | Rotate every 90 days. Store rotation date in n8n env metadata. Issue with `crypto.randomBytes(32).toString('hex')`. |
| S5 | No CSRF on admin POST forms (`/relevancy-evaluator`) | CSRF can fire actions on behalf of logged-in admin | NextAuth v5 ships CSRF tokens for credentials flow; ensure they're applied to all admin POSTs (Server Actions handle this automatically — explicit fetch calls do NOT). |
| S6 | Job description / portfolio description / snapshot description rendered in HTML | XSS risk if uploaded snapshot or Vollna feed contains malicious content | Always render via React (escapes by default). NEVER use `dangerouslySetInnerHTML` on snapshot or task-card content. If a description contains markdown, sanitize via `dompurify` first. |
| S7 | Task card URL length unbounded | DoS via giant URL | Server-side validate ≤2048 chars. |
| S8 | `/api/tasks/:id/job-payload` auth | If the endpoint is exposed without admin/agent gate, it leaks job + client info | Require admin session OR `n8n-board-sync` Bearer (already gated by middleware). Add explicit `getServerSession()` check at the route handler entry. |
| S9 | PII in logs (job descriptions, snapshot bios, client info) | Privacy leak | Scrub `description`, `feedback_text`, `headline`, `client.country`, `client.total_spent` from log payloads. Log only IDs + outcome. |
| S10 | No data retention policy | `relevancy_scores`, `manual_job_evaluations`, `relevancy_overrides`, `activity_log` grow unbounded | 12-month retention on `relevancy_scores` + `manual_job_evaluations` + `relevancy_overrides`, 180-day on `activity_log`. Add nightly prune cron. |
| S11 | No PII export/erasure pathway for snapshot data | If the Upwork user requests deletion, no defined process | Document: profile owner can call `DELETE /api/profiles/:id/upwork-snapshots` which wipes ALL snapshot rows for that profile but keeps the dashboard `profiles` row (agent assignments, scoring history). |

### 16.2 Validation & schema enforcement

| # | Gap | Recommendation |
|---|---|---|
| V1 | No Zod schemas on API request bodies | Define a shared Zod schema per endpoint in `src/lib/relevancy/schemas.ts`. Reuse server + client. |
| V2 | Snapshot JSON trusted blindly at upload time | Wrap `saveUpworkProfileSnapshotAction` input in a Zod schema covering the full v3.2 §5.3 shape. On failure, reject upload with a precise field-level error. |
| V4 | Task card URL pattern check is client-only | Server re-validates `^https?://[^/]+/(tasks\|my-tasks)\?task=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`. Raw UUIDs (no host/path) also accepted. Anything else → 400. |
| V7 | `gates_failed[]` may contain out-of-range gate IDs | DB CHECK constraint `gates_failed <@ ARRAY[1..11]` (already in §9.2 schema). |
| V8 | `decision` enum not enforced at app layer | Centralize in a TypeScript const: `export const DECISIONS = ['proceed','reject','review'] as const`. Use `z.enum(DECISIONS)` everywhere. |
| V9 | TEXT columns unbounded | Cap at app layer: title 200, description 5000, etc. Reject snapshot uploads where any free-text field exceeds the cap (Upwork doesn't generate them; means upload is malformed). |
| V10 | `relevancy_scores.criteria_version` not foreign-keyed | Already added in §9.2 schema as `REFERENCES criteria_versions(version)`. |
| V11 | Profile picker can submit a `profile_id` for a profile without a current snapshot | Server-side: 422 with `profile_snapshot_missing` if `upwork_profile_snapshots_current` has no row for the profile. UI disables the picker option but server must verify. |
| V12 | Task lookup must be authorized | Server-side: confirm the admin has access to the workspace/project the task belongs to (existing middleware should cover this; add explicit check at the job-payload endpoint). |

### 16.3 Rate limiting & cost caps

| # | Gap | Recommendation |
|---|---|---|
| R1 | No rate limit on `/api/relevancy/evaluate-task` | Cap admin manual evals at 60/hr, 300/day per admin user. Use `@upstash/ratelimit` or in-process Postgres-backed counter (selected by `RATE_LIMIT_BACKEND`). Returns 429 with `Retry-After`. |
| R2 | No rate limit on snapshot uploads | Cap admin snapshot uploads at 30/profile/hour. Prevents accidental flapping. |
| R4 | No Gemini quota guard | Track `SUM(input_tokens + output_tokens)` per day from `relevancy_scores`; alert at 80% of `GEMINI_DAILY_TOKEN_CAP`. |
| R6 | No spam detection on "Re-run" button | Same admin clicking 5× in 30s → rate limit at 6/min/task per admin. |

### 16.4 Idempotency & retry handling

| # | Gap | Recommendation |
|---|---|---|
| I1 | n8n callback POSTs lack idempotency keys | Every n8n → Next.js POST sends `X-Idempotency-Key: <uuid>` (n8n generates per execution). Server caches `(key, response)` for 24h; replay returns cached response. |
| I2 | `Persist Relevancy Score` (C10) is fire-and-forget | Switch `neverError: true` so verdict is returned to caller even if write lags. Failed writes go to `relevancy_scores_dlq` for retry. |
| I3 | No exponential backoff on transient n8n → Next.js callback failures | n8n's built-in retry: `retryOnFail: true`, `waitBetweenTries: 2000`, `maxTries: 3`. Apply to all C10 writes. |
| I5 | Manual eval double-submit creates duplicate `manual_job_evaluations` rows | Server enforces an idempotency window: same `(task_id, profile_id, requested_by)` within 30s returns the prior row instead of writing a new one. Re-runs after 30s are intentional and DO write a new row. |
| I6 | Manual eval mid-flight if admin closes tab | Server kicks off n8n call regardless; UI on revisit can hydrate from `manual_job_evaluations` history. Don't tie completion to client connection. |
| I7 | n8n executeWorkflow retries on transient failure not configured | Configure `retryOnFail: true, maxTries: 2, waitBetweenTries: 1500` on the `Score Relevancy` node in `job-evaluate-manual`. |
| I8 | Snapshot upload mid-flight crash | `saveUpworkProfileSnapshot` is already a single CTE-INSERT (atomic). If the upload retries, the unique partial index `WHERE is_current=TRUE` ensures we never end up with two current rows. |

### 16.5 Logging & monitoring

| # | Gap | Recommendation |
|---|---|---|
| L1 | No structured logging | Use `pino` in Next.js with JSON output. Required fields: `timestamp`, `request_id`, `route`, `user_id`, `latency_ms`, `outcome`. |
| L2 | No request ID propagation | Generate `X-Request-Id` at ingress. Forward through n8n header, persist on `relevancy_scores.request_id`. Lets you trace one job end-to-end. |
| L3 | No alerts on Gemini error spike | Add a check: `SELECT COUNT(*) FROM relevancy_scores WHERE evaluated_at > NOW() - INTERVAL '15 min' AND model='gemini-2.5-flash' AND decision IS NULL`. Alert if >5% over a 15-min window. |
| L4 | No cost dashboard | Audit page tile: "This month's spend = Gemini tokens × $0.075/1M". Live read-out from `relevancy_scores`. |
| L5 | No Slack alert pipeline | Reuse existing `src/lib/alerts.ts` Slack client. New event types: `RELEVANCY_OVERRIDE_RATE_HIGH`, `STALE_SNAPSHOTS`, `GEMINI_QUOTA_NEAR`, `RELEVANCY_DLQ_BACKLOG`, `MANUAL_EVAL_FAILURE_BURST`. |
| L6 | Activity log unbounded | 180-day retention prune cron. |
| L7 | No SLO definition | Documented SLOs: manual eval p95 ≤ 3s, manual eval error rate ≤ 2%, classifier-vs-agent agreement ≥ 85%, DLQ depth p99 < 10. Audit page tracks all four. |
| L8 | Score-to-task traceability missing | Audit page: "Lookup by task ID or job ID" search box. Returns the score row + linked task + override (if any) + activity timeline. |
| L9 | No prompt-version change audit | Insert a `criteria_versions` row whenever PRD bumps. Audit page shows a vertical timeline of prompt + criteria version changes overlaid on decision-distribution charts. |
| L10 | No cost-per-decision metric | `SELECT decision, AVG((input_tokens + output_tokens) * cost_per_token) FROM relevancy_scores GROUP BY decision`. Identifies whether rejects are cheaper than proceeds (they should be, given Mode B). |
| L11 | No snapshot-staleness telemetry | Audit page: "Snapshots > 30 / 60 / 90 days old" tile. Slack alerts when any active profile crosses 90 days without an update. |

### 16.6 Data consistency & atomicity

| # | Gap | Recommendation |
|---|---|---|
| D2 | `relevancy_scores` doesn't link back to the snapshot row used | Add `snapshot_id UUID REFERENCES upwork_profile_snapshots(id)` (nullable, set at score time). Lets calibration cycles "what snapshot did the classifier see?" without ambiguity. |
| D4 | Override capture relies on `moveTaskAction` instrumentation | Document: any task move that bypasses `moveTaskAction` (raw `PATCH /api/tasks/:id/move`) misses override capture (same caveat as funnel — see CLAUDE.md "Funnel KPIs"). Either lock down the raw endpoint or instrument it too. |
| D6 | Re-evaluation race: same `(task_id, profile_id)` clicked twice in <500ms | Both writes succeed; audit page just treats the most-recent as canonical. Acceptable. If rate-limit (R6) is in place, this is bounded at 6/min/task anyway. |
| D7 | Snapshot upload concurrent with classifier read | The CTE-INSERT (data-layer `saveUpworkProfileSnapshot`) is atomic; readers see either old current OR new current, never both, never neither. No additional locking needed. |
| D9 | `criteria_versions.output_schema` drift between deploys | Add a CI check: dashboard build must verify the prompt version embedded in `_relevancy-classifier-core` matches `criteria_versions.prompt_versions[]` for the current `CRITERIA_PRD_VERSION`. |

### 16.7 AI scoring quality controls

| # | Gap | Recommendation |
|---|---|---|
| A1 | No retry on Gemini parse-fail beyond once | After 1 retry, fall back to Mode A (full prompt) regardless of input. After Mode A fails too, return `decision='review'` with `_errorDetail` set. Never silently default to `proceed`. |
| A2 | No model fallback if Gemini Flash 2.5 is unavailable | Secondary: Gemini Flash 2.5 8B (cheaper, slower); tertiary: Claude Haiku 4.5 via existing Anthropic credential. Document fallback in `_relevancy-classifier-core` README. |
| A3 | Gemini hallucination on gate evidence (e.g. claims gate 9 passed when "loom" is in description) | Lightweight verifier in C6: regex-scan job description for {`loom`, `video`, `screen recording`, `record yourself`}; if found AND classifier said gate 9 passed → flip to fail with `Video Proposal` reason. Apply same pattern to gates 8 (location) and 7 (already hired). |
| A4 | No grounding-evidence audit | Every gate evidence must cite a substring from the job description OR snapshot context. C6 verifies via fuzzy match (token-set ratio ≥ 80%). Mismatches flagged in `relevancy_scores.confidence_warnings TEXT[]`. |
| A5 | Token-window overrun (giant job descriptions, giant snapshot bios) | Truncate description to 1500 chars (already in v2); skill list to 30 items; portfolio to top 5 by recency; work history to top 5 by recency. Apply BEFORE building the user message. |
| A6 | `criteria_version` snapshot not enforced — manual PRD edit could ship without bumping | Add a CI check: `criteria_versions` table must have a row whose `effective_at >= git log HEAD docs/job_relevancy_criteria_prd.md`. |
| A7 | Gemini temperature not specified | Set `temperature: 0.0` for the classifier (deterministic outputs for the same input — reproducibility on calibration). |
| A8 | `evidence_panel` only generated for manual_url path | Auto-pipeline cards have empty `evidence_panel` — UI should fall back to rendering `gates_evidence` + `components.reason` (already stored). Document this in §10 rendering rules. |
| A9 | Bias risk: deterministic results passed to LLM could cause confirmation bias | Mode B prompt explicitly says "Do not re-evaluate gates 1-6 and 11; trust the deterministic verdict." Verify via spot checks during shadow phase. |
| A10 | Gemini structured-output schema drift between prompt versions | Lock the JSON schema in `criteria_versions.output_schema JSONB` per criteria version. Validate every Gemini response against the version's schema. |
| A11 | Stale snapshot silently degrades classifier accuracy | When `snapshot_age_days > 60`, attach `confidence_warnings: ['stale_snapshot']` and reduce `confidence` by 0.05. Document at §5.2. |

### 16.8 Edge cases & failure scenarios

| # | Edge case | Behavior in v3.2 (if not addressed) | Recommendation |
|---|---|---|---|
| E1 | Profile snapshot has zero portfolio items (e.g. brand-new profile) | Gate 10 fails deterministically → reject. Even strong-stack-match jobs get rejected. | Soft-pass gate 10 (don't fail) when `data->'portfolio'` is empty AND profile is `top_rated_status='top_rated'` OR `job_success_score >= 90`. Mark as `gate_10_softpassed` in evidence. |
| E2 | Profile snapshot has zero work history | Rubric `domain_match` and `skill_match` lose evidence anchor | Fall back to skills + headline. Cap component scores at 7/10 in this case (visible in UI as "limited evidence"). |
| E3 | Hourly job with `budget_min=null AND budget_max=null` | Gate 4 deterministic check passes (ambiguous) → LLM evaluates | Document explicit behavior in §7.3. LLM scans description for rate hints; if none found → mark `gate_4_unverified` (proceed but flag). |
| E4 | Job description in non-English | LLM accuracy on gates 7-9 degrades silently | Light language detection (cld3 or franc). Non-English → set `confidence -= 0.1` and add `confidence_warnings: ['non_english_description']`. |
| E5 | Snapshot uploaded with missing top-level fields (extractor bug, partial paste) | `saveUpworkProfileSnapshot` succeeds but `data` JSONB has nulls; classifier sees missing context | V2 + V11 enforcement: Zod-validate the upload; reject incomplete snapshots before they hit the table. |
| E6 | Same task evaluated twice (auto + manual) | Two separate `relevancy_scores` rows | Acceptable; audit page surfaces both. UI shows "Auto-pipeline ran" line in result panel. |
| E8 | Profile becomes inactive after a snapshot is uploaded | Manual evaluator still allows scoring (Q3 default = yes) | Document. Audit-page filter to exclude inactive-profile evaluations from the canonical "what does the classifier think" tile. |
| E10 | Backfill scenario: scoring tasks created >30 days ago | Gate 2 (freshness) fails by default | Add `request_meta.bypass_freshness=true` flag (admin-only on manual eval). Stored in `relevancy_scores`. |
| E11 | Webhook replay (n8n retry) | Duplicate writes | Idempotency key (I1). |
| E12 | Concurrent overrides on same task | Last-write-wins | Use Postgres row lock: `SELECT … FOR UPDATE` in `moveTaskAction`. |
| E17 | Override capture for an admin's manual eval (not auto pipeline) | Override exists but the score was `source='manual_url'` — analytics distort | `relevancy_overrides` includes `source` snapshot; audit page filters on `source='auto'` for the canonical override rate. |
| E18 | Admin pastes a task card URL for a card that has been deleted | 422 from `/api/tasks/:id/job-payload` | UI: clear error message, suggest the admin double-check the URL. Log the attempt for audit. |
| E19 | Admin pastes a card URL for a manual-only card (no Vollna data, no `_job_id`) | Some `custom_fields` keys missing | Classifier handles missing fields per §6.2.2. Result panel shows `missing_signals: ['job_id','client.total_spent', ...]`. |
| E20 | Admin selects a profile whose snapshot is older than `SNAPSHOT_STALE_DAYS_BLOCK` (if set) | Classifier returns `decision='review'` with `_errorDetail='snapshot_too_stale'` | Documented; only triggered if the env var is set (default unset → no blocking). |

### 16.9 Frontend states catalog

The plan describes UI but doesn't enumerate all states each screen must handle. Each screen MUST implement:

**Profile Management (Settings → profile table — already shipped)**

States already covered by the existing `<ProfileUpworkSnapshotSheet>` component. v3.2 only adds these visual badges:

| State | Trigger | UI |
|---|---|---|
| Snapshot fresh | `extracted_at >= NOW() - INTERVAL '30 days'` | Green dot + "Fresh" tooltip |
| Snapshot stale | `30 days <= age < 90 days` | Yellow badge "Refresh recommended" |
| Snapshot very stale | `age >= 90 days` | Red badge "Stale snapshot" |
| Snapshot missing | No `is_current=TRUE` row | Red badge "No snapshot — upload required" + CTA |

**Task Card Evaluator (`/relevancy-evaluator`)**

| State | Trigger | UI |
|---|---|---|
| Idle | Default | Form fields, Evaluate disabled until both filled |
| URL invalid | Pattern fail | Inline error |
| Profile picker partially empty | Some profiles have no snapshot | Disabled options + tooltip "Upload snapshot first" linking to Settings |
| Profile picker fully empty | Zero profiles with snapshots | Disabled picker + "Upload at least one snapshot first" link |
| Submitting | Click Evaluate | 3-stage progress (validate → load → classify); each stage shows duration; admin can abort |
| Task not found | 422 from job-payload | Error panel: "Task not found. Did the card get deleted?" |
| Profile snapshot missing | 422 from context | Error panel + "Upload snapshot" CTA |
| Gemini failed | Stage 3 fails | Show partial result (deterministic gates only) + "Re-run" button |
| Verdict ready | Backend returns | Result panel renders |
| Rate-limited | 429 from `/api/relevancy/evaluate-task` | Banner with cooldown countdown |

**Relevancy Audit (`/relevancy-audit`)**

| State | Trigger | UI |
|---|---|---|
| Cold start | Zero `relevancy_scores` rows | Empty state: "No evaluations yet. Run a manual eval to seed data." |
| Loading | Tile fetch | Per-tile skeleton |
| Error | One tile fails | Tile-level error with Retry; other tiles still render |
| Empty filter result | Date range too tight | "No data in this range. Try expanding the window." |
| DLQ backlog | `relevancy_scores_dlq WHERE resolved_at IS NULL` non-empty | Red banner: "N pending DLQ entries. Open Admin → DLQ to retry or discard." |
| Stale snapshot summary | Any active profile w/ snapshot >90 days | Yellow banner: "N profiles need a snapshot refresh: Sana, Laiba, …" |

**Universal**

- Every async action → optimistic-spinner pattern with abort capability.
- Every error → toast + inline panel (don't only-toast destructive errors).
- Every fetch → must handle `4xx` (validation/auth — show specific message) vs `5xx` (server — generic retry) differently.
- Every modal → focus trap, Escape closes, click-outside closes (with confirm if dirty), `aria-modal`, `aria-labelledby`, `aria-live` polite for status messages.
- All long-running progress (>3s) → screen reader announces stage transitions via `aria-live="polite"`.
- All keyboard navigable: Tab order matches visual order, Enter submits primary action, Escape cancels.
- All buttons have `disabled` state during inflight requests; multi-click guarded.

### 16.10 Performance bottlenecks

| # | Bottleneck | Recommendation |
|---|---|---|
| P1 | `/api/profiles/:id/context` reads from view + computes `tech_stack_inferred` per portfolio item every call | Cache the JSON output in `unstable_cache` (5 min TTL, tagged `profile-context-<id>`); invalidate on snapshot upload. View read is sub-millisecond; the bottleneck is the per-portfolio inference loop. |
| P2 | `relevancy_scores` partition strategy missing | At 12k rows/year baseline this is fine, but plan for partitioning by month at 100k+ rows/year. |
| P3 | `gates_evidence JSONB` per row inflates row size | After 90 days, archive gates_evidence + evidence_panel to `relevancy_scores_archive`. Active table keeps only the structured decision/score fields. |
| P4 | `upwork_profile_snapshots.data` is full JSON; grows with every upload | Keep latest 12 snapshots' `data` JSONB fully; older entries store only the promoted hot columns + a SHA hash of `data`. (Optional, defer to v3.x — at 8 profiles × 12/year × ~40KB = ~4MB/year, this is a non-issue today.) |
| P5 | n8n `executeWorkflow` adds 200-500ms latency | Acceptable for v3.2; document. Consider direct embedding into parent workflow if latency budget tightens. |
| P6 | No indexes on `activity_log` for relevancy queries | Add `CREATE INDEX ON activity_log (entity_type, entity_id, action) WHERE entity_type IN ('profile','task')`. |
| P7 | Cache invalidation between Next.js and n8n is one-way | Tag-based invalidation: dashboard busts the `profile-context-<id>` tag on upload; n8n falls back to its 1h static-data cache if the endpoint blips, but always re-fetches after the TTL. |
| P8 | Manual eval p95 still subject to Gemini variance | At <2s p95 the UI doesn't need streaming today, but build the SSE-ready endpoint anyway so we can flip it on without a refactor if Gemini latency creeps up. |

### 16.11 Fallback mechanisms (degraded modes)

| # | Failure | Degraded mode |
|---|---|---|
| F2 | Gemini down | Auto pipeline: emit `decision='review'` with `_errorDetail='gemini_unavailable'`; cards land in `Todo` column. Manual evaluator: same. Never silently default to `proceed`. |
| F3 | Postgres write fails (relevancy_scores) | Verdict still returned to caller; row goes to `relevancy_scores_dlq` (Postgres-persisted) + retry every 30s for 10 min, then escalates. Alert. |
| F4 | Profile context endpoint down | n8n falls back to `n8n_static_data` cache (1h TTL). Never hard-fail the parent workflow. |
| F5 | Gemini AND Postgres down | Auto pipeline reverts to v2-pre-classifier behavior (kill-switch §13.5). Manual evaluator returns 503 with a system status banner. Profile snapshot uploads still work (single-row Postgres write — no Gemini dependency). |
| F6 | `criteria_versions` row missing for the version the prompt cites | Refuse to score; return `decision='review'` with `_errorDetail='criteria_version_unknown'`. Forces a deploy fix instead of silent drift. |
| F7 | Snapshot uploaded but extractor produced incomplete JSON | Upload rejected at validation (V2). Admin sees field-level errors. Existing snapshot stays current; no degradation. |

### 16.12 Implementation priority

Recommendations are grouped into three buckets. Phase numbers refer to Appendix B.

**P0 — must ship before active rollout (Phase 17):**

- §13.1 entire safe-update protocol
- §13.5 kill-switch
- §14 rollback procedure + JSON backup discipline
- §15 all execution requirements
- S2, S3, S5, S6, S8 (security)
- V1, V2, V4, V8, V10, V11, V12 (validation)
- I1, I2, I5, I7, I8 (idempotency)
- A1, A2, A6, A7, A10 (AI quality)
- D7, D9 (consistency)
- L2, L7 (logging baselines)
- F2, F3, F6 (fallbacks)
- All §16.9 frontend states for the three primary screens (Settings snapshot drawer, Task Card Evaluator, Relevancy Audit)

**P1 — must ship within 30 days of active rollout:**

- S4, S7, S9, S10, S11
- V7, V9
- R1, R2, R4, R6
- I3, I6
- A3, A4, A5, A8, A9, A11
- D2, D4, D6
- L1, L3, L4, L5, L6, L8, L9, L10, L11
- E1–E20 (all edge cases) — at minimum documented if not coded
- F4, F5, F7

**P2 — quality of life within 90 days:**

- §16.10 (P1–P8 performance)
- Audit page deep-dives
- Bulk re-evaluation UI (§12.1 #1)

---

## Appendix A — Open Questions

These are decisions BEFORE running migration 018:

1. **Snapshot freshness policy**: warn-only vs block-after-N-days. **v3.2 default: warn at 30 days, never block.** Admin owns refresh cadence. Setting `SNAPSHOT_STALE_DAYS_BLOCK` enables blocking; default unset.
2. **Profile-thresholds storage**: PRD §11 Q1. **v3.2 picks `profiles.thresholds_overrides JSONB`** (single column). If we need cross-profile threshold queries, switch to a dedicated `profile_thresholds` table in v3.x.
3. **Manual eval against `active=false` profiles**: should manual evals against inactive profiles be allowed? **v3.2 default: yes** (research utility). Block if security needs.
4. **Override capture**: when an agent moves a card classifier-said-proceed to N/A, do we surface a "Why did you override?" prompt? **v3.2 default: optional input box** (don't block the move).
5. **Skill taxonomy**: build now (curate ~500 slugs) vs defer to v3.3? **v3.2 default: defer.** The snapshot's `skills_summary` ILIKE + JSONB containment is sufficient for the deterministic gate-1 path; calibration data after the shadow phase decides whether the small accuracy lift is worth seed-curation cost.
6. **Reason label typos** (PRD §9.2): migrate `"Low Higher rate"` → `"Low Hourly Rate"` BEFORE or AFTER classifier launch? **v3.2 recommendation: AFTER** — preserve label-equality with historical data through 2-week shadow mode, then run a single migration that rewrites both the enum AND existing rows.
7. **Profile mismatch warning**: when admin selects a different profile than the auto-pipeline used for that card, **v3.2 default: yellow warning, no block** — admin is doing intentional research.
8. **Re-evaluation idempotency**: each click writes a new score, OR replaces the most-recent score for `(task_id, profile_id)`? **v3.2 default: append.** Each evaluation is its own row; audit page treats most-recent as canonical.
9. **Rate-limit backend**: Postgres-backed counter vs Upstash Redis? **v3.2 default: Postgres** (no extra service); switch to Upstash via `RATE_LIMIT_BACKEND=upstash` if Postgres-counter contention shows up.

---

## Appendix B — Build Order

v3.2 has fewer phases than v3.1 because the profile-ingest, profile-sync, scrape-proxy, and skills-taxonomy phases are gone.

| Phase | Scope | Owner | Effort | Done when |
|---|---|---|---|---|
| **0. PRD freeze + Execution Requirements** | Lock PRD v0.2; resolve Appendix A; Waqas provides §15 secrets (Gemini API key + MANUAL_EVAL_TOKEN) | Waqas + leads | 2h | Sign-off; all keys in n8n credentials |
| **0a. Pre-flight backup** | Snapshot current `EWnZg3svZWwcIRs4` to `docs/multiple webhooks (08-05-2026 working).json`; pg_dump pre-migration baseline | n8n-keeper | 30m | Backup file committed; pg_dump archived |
| **1. Migration 018** | `profiles.thresholds_overrides` + `criteria_versions` + `relevancy_scores` + `relevancy_scores_dlq` + `manual_job_evaluations` + `relevancy_overrides` + `018_rollback.sql` | Dashboard | 3h | Idempotent run on Contabo; rollback tested in dev |
| **2. `criteria_versions` v0.2 seed** | Insert one row mirroring `docs/job_relevancy_criteria_prd.md` v0.2 (thresholds, reason_enum, prompt_versions, output_schema) | Dashboard | 2h | Seed runs; classifier `criteria_version=0.2` resolves |
| **3. `/api/profiles/:id/context` endpoint** | Reads `upwork_profile_snapshots_current` view + `profiles.thresholds_overrides`; computes `tech_stack_inferred[]` per portfolio item | Dashboard | 4h | Returns classifier-ready JSON for Shayan, Saim, Craig (the 3 already-loaded profiles) |
| **4. `/api/tasks/:id/job-payload` endpoint** | Reads `tasks` row, projects `custom_fields` into canonical job payload (§6.2) with `_missing_fields[]` populated | Dashboard | 4h | Returns canonical JSON for any current Vollna-fed card |
| **5. `/api/relevancy/evaluate-task` route** | Parse task card URL → resolve UUID → forward to n8n; rate-limit (R1); auth (admin); idempotency (I5) | Dashboard | 4h | Posts to n8n + returns verdict; rate-limit returns 429 |
| **5a. Shared schemas + idempotency middleware** | V1 Zod schemas, I1 idempotency-key middleware, S3 HMAC verification | Dashboard | 1d | All POST endpoints validated + idempotent |
| **5b. Kill-switch env var** | `RELEVANCY_CLASSIFIER_ENABLED` wired into n8n; rate-limit middleware (R1, R2, R4, R6) | Dashboard + n8n-keeper | 4h | Toggle reverts to v2 in <30s |
| **6. `_relevancy-classifier-core` sub-workflow** | Build C1–C10 + A1 retry/fallback + A3 verifier + A7 temp=0; embed PRD §16 examples | n8n-keeper | 6h | Validation green; mock job test passes against Shayan snapshot |
| **7. Existing workflow splice** | Insert `Score Relevancy` executeWorkflow node + IF + kill-switch read in `EWnZg3svZWwcIRs4`; follow §13.1 protocol | n8n-keeper | 2h | Mock Vollna job through full path; backup snapshot taken |
| **8. `job-evaluate-manual` workflow** | NEW: J1-J7 nodes per §4.3; J3 reads `/api/tasks/:id/job-payload`; J5 invokes core | n8n-keeper | 4h | Returns verdict in <3s |
| **9. Admin UI: Task Card Evaluator page** | Paste URL + profile picker (with snapshot-availability filter) + result panel + abort; SSE-ready endpoint built but not enabled | Dashboard | 2d | End-to-end manual eval; profiles without snapshots disabled |
| **10. Admin UI: Relevancy Audit page** | Tiles + drilldowns + L8 lookup + L4 cost dashboard + L11 snapshot-staleness tile | Dashboard | 2d | Decision distribution + gate-fail rates + cost + snapshot freshness live |
| **10a. Logging + alerts baseline** | L1 pino structured, L2 request_id, L5 Slack alerts, F2/F3/F6 fallback paths | Dashboard | 1d | Trace one job end-to-end through logs |
| **11. Smoke test** | Replay 20 historical N/A tasks through manual evaluator (against the Shayan/Saim/Craig snapshots) | Waqas | 4h | ≥85% agreement |
| **12. Shadow rollout** | `Score Relevancy` writes to log only; kill-switch verified; daily decision pivot | n8n-keeper + Waqas | 1 week | 7 days × loaded-profile of `relevancy_scores` rows; agreement ≥85% |
| **13. Calibration review** | Audit shadow data; tune per-profile thresholds; upload missing snapshots (Sana, Laiba, Khansa, Rebekah, Mubashir) before active rollout | Waqas | 2d | All active profiles have a snapshot; threshold doc updated |
| **14. Active rollout** | Connect `Score Relevancy` → routing branch; pre-flight §13.1 + post-flight smoke | n8n-keeper | 1h | First N/A card auto-created |
| **15. Override capture** | Wire `relevancy_overrides` insertion into `moveTaskAction` (D4) | Dashboard | 4h | Override rate visible in audit |
| **16. P1 hardening pass** | All §16 P1 items (R1/R2/R4/R6, A3-A9/A11, S4/S7/S9-S11, V7/V9, etc.) | Dashboard + n8n | 1 week | All P1 items closed in audit |
| **17. Post-launch review** | 30-day review; promote stable JSON snapshot to backup; archive previous; document calibrated thresholds in PRD changelog | Waqas | 1h | New `(working).json` baseline; `CLAUDE.md` updated |

**Total engineering effort**: ~8–10 working days, gated by PRD freeze + secrets (Phase 0), snapshot uploads for currently-empty profiles (Phase 13), and 1-week shadow. P0 items (§16.12) are blocking for Phase 14; P1 items run in parallel with Phase 14+.

**Phases dropped from v3.1**:

| Phase | Why dropped |
|---|---|
| Apify actor evaluation | No Apify in v3.2 |
| `/api/scrape/upwork/*` proxy routes | No Apify in v3.2 |
| `skills_taxonomy` seed | Deferred to v3.3 (Appendix A Q5) |
| `/api/skills/normalize` | Deferred (not needed without taxonomy) |
| `profile-ingest` workflow | Snapshot upload is admin-driven via existing UI/CLI |
| `profile-sync` workflow | No diff workflow; snapshot history is append-only |
| Admin UI: Profile Management | Already shipped (Settings + `<ProfileUpworkSnapshotSheet>`) |
| Admin UI: Sync diff modal | No diff workflow |

---

## Document conventions

- **Gate IDs** match PRD §7 row order verbatim. Never renumber.
- **Reason labels** quoted verbatim from PRD §6.2 (typos preserved). Migration is a separate workstream.
- **`criteria_version` / `prompt_version` / `prompt_mode`** stored on every `relevancy_scores` row. Three together let us reconstruct any historical decision exactly.
- **Profile IDs** are TEXT slugs (matching `profiles.profile_id`). Snapshot rows reference the same slug. Display names appear only in human-readable fields.
- **Sub-workflow naming**: prefix with underscore (`_relevancy-classifier-core`) to signal "internal, do not webhook directly".
- **No external scraping**. Profile data is uploaded by admin to `upwork_profile_snapshots`; job data is read from `tasks.custom_fields` (populated by the existing Vollna pipeline). If we ever need to re-introduce live scraping (e.g. a saved-search watcher in v4), the entry point is a NEW workflow — never the classifier core.
- **Snapshot uploader is the source of profile truth.** Never read profile context from anywhere except `upwork_profile_snapshots_current` (or its data-layer wrappers). Don't build separate `profile_stacks` / `profile_portfolios` tables.
