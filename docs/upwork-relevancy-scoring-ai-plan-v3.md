# Upwork Relevancy Scoring AI — Build Plan **v3.1**

**Status:** Engineering-ready · 2026-05-07
**Supersedes:** `upwork-relevancy-scoring-ai-plan-v2.md` (2026-05-06), v3 (2026-05-06), v1
**Source PRD:** `job_relevancy_criteria_prd.md` v0.2
**Stack:** Apify (Upwork scrape) → n8n (4 workflows) → Gemini Flash 2.5 → Postgres (Contabo) + Next.js admin dashboard
**Stable n8n backup:** [`docs/multiple webhooks (07-05-2026 working).json`](./multiple%20webhooks%20%2807-05-2026%20working%29.json) — see [§14 Rollback Strategy](#14-rollback-strategy)

**v3.1 changes vs v3:** added §13 Production Readiness & n8n Update Strategy, §14 Rollback Strategy, §15 Execution Requirements, §16 Identified Gaps & Production-Readiness Recommendations. No changes to architecture, schemas, or workflows from v3 — v3.1 is a hardening + ops-readiness pass.

v3 keeps the v2 classifier core (gates + rubric + Gemini Flash 2.5) and adds the three operational pieces v2 lacked:

1. **Admin-driven Upwork profile ingestion** from a profile URL (skills, tags, portfolio, work history, categories).
2. **Profile sync** with diffing and version history.
3. **Manual job evaluation UI** — paste a job URL, pick a profile, get a scored verdict on demand.

The classifier from v2 is refactored into a **shared n8n sub-workflow** (`_relevancy-classifier-core`) so the existing Vollna auto-pipeline AND the new on-demand UI both call the same scoring engine — one source of truth.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Key Improvements Over v2](#2-key-improvements-over-v2)
3. [Architecture Diagram](#3-architecture-diagram)
4. [n8n Workflows](#4-n8n-workflows)
   - 4.1 `_relevancy-classifier-core` (shared sub-workflow)
   - 4.2 `EWnZg3svZWwcIRs4` (existing — splice unchanged from v2)
   - 4.3 `profile-ingest`
   - 4.4 `profile-sync`
   - 4.5 `job-evaluate-manual`
5. [Profile Ingestion + Sync Design](#5-profile-ingestion--sync-design)
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

### 1.1 Three entry points, one scoring engine

v3 is a single relevancy scoring system reachable via three distinct front doors:

| Front door | Trigger | Used by | LLM call cadence |
|---|---|---|---|
| **A. Vollna auto-pipeline** | Webhook from Vollna into `EWnZg3svZWwcIRs4` | Live production traffic (~40 jobs/day, capacity 400/day) | ~65% of jobs (35% short-circuit deterministic) |
| **B. Manual job evaluation** | Admin pastes job URL + picks profile in dashboard | On-demand QA, training, edge-case review | 100% of submitted jobs |
| **C. Profile ingestion / sync** | Admin pastes profile URL OR clicks Sync OR cron | Profile setup + nightly drift detection | 0 (no scoring; only scrape + diff) |

All three pass through the same Postgres schema and the same `_relevancy-classifier-core` sub-workflow when scoring is needed.

### 1.2 What the admin sees in the dashboard

| Section | Purpose | Data |
|---|---|---|
| **Profile Management** | List + add + edit profiles. "Add Profile" takes an Upwork profile URL. | `profiles`, `profile_stacks`, `profile_portfolios`, `profile_work_history`, `profile_categories` |
| **Profile Detail** | Show a single profile with skills/portfolio/history + "Sync Now" button + version history | All profile_* tables + `profile_versions` |
| **Job Evaluator** | Paste a job URL, pick a stored profile, get a score + breakdown + proposal angles | `manual_job_evaluations` + `relevancy_scores` |
| **Relevancy Audit** | Time-series view of classifier accuracy, gate-fail rates by profile/week | `relevancy_scores`, joined to `tasks.column_id` |

### 1.3 Single source of truth

- **PRD `job_relevancy_criteria_prd.md` v0.2** is the canonical rule set. The classifier prompt embeds §16 verbatim. Every `relevancy_scores` row stores `criteria_version` so historical scores stay auditable when the PRD changes.
- **`profiles` table** (existing) is the canonical profile registry. New `profile_*` child tables hang off `profiles.id`.
- **`relevancy_scores` table** (new in v2, extended in v3) is the canonical scoring log for ALL three front doors.

---

## 2. Key Improvements Over v2

| # | v2 weakness | v3 fix | Section |
|---|---|---|---|
| 1 | Profile context exists only as `stack_bucket` + `portfolio_tldr` (assumed seeded manually); no automated profile ingestion | URL-driven Apify ingestion fills `profile_*` tables in one click | §4.3, §5.1 |
| 2 | No way to evaluate a single ad-hoc job URL outside the Vollna pipeline | New `job-evaluate-manual` workflow + `/evaluator` admin page | §4.5, §6, §10.3 |
| 3 | Profile data assumed static; no detection of new portfolio items, skill changes, etc. | `profile-sync` workflow with row-level diff and `profile_versions` history | §4.4, §5.2 |
| 4 | Classifier logic embedded inline in main workflow → cannot be reused without copy-paste | Extracted into `_relevancy-classifier-core` sub-workflow; main workflow + manual eval both invoke via `executeWorkflow` | §4.1, §4.2 |
| 5 | Skills are free-text strings → "Laravel" vs "laravel" vs "Laravel 10" treated as different | New `skills_taxonomy` table with canonical slugs + alias map; ingestion normalizes on insert | §5.3, §9.4 |
| 6 | No portfolio matching at the data layer; gate 10 was LLM-only | `profile_portfolios.tech_stack TEXT[]` GIN-indexed; deterministic pre-check for gate 10 attempted before LLM fallback | §7.2 |
| 7 | Work history not captured; rubric `skill_match` and `domain_match` were LLM guesses from `headline` | `profile_work_history` table feeds rubric scoring with concrete evidence | §7.3, §9.3 |
| 8 | "Replay 20 N/A tasks" smoke test was the only validation; no production UI to dogfood | Manual evaluator IS the ongoing validation surface — every admin eval is logged in `relevancy_scores` and feeds accuracy metrics | §10.3, §11.5 |
| 9 | No scraping infrastructure decision (left implicit) | Apify managed actor as primary, manual JSON paste fallback, all behind `/api/scrape/*` API routes called by n8n HTTP nodes | §5.1, §6.2 |
| 10 | `criteria_version` stored but no UI to see when it changed | `criteria_versions` table + admin viewer; PRD changelog rows mirror DB rows | §9.5 |
| 11 | Admin overrides not modeled | `relevancy_overrides` table: when an agent moves a card to N/A despite classifier=proceed (or vice versa), we capture it for calibration | §9.6, §11.5 |
| 12 | Profile URL not stored — re-syncing requires admin to remember the URL | `profiles.upwork_url` column added | §9.1 |
| 13 | No category-level matching (Upwork categories like "Web Programming") | `profile_categories` table; future use in v3.1 for category-level routing | §9.3 |
| 14 | Profile ingestion's HTML-vs-API choice was hand-waved away | Concrete decision: Apify Upwork actor (or equivalent: ScrapingBee, ZenRows). Public profiles only. Anti-bot handled by managed service. Cost: ~$0.005-0.02 per scrape. | §5.1 |
| 15 | No diff visualization for sync results | "What changed" popup after sync: skills added/removed, portfolio added, headline changed (with old → new) | §10.2 |

---

## 3. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  ADMIN DASHBOARD (Next.js)                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Profile Management│  │  Profile Detail  │  │  Job Evaluator   │  │ Relevancy Audit │  │
│  │ Add by URL · List │  │  Sync · Diff · History│  │ Paste URL + Pick Profile     │  │ Accuracy / Gates │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
└───────────┼───────────────────┼───────────────────┼───────────────────┼─────────────┘
            │                   │                   │                   │
            ▼                   ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Next.js API routes (Contabo)                                                                     │
│  POST /api/profiles/ingest        → forwards to n8n profile-ingest webhook                                         │
│  POST /api/profiles/:id/sync     → forwards to n8n profile-sync webhook                                            │
│  POST /api/relevancy/evaluate    → forwards to n8n job-evaluate-manual webhook                                  │
│  GET  /api/profiles/:id/context  → reads profile_* tables, returns classifier-ready JSON                       │
│  POST /api/relevancy-scores      → audit log writer (called by n8n)                                                       │
│  GET  /api/relevancy-scores/accuracy  → admin metrics                                                                       │
│  GET  /api/scrape/upwork/profile?url=… → Apify proxy (called by n8n)                                                  │
│  GET  /api/scrape/upwork/job?url=…    → Apify proxy (called by n8n)                                                  │
└──────┬──────────────────┬──────────────────┬──────────────────┬─────────────────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    n8n CLOUD (ikonicdev.app.n8n.cloud)                                                       │
│                                                                                                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐                              │
│  │  profile-ingest      │  │  profile-sync        │  │  job-evaluate-manual          │                              │
│  │  (NEW)               │  │  (NEW · cron+webhook)│  │  (NEW)                                  │                              │
│  └────────┬─────────────┘  └────────┬─────────────┘  └─────────────┬────────────────┘                              │
│           │                         │                              │                                                                                       │
│           │ writes profile_*        │ writes profile_*+versions    │ calls ↓                                                                                  │
│           ▼                         ▼                              ▼                                                                                       │
│      [Postgres]                [Postgres]                   ┌────────────────────────────────────┐                                                       │
│                                                             │ _relevancy-classifier-core               │  ← shared sub-workflow                                          │
│                                                             │ (NEW — extracted from v2)                  │                                                                          │
│                                                             │  N1 Load Profile Context                       │                                                                          │
│                                                             │  N2 Deterministic Pre-check                    │                                                                          │
│                                                             │  N5 Gemini Flash 2.5                                  │                                                                          │
│                                                             │  N6 Validate Output                                  │                                                                          │
│                                                             │  N10 Persist Score                                   │                                                                          │
│                                                             └─────────────▲────────────────────┘                                                       │
│                                                                           │                                                                                                       │
│  ┌──────────────────────────────────────────────────────────────┘                                                                                       │
│  │                                                                                                                                                              │
│  │  EWnZg3svZWwcIRs4 (EXISTING — Vollna auto-pipeline)                                                                                              │
│  │   8 webhooks → Merge → Process Job → Route Job (proceed) ──► invoke _relevancy-classifier-core ──► Build GPT Input → AI Agent (Proposal Writer)             │
│  │                                                                                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐                  ┌─────────────────────────────┐
│   Apify (or alternative)    │                  │  Google AI Studio (Gemini)  │
│   Upwork Profile Actor      │ ◄── HTTPS ────── │  gemini-2.5-flash           │
│   Upwork Job Actor          │                  │                             │
└─────────────────────────────┘                  └─────────────────────────────┘
```

---

## 4. n8n Workflows

Four total. One is shared core; the others are front doors.

### 4.1 `_relevancy-classifier-core` (NEW — shared sub-workflow)

**Purpose**: encapsulate the classifier (gates + rubric + LLM + persistence) so it can be invoked from any other workflow via `n8n-nodes-base.executeWorkflow`. Extracted verbatim from v2 §3.2 nodes N1–N10.

**Trigger**: `Execute Workflow` (called by parent workflow). Inputs: `{ profile_id, job, request_meta }`.

**Output**: classifier verdict JSON (see §8.4 schema).

**Internal nodes** (unchanged from v2 §3.2; renamed for clarity):

| ID | Node | Type | Purpose |
|---|---|---|---|
| C1 | `Load Profile Context` | httpRequest | GET `/api/profiles/:id/context` → stack bucket, portfolio TL;DR, thresholds |
| C2 | `Deterministic Pre-check` | code | Run gates 2, 3, 4 (when structured), 5, 6, 11 in pure JS |
| C3 | `Gate Switch` | if | `deterministic.failed.length > 0` ? → C7 : → C4 |
| C4 | `Prepare Classifier Input` | set | Compose user message for LLM |
| C5 | `AI Agent — Relevancy Classifier` | langchain.agent | Gemini Flash 2.5 + Structured Output Parser |
| C6 | `Validate Classifier Output` | code | Schema sanity check; retry-once on parse fail |
| C7 | `Build Reject Payload` | set | Compose verdict object for `decision = reject` |
| C8 | `Decision Switch` | switch | reject / review / proceed |
| C9 | `Build Review Payload` | set | Compose verdict object for `decision = review` |
| C10 | `Persist Relevancy Score` | httpRequest | POST `/api/relevancy-scores` (parallel; `neverError: false`) |

**Exit**: returns the validated verdict object to the caller. Caller decides what to do with it (write a Task Board card, return to UI, etc.).

**Why a sub-workflow**: avoids 200+ lines of duplicate node config across the three caller workflows; lets us swap the LLM provider (Gemini → Claude → OpenAI) in one place; lets us version the classifier independently from its callers (`prompt_version` advances without touching the auto-pipeline).

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

### 4.3 `profile-ingest` (NEW)

**Purpose**: take a public Upwork profile URL, scrape it via Apify, normalize, persist into Postgres, return a profile preview for the admin UI.

**Trigger**: `Webhook` POST `/webhook/profile-ingest`, body `{ profile_id, upwork_url, requested_by }`. The dashboard creates the profile row first (so `profile_id` exists), then fires this.

**Auth**: header `Authorization: Bearer <PROFILE_INGEST_TOKEN>` (validated by Webhook node's "Header Auth" credential).

#### Node-by-node

| ID | Node | Type | Purpose |
|---|---|---|---|
| P1 | `Webhook (Profile Ingest)` | webhook v2.1 | Entry. Validates body schema. |
| P2 | `Validate Input` | code | Reject if missing `upwork_url` or non-Upwork host. Throw → 400. |
| P3 | `Fetch via Apify` | httpRequest v4.2 | POST to `https://api.apify.com/v2/acts/<ACTOR_ID>/run-sync-get-dataset-items?token=<APIFY_TOKEN>` with `{ profileUrls: [upwork_url], maxItems: 1 }`. Timeout 60s, retry × 2. |
| P4 | `Parse Apify Output` | code | Map Apify response shape → canonical `ProfileIngestPayload` (§9.2). Handle private/blocked profiles → throw `ProfileNotPublicError`. |
| P5 | `Normalize Skills` | code | For each skill string, look up canonical slug in `skills_taxonomy` (call `/api/skills/normalize` httpRequest); unknown → flag and emit as `{slug: null, raw: 'X', flagged: true}`. |
| P6 | `Persist — Profile Header` | httpRequest | PATCH `/api/profiles/:id` with headline, hourly_rate, jss_score, top_rated, total_earnings, timezone, country |
| P7 | `Persist — Stack` | httpRequest | POST `/api/profiles/:id/stacks` with normalized array (replace strategy) |
| P8 | `Persist — Portfolio` | httpRequest | POST `/api/profiles/:id/portfolios` with array (upsert by `external_id`) |
| P9 | `Persist — Work History` | httpRequest | POST `/api/profiles/:id/work-history` (upsert by `external_id`) |
| P10 | `Persist — Categories` | httpRequest | POST `/api/profiles/:id/categories` (replace strategy) |
| P11 | `Snapshot Initial Version` | httpRequest | POST `/api/profiles/:id/versions` with `{change_set: 'INITIAL'}` so subsequent syncs have a baseline to diff against |
| P12 | `Respond` | respondToWebhook | 200 + `{profile_id, ingested: {skills: N, portfolios: N, work_history: N}}` |

#### Error handling

- Apify times out / returns 0 items → P3 `onError: continueErrorOutput`. Error branch: log + respond 502 with actionable message ("Profile may be private; paste JSON manually below").
- `ProfileNotPublicError` → respond 422 with link to fallback paste UI.
- Any Postgres write fails → mark profile `ingest_status = 'partial'` (column on `profiles`); admin sees a yellow banner.

#### Cost & latency

- Apify call: ~3-15s for an Upwork profile (network + render).
- Total node-to-node latency: 5-20s typical, 60s p99 (Apify cold start).
- Apify cost: ~$0.01-0.02 per profile run (negligible at <100 profiles/month).

### 4.4 `profile-sync` (NEW)

**Purpose**: re-fetch profile, diff against last version, apply surgical changes, log to `profile_versions`. Detect new portfolio items, removed skills, headline edits.

**Two triggers**:
1. `Webhook` POST `/webhook/profile-sync`, body `{profile_id, requested_by}` — fired by "Sync Now" button.
2. `Cron` daily at 03:00 ET — iterates over `profiles WHERE active = TRUE AND upwork_url IS NOT NULL` and processes each one through `Split In Batches` to avoid Apify rate-limits.

#### Node-by-node

| ID | Node | Type | Purpose |
|---|---|---|---|
| S1a | `Webhook (Profile Sync)` | webhook | Entry for manual sync |
| S1b | `Cron (Daily Sync)` | scheduleTrigger | 0 7 * * * UTC (= 03:00 ET) |
| S1c | `Fetch Active Profiles` | httpRequest | GET `/api/profiles?active=true` (only on cron path) |
| S1d | `Split In Batches` | splitInBatches | batchSize=1, options.reset=false (cron path only) |
| S2 | `Load Last Version` | httpRequest | GET `/api/profiles/:id/versions/latest` → returns last snapshot JSON or `null` |
| S3 | `Fetch via Apify` | httpRequest | Same as P3 in profile-ingest |
| S4 | `Parse Apify Output` | code | Same as P4 |
| S5 | `Normalize Skills` | code | Same as P5 |
| S6 | `Diff Engine` | code | Compare new payload against `last_version.snapshot`. Produces `change_set` JSON (§5.2.3) |
| S7 | `IF Has Changes` | if | `change_set.has_changes === true` ? → S8 : → S12 |
| S8 | `Apply Diff` | httpRequest | PATCH `/api/profiles/:id/apply-diff` with `change_set` (server applies surgically — see §5.2.4) |
| S9 | `Snapshot New Version` | httpRequest | POST `/api/profiles/:id/versions` with full payload + `change_set` |
| S10 | `Activity Log` | httpRequest | POST `/api/activity-log` with one entry per change (skills added, portfolio added, headline changed, etc.) |
| S11 | `Notify Admin (optional)` | httpRequest | If `change_set.notable === true`, send admin Slack/email |
| S12 | `Respond / Loop` | respondToWebhook (or splitInBatches loop) | Return `{profile_id, change_set}` |

#### Diff strategy detail

See §5.2 for full diff rules. Summary: arrays diffed as sets (added/removed); text diffed by hash compare (store both); portfolio/work-history diffed by external_id (Upwork's stable IDs).

#### Cost

- Cron: 8 profiles/day × ~$0.015/run = ~$0.12/day = $3.6/month.
- Manual: pay-per-click. Bounded.

### 4.5 `job-evaluate-manual` (NEW)

**Purpose**: admin pastes a job URL + picks a profile → return a full classifier verdict. Doesn't write to Task Board (it's a research tool, not a routing tool).

**Trigger**: `Webhook` POST `/webhook/job-evaluate-manual`, body `{job_url, profile_id, requested_by}`.

#### Node-by-node

| ID | Node | Type | Purpose |
|---|---|---|---|
| J1 | `Webhook (Manual Eval)` | webhook | Entry |
| J2 | `Validate Input` | code | Check URL is upwork.com/jobs/* + profile_id resolves |
| J3 | `Fetch via Apify (Job)` | httpRequest | Apify Upwork Job actor or POST `/api/scrape/upwork/job?url=...` |
| J4 | `Parse Apify Output` | code | Map to canonical `Job` payload (§9.7). Same shape as Vollna-fed jobs. |
| J5 | `Synthetic Wrap` | set | Compose `{profile_id, job: <parsed>, request_meta: { source: 'manual_url', task_id: null, requested_by }}` |
| J6 | `Score Relevancy` | executeWorkflow | Invoke `_relevancy-classifier-core` |
| J7 | `Format Verdict for UI` | set | Strip internal fields, add `evidence_panel` for dashboard rendering |
| J8 | `Respond` | respondToWebhook | 200 + verdict |

**No card creation.** Manual evals are read-only research; the admin can later promote to a real card if they want. The verdict IS persisted in `relevancy_scores` (via C10 inside the sub-workflow) with `evaluation_path = 'manual_url'`, so we can compare manual-eval distribution vs auto-pipeline distribution over time.

#### Latency budget (visible to user)

| Stage | p95 |
|---|---|
| J3 Apify job scrape | 5-15s |
| C1 profile context | 200ms (cached) |
| C2 deterministic | 50ms |
| C5 Gemini call | 800ms |
| Total (proceed path) | **~6-16s** |
| Total (deterministic reject) | **~5-15s** (no LLM call) |

UI shows a streaming progress indicator: "Scraping job…" → "Loading profile context…" → "Running classifier…" → result.

---

## 5. Profile Ingestion + Sync Design

### 5.1 Ingestion data sources & decision

**Decision: Apify managed scraper as primary, manual JSON paste as fallback.**

| Option | Reliability | Cost | Maintenance |
|---|---|---|---|
| **Apify Upwork actor (recommended)** | High — dedicated team handles anti-bot | $0.005-0.02/run | None on our side |
| ScrapingBee / ZenRows w/ custom selectors | Medium — selectors break on Upwork redesigns | $0.001-0.005/run | We maintain selectors |
| Self-hosted Playwright + stealth | Low — Upwork blocks frequently | $0 + infra cost | High |
| Manual paste of scraped HTML | High (admin-driven) | $0 | Admin time |

We use Apify as primary because:
1. Upwork actively rotates anti-scraping measures; we don't want to chase them.
2. Volume is small (<100 profiles/month, <10 manual job evals/day) → cost is negligible.
3. Apify exposes a synchronous "run-and-get-results" endpoint (`run-sync-get-dataset-items`) ideal for n8n HTTP nodes.

**Manual paste fallback**: if Apify returns 0 items or the profile is private, the dashboard shows a paste UI — admin pastes the parsed JSON directly (or a raw HTML blob that our backend parses with Cheerio). Same downstream flow once the JSON is normalized.

### 5.2 Sync diff algorithm

#### 5.2.1 What we diff

| Section | Diff method | Storage of history |
|---|---|---|
| `headline`, `description`, `hourly_rate`, `jss_score`, `top_rated`, `country`, `timezone` | Field-by-field equality | Both old + new in `profile_versions.snapshot` |
| `skills` (array of slugs) | Set diff: `added[]`, `removed[]` | Full array in `profile_versions.snapshot.skills` |
| `categories` (array of category slugs) | Set diff | Full array in snapshot |
| `portfolios` (array of `{external_id, ...}`) | Keyed merge by `external_id` | `profile_portfolios` rows: insert / update / mark `archived_at = NOW()` |
| `work_history` (array of `{external_id, ...}`) | Keyed merge by `external_id` | Same as portfolios |
| `tags` (array of strings) | Set diff | Full array in snapshot |

#### 5.2.2 What `external_id` looks like

Apify (and the Upwork DOM) expose stable IDs for portfolio items and work history. Example: `portfolio_id = 'abc123'`, `contract_id = '~01xyz'`. We use these as our `external_id` so we can survive ordering changes and detect renames.

If the actor doesn't expose a stable ID, we synthesize one: `sha256(title + first_50_chars_of_description)`. Lossy on title edits, but acceptable for v3.

#### 5.2.3 `change_set` JSON shape (output of S6 Diff Engine)

```jsonc
{
  "has_changes": true,
  "notable": true,                   // true if any: portfolio added/removed, headline changed, hourly_rate changed
  "summary": "1 portfolio added, 2 skills added, headline changed",
  "header": {
    "headline": { "from": "Senior Full-Stack — Laravel/React", "to": "Senior Full-Stack — Laravel/React/AI" },
    "hourly_rate": null,
    "jss_score": { "from": 97, "to": 98 },
    "top_rated": null
  },
  "skills": {
    "added": ["openai", "langchain"],
    "removed": []
  },
  "categories": {
    "added": [],
    "removed": []
  },
  "portfolios": {
    "added": [{ "external_id": "po_456", "title": "AI Customer Support Agent", "tech_stack": ["openai","next.js","postgres"] }],
    "updated": [],
    "removed": []
  },
  "work_history": {
    "added": [],
    "updated": [{ "external_id": "~01abc", "fields_changed": ["feedback_score"] }],
    "removed": []
  }
}
```

#### 5.2.4 `PATCH /api/profiles/:id/apply-diff`

Server-side endpoint applies the diff atomically:

```
BEGIN;
  -- Header
  UPDATE profiles SET headline = $1, hourly_rate = $2, ... WHERE id = $profile_id;
  -- Stack: replace strategy (we already have new full set)
  DELETE FROM profile_stacks WHERE profile_id = $profile_id;
  INSERT INTO profile_stacks (profile_id, keyword, alias_for) VALUES ...;
  -- Portfolios: upsert by external_id, archive removed
  INSERT INTO profile_portfolios (...) VALUES (...) ON CONFLICT (profile_id, external_id) DO UPDATE SET ...;
  UPDATE profile_portfolios SET archived_at = NOW() WHERE profile_id = $profile_id AND external_id = ANY($removed_ids);
  -- Work history: same
  -- Categories: replace
  -- Activity log entries (one per change)
  INSERT INTO activity_log (entity_type, entity_id, action, payload) VALUES ...;
COMMIT;
```

Returns `{success: true, applied: <change_set>}`.

#### 5.2.5 Anti-thrash

If sync runs but `change_set.has_changes === false`, we still write a `profile_versions` row but with `change_set: {has_changes: false}` and a `synced_at` timestamp. This proves the sync ran (so we can flag stale profiles where the cron hasn't seen them in 7+ days due to errors).

### 5.3 Skill normalization

#### 5.3.1 `skills_taxonomy` table

Seed with ~500 canonical skills relevant to our 8 profiles (Laravel, PHP, Node.js, React, Vue, Next.js, Nest.js, WordPress, Stripe, OpenAI, etc.). Each row:

```jsonc
{
  "slug": "laravel",
  "display_name": "Laravel",
  "category": "backend_framework",
  "aliases": ["laravel-php", "laravel-framework", "laravel 10", "laravel 11", "laravel-livewire"],
  "primary_stack_for": ["sana", "laiba"]   // which agent buckets this is core to
}
```

#### 5.3.2 Match algorithm (`/api/skills/normalize`)

```
1. Lowercase + strip punctuation + collapse whitespace.
2. Direct match on `slug` → return.
3. Match against `aliases[]` → return canonical slug.
4. Levenshtein distance ≤ 2 against any slug or alias → return with confidence=0.7.
5. No match → return { slug: null, raw: <input>, flagged: true }.
```

Flagged unknowns surface in admin's "Unmatched Skills" view — admin can promote to canonical (creates a new taxonomy row) or alias-into-existing.

#### 5.3.3 Canonical-slug-first storage

`profile_stacks.keyword` stores the canonical slug. The original raw input is stored in `profile_stacks.raw_input` for audit. This means joins ("which profiles cover Laravel") are clean: `WHERE keyword = 'laravel'` matches everything.

### 5.4 Profile context endpoint (consumed by classifier)

`GET /api/profiles/:id/context`:

```jsonc
{
  "profile": {
    "id": "uuid",
    "name": "Sana",
    "headline": "Senior Full-Stack — Laravel/React/AI",
    "stack_bucket": ["laravel","php","nodejs","react","vuejs","saas","nestjs","wordpress","nextjs","typescript"],
    "portfolio_tldr": [
      { "title": "Stripe + Laravel subscription billing", "tech_stack": ["laravel","php","stripe"] },
      { "title": "Multi-tenant SaaS auth in NestJS", "tech_stack": ["nestjs","typescript","postgres"] }
    ],
    "work_history_tldr": [
      { "client_industry": "fintech", "tech_stack": ["laravel","stripe"], "feedback_score": 5.0 }
    ],
    "hourly_rate": 65,
    "jss_score": 98,
    "top_rated": true,
    "country": "Pakistan",
    "categories": ["web-programming","scripts-utilities"]
  },
  "thresholds_overrides": {
    // optional per-profile overrides; null when default applies
    "client_spend_floor": null,
    "freshness_window_hours": 24
  },
  "criteria_version": "0.2",
  "context_generated_at": "2026-05-06T13:00:00Z"
}
```

**Caching**: Next.js wraps this with `unstable_cache` (5 min TTL); n8n's static data also caches it 1 hour as a backup. Manual sync invalidates both via tag-based revalidation.

---

## 6. Job Evaluation Flow

### 6.1 Admin pastes a job URL

#### 6.1.1 UI sequence

1. Admin opens `/relevancy-evaluator`.
2. Paste box: "Upwork job URL" (validated client-side to start with `https://www.upwork.com/jobs/`).
3. Profile picker: dropdown of all active `profiles`.
4. Click "Evaluate" → loading state.
5. UI POSTs `/api/relevancy/evaluate` with `{job_url, profile_id}`.
6. Backend forwards to n8n `job-evaluate-manual` webhook (synchronous; n8n returns when verdict is ready).
7. UI streams progress via Server-Sent Events: 4 stages (validate → scrape → load profile → classify).
8. Result panel renders:
   - Headline verdict (proceed / reject / review) + tier
   - Hard gate grid (11 rows: pass/fail/skipped, evidence)
   - Rubric breakdown (7 components, value/max, reason)
   - Top 3 proposal angles (only on proceed)
   - "Save to Task Board" button (creates a real card with `_source = 'manual_eval'`)
   - "Re-run" button (forces fresh scrape — bypasses any 1h job cache)

#### 6.1.2 What's persisted

Every manual evaluation writes:

- One row to `manual_job_evaluations` (the request: who, when, URL, profile)
- One row to `relevancy_scores` (the verdict; `evaluation_path = 'manual_url'`)

Linked by `manual_job_evaluations.score_id → relevancy_scores.id`.

**No** Task Board card is created automatically — manual eval is a research tool. The admin can promote to a card with the explicit button.

### 6.2 Job extraction schema

Apify job actor returns an envelope; we normalize to:

```jsonc
{
  "job_id": "~01abc123",                      // Upwork's stable job ID
  "url": "https://www.upwork.com/jobs/~01abc123",
  "title": "Build Laravel Stripe integration for SaaS billing",
  "description": "We need a senior dev to integrate...",
  "skills_required": ["laravel","stripe","php","api"],   // canonical slugs after normalization
  "skills_required_raw": ["Laravel","Stripe","PHP","API"],
  "category": "web-programming",
  "subcategory": "ecommerce-development",
  "budget_type": "hourly",                    // or "fixed"
  "budget_min": 35,
  "budget_max": 60,
  "fixed_amount": null,
  "client": {
    "country": "United States",
    "total_spent": 18355,
    "hires": 26,
    "rating": 4.97,
    "payment_verified": true,
    "member_since": "2018-04-12"
  },
  "proposals_count": 12,
  "interviewing_count": 1,
  "invites_sent_count": 0,
  "hires_made_count": 0,
  "posted_at": "2026-05-06T08:14:00Z",
  "source": "manual_url",                     // or "vollna" for auto pipeline
  "scraped_at": "2026-05-06T13:01:22Z"
}
```

Vollna-fed jobs already arrive in this shape (they're parsed by `Process Job` in the existing workflow). Manual URL-fetched jobs land in the same shape after Apify + parser, so the classifier sees identical input regardless of front door.

### 6.3 The classifier doesn't care about the front door

Inside `_relevancy-classifier-core`, the per-job user message is the same JSON shape. The only difference is `request_meta.source` (`auto` vs `manual_url`) which we store in `relevancy_scores.evaluation_path` for analytics — never used for decision logic. This is the v3 design's biggest leverage: one classifier, three callers.

### 6.4 Promote-to-card flow

If admin clicks "Save to Task Board" on a manual eval:

```
POST /api/relevancy/promote-to-card
  body: { score_id, target_column }   // target_column defaults to verdict.decision mapping
→ creates a `tasks` row with custom_fields.{_source: 'manual_eval', _job_id, _relevancy_*}
→ writes activity log
→ returns {task_id}
```

UI navigates to the new Task Board card. From this point forward it behaves like any other card.

---

## 7. Relevancy Scoring Model

### 7.1 Layered architecture (carried over from v2 §4.1)

- **Layer 1 — 11 Hard gates.** Any single fail → `decision: reject` with verbatim PRD §6.2 label(s).
- **Layer 2 — 7-component rubric (0-100).** Only when Layer 1 fully passes.

### 7.2 What changes in v3 vs v2

#### 7.2.1 Gate 1 (`stack_match`) — now hybrid deterministic + LLM

v2: pure LLM check.
v3:
1. **Deterministic first** — does the canonical-slug intersection of `job.skills_required` and `profile.stack_bucket` produce a non-empty set? If yes AND set size ≥ 1 strong-match keyword → pass deterministically (skip LLM for this gate).
2. **LLM fallback** — if deterministic returns empty (no overlap) OR ambiguous (only weak matches like generic "API"), defer to LLM with the alias map provided.

This catches the obvious cases (Laravel job + Laravel profile) at zero LLM cost and only burns tokens when the call requires semantic judgment ("Headless CMS dev" job vs profile listing "WordPress + Next.js").

#### 7.2.2 Gate 10 (`portfolio_match`) — now hybrid

v2: pure LLM check.
v3:
1. **Deterministic first** — `EXISTS (SELECT 1 FROM profile_portfolios WHERE profile_id = $X AND tech_stack && $job_skills)` (Postgres array overlap). If at least one row matches → pass.
2. **LLM fallback** — if no overlap, the LLM gets the full portfolio TL;DR and decides whether anything is "close enough" semantically.

#### 7.2.3 Rubric anchoring with real work history

v2 rubric component `domain_match` was an LLM guess from `headline`. v3 passes `profile.work_history_tldr` (top 5 contracts with industry, tech_stack, feedback) so `domain_match` and `skill_match` have concrete evidence to cite.

This raises rubric stability — the LLM is no longer reasoning from a 200-char headline.

#### 7.2.4 Per-profile threshold overrides

`profiles.thresholds_overrides JSONB` (new column) — a profile owner can override the default threshold per gate. Example: Khansa allowed to bid on lower-spend clients ($500 vs default $1000). Loaded by C1, included in `relevancy_scores.thresholds_used` for audit.

### 7.3 The full gate table (v3)

Identical to v2 §4.2 but with the deterministic/LLM split column updated:

| Gate | Threshold | Reason label | v3 checker |
|---|---|---|---|
| 1 stack_match | ≥1 strong-match keyword | `Out of stack` | **Deterministic first**, LLM fallback |
| 2 freshness | ≤24h | `Old job` | Deterministic |
| 3 proposal_saturation | <30 | `Too many invites` | Deterministic |
| 4 hourly_floor | ≥$25 (if hourly) | `Low Higher rate` | Deterministic (structured) / LLM (text) |
| 5 client_spend_floor | ≥$1,000 | `Client Low spending` | Deterministic |
| 6 client_rating_floor | ≥4.0 (or null + 0 hires) | `Bad rating client` | Deterministic |
| 7 job_availability | open | `Job unavailable` / `Already hired` | LLM (text scan) |
| 8 no_location_lockin | no residency lock | `Location loc` | LLM (semantic) |
| 9 no_video_proposal | no video required | `Video Proposal` | LLM (text scan) |
| 10 portfolio_match | ≥1 mappable item | `Portfolio unavailable` | **Deterministic first**, LLM fallback |
| 11 no_duplicate | not seen 30d | `Duplicate` | Deterministic |

After v3's hybrid changes: **6 gates fully deterministic, 2 hybrid, 3 LLM-only.** When all hybrids resolve deterministically, the LLM only needs to evaluate gates 7, 8, 9 + the rubric — significantly tightening the prompt and the token cost.

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
| Manual job eval | 1 | Always Mode A (paranoid; admin wants full breakdown) |
| Profile ingest | 0 | Pure scrape + persist |
| Profile sync | 0 | Pure scrape + diff |

Single call per evaluation. No fan-out, no second-pass review.

---

## 9. Data Schemas

### 9.1 Migration 017 — extended profile model

```sql
-- Existing `profiles` extended
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS upwork_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS headline TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS jss_score INTEGER CHECK (jss_score BETWEEN 0 AND 100);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS top_rated BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(12,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS thresholds_overrides JSONB DEFAULT '{}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ingest_status TEXT DEFAULT 'pending'
  CHECK (ingest_status IN ('pending','partial','complete','failed'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_profiles_active_url ON profiles (active, upwork_url) WHERE upwork_url IS NOT NULL;
```

### 9.2 Migration 017 — `profile_stacks` (v2 schema kept; v3 adds `raw_input`)

```sql
CREATE TABLE IF NOT EXISTS profile_stacks (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,             -- canonical slug from skills_taxonomy
  raw_input   TEXT,                       -- original string from Apify
  alias_for   TEXT,                       -- denormalized canonical_slug if keyword is an alias
  source      TEXT DEFAULT 'apify' CHECK (source IN ('apify','manual','seed')),
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_profile_stacks_keyword ON profile_stacks (LOWER(keyword));
CREATE INDEX IF NOT EXISTS idx_profile_stacks_profile ON profile_stacks (profile_id);
```

### 9.3 Migration 017 — `profile_portfolios`, `profile_work_history`, `profile_categories`

```sql
CREATE TABLE IF NOT EXISTS profile_portfolios (
  id           BIGSERIAL PRIMARY KEY,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  external_id  TEXT,                      -- Upwork's stable portfolio ID (or sha256 fallback)
  title        TEXT NOT NULL,
  description  TEXT,
  tech_stack   TEXT[],                    -- canonical slugs
  url          TEXT,
  thumbnail_url TEXT,
  position     INTEGER,
  archived_at  TIMESTAMPTZ,               -- non-null = removed in latest sync
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_portfolios_profile ON profile_portfolios (profile_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_profile_portfolios_techstack ON profile_portfolios USING GIN (tech_stack);

CREATE TABLE IF NOT EXISTS profile_work_history (
  id              BIGSERIAL PRIMARY KEY,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  external_id     TEXT,
  contract_title  TEXT,
  client_industry TEXT,
  tech_stack      TEXT[],
  contract_type   TEXT,
  hourly_rate     NUMERIC(8,2),
  fixed_amount    NUMERIC(12,2),
  hours_worked    NUMERIC(8,2),
  feedback_score  NUMERIC(3,2),
  feedback_text   TEXT,
  started_at      DATE,
  ended_at        DATE,
  archived_at     TIMESTAMPTZ,
  UNIQUE (profile_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_work_history_profile ON profile_work_history (profile_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS profile_categories (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,              -- e.g. "web-programming"
  subcategory TEXT,
  is_primary  BOOLEAN DEFAULT FALSE,
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, category, subcategory)
);
```

### 9.4 Migration 017 — `skills_taxonomy`

```sql
CREATE TABLE IF NOT EXISTS skills_taxonomy (
  slug          TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  category      TEXT NOT NULL,           -- e.g. "backend_framework", "language", "service"
  aliases       TEXT[] DEFAULT '{}',
  primary_for   TEXT[] DEFAULT '{}',     -- agent names this skill is core to
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skills_aliases ON skills_taxonomy USING GIN (aliases);
```

Seed query (sample, full seed in `src/lib/seeds/skills_taxonomy.sql`):

```sql
INSERT INTO skills_taxonomy (slug, display_name, category, aliases, primary_for) VALUES
  ('laravel', 'Laravel', 'backend_framework', ARRAY['laravel-php','laravel-framework','laravel 10','laravel 11'], ARRAY['sana','laiba']),
  ('react',   'React',   'frontend_framework', ARRAY['reactjs','react.js','react-native','react js'], ARRAY['sana','khansa','shayan']),
  ('nextjs',  'Next.js', 'frontend_framework', ARRAY['next.js','next js','next-js','nextjs 13','nextjs 14','nextjs 15'], ARRAY['sana','khansa','shayan']),
  ...;
```

### 9.5 Migration 017 — `relevancy_scores` (extended from v2)

```sql
CREATE TABLE IF NOT EXISTS relevancy_scores (
  id                BIGSERIAL PRIMARY KEY,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  job_external_id   TEXT,
  profile_id        UUID REFERENCES profiles(id),
  decision          TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),
  rejection_reasons TEXT[],
  gates_passed      INTEGER[],
  gates_failed      INTEGER[],
  gates_evidence    JSONB,                       -- per-gate evidence for audit
  components        JSONB,
  total_score       INTEGER,
  tier              TEXT,
  confidence        NUMERIC(4,3),
  proposal_angles   TEXT[],
  ai_relevant       BOOLEAN,
  ai_score          NUMERIC(4,3),
  heuristic         JSONB,
  evidence_panel    JSONB,
  summary           TEXT,
  missing_signals   TEXT[],
  thresholds_used   JSONB,
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  prompt_mode       TEXT NOT NULL CHECK (prompt_mode IN ('A_full','B_edge')),
  criteria_version  TEXT NOT NULL,
  evaluation_path   TEXT NOT NULL CHECK (evaluation_path IN ('deterministic','llm','llm_after_deterministic','manual_url','shadow')),
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  source            TEXT CHECK (source IN ('auto','manual_url')),
  requested_by      TEXT,
  evaluated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rs_task        ON relevancy_scores (task_id);
CREATE INDEX IF NOT EXISTS idx_rs_profile     ON relevancy_scores (profile_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_decision    ON relevancy_scores (decision);
CREATE INDEX IF NOT EXISTS idx_rs_evaluated   ON relevancy_scores (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_source      ON relevancy_scores (source, evaluated_at DESC);
```

### 9.6 Migration 017 — `manual_job_evaluations`, `relevancy_overrides`, `profile_versions`, `criteria_versions`

```sql
CREATE TABLE IF NOT EXISTS manual_job_evaluations (
  id              BIGSERIAL PRIMARY KEY,
  job_url         TEXT NOT NULL,
  profile_id      UUID NOT NULL REFERENCES profiles(id),
  score_id        BIGINT REFERENCES relevancy_scores(id),
  promoted_to_task_id UUID REFERENCES tasks(id),
  requested_by    TEXT NOT NULL,
  scrape_status   TEXT CHECK (scrape_status IN ('success','partial','failed')),
  scrape_error    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mje_profile ON manual_job_evaluations (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS relevancy_overrides (
  id              BIGSERIAL PRIMARY KEY,
  score_id        BIGINT NOT NULL REFERENCES relevancy_scores(id),
  task_id         UUID NOT NULL REFERENCES tasks(id),
  classifier_decision TEXT NOT NULL,
  agent_action    TEXT NOT NULL,                  -- e.g. 'moved_to_na', 'moved_to_proposal_submitted'
  agent_id        UUID REFERENCES agents(id),
  override_reason TEXT[],                         -- multi-select, mirrors PRD §6.2 labels
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_overrides_score ON relevancy_overrides (score_id);

CREATE TABLE IF NOT EXISTS profile_versions (
  id              BIGSERIAL PRIMARY KEY,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  snapshot        JSONB NOT NULL,
  change_set      JSONB NOT NULL,
  source          TEXT CHECK (source IN ('initial','manual_sync','cron_sync')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pv_profile ON profile_versions (profile_id, version_number DESC);

CREATE TABLE IF NOT EXISTS criteria_versions (
  version          TEXT PRIMARY KEY,
  prd_changelog    TEXT NOT NULL,
  thresholds       JSONB NOT NULL,         -- snapshot of all gate thresholds
  reason_enum      TEXT[] NOT NULL,        -- snapshot of valid rejection reasons
  prompt_versions  TEXT[],                 -- which prompt versions are compatible
  effective_at     TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.7 Job payload schema (canonical, used everywhere)

See §6.2.

### 9.8 Profile ingest payload (output of P4 / S4)

```jsonc
{
  "profile_id": "uuid",
  "header": {
    "headline": "Senior Full-Stack — Laravel/React/AI",
    "description": "I help SaaS teams ship Laravel + React + AI integrations...",
    "hourly_rate": 65.00,
    "jss_score": 98,
    "top_rated": true,
    "total_earnings": 425000,
    "country": "Pakistan",
    "timezone": "Asia/Karachi"
  },
  "skills": [
    { "slug": "laravel", "raw_input": "Laravel", "flagged": false },
    { "slug": "openai", "raw_input": "OpenAI", "flagged": false },
    { "slug": null, "raw_input": "Custom CMS Migration", "flagged": true }
  ],
  "categories": [
    { "category": "web-programming", "subcategory": "ecommerce-development", "is_primary": true }
  ],
  "portfolios": [
    {
      "external_id": "po_12345",
      "title": "Stripe + Laravel subscription billing",
      "description": "Built end-to-end SaaS billing...",
      "tech_stack": ["laravel","stripe","php","postgres"],
      "url": "https://www.upwork.com/...",
      "thumbnail_url": "https://...",
      "position": 0
    }
  ],
  "work_history": [
    {
      "external_id": "~01abc",
      "contract_title": "Laravel SaaS billing migration",
      "client_industry": "fintech",
      "tech_stack": ["laravel","stripe","mysql"],
      "contract_type": "hourly",
      "hourly_rate": 65,
      "hours_worked": 156,
      "feedback_score": 5.0,
      "feedback_text": "...",
      "started_at": "2025-09-01",
      "ended_at": "2026-01-15"
    }
  ],
  "tags": ["AI", "Stripe", "SaaS"],
  "raw_apify_run_id": "abcdef-12345",
  "scraped_at": "2026-05-06T13:00:00Z"
}
```

### 9.9 Activity log additions

```sql
-- New action types written by S10
INSERT INTO activity_log (entity_type, entity_id, action, payload) VALUES
  ('profile', $profile_id, 'profile_synced', '{"version": 5, "summary": "1 portfolio added, 2 skills added"}'),
  ('profile', $profile_id, 'profile_skill_added', '{"slug": "openai", "raw": "OpenAI"}'),
  ('profile', $profile_id, 'profile_portfolio_added', '{"external_id":"po_456","title":"AI Agent"}'),
  ('profile', $profile_id, 'profile_headline_changed', '{"from":"...","to":"..."}');
```

---

## 10. Admin Dashboard Design

### 10.1 Routes

| Route | Component | Server data |
|---|---|---|
| `/profiles` (admin only) | `ProfilesIndex` | List with last-synced, JSS, status |
| `/profiles/new` | `ProfileCreateModal` | Form: name + Upwork URL → fires ingest |
| `/profiles/:id` | `ProfileDetail` | Tabs: Overview / Stack / Portfolio / Work History / Categories / Versions |
| `/profiles/:id/sync` | (action; modal) | "Sync Now" button + diff preview |
| `/relevancy-evaluator` | `JobEvaluator` | Paste URL + profile picker + result panel |
| `/relevancy-audit` | `RelevancyAudit` | Time-series, gate-fail rates, override rate |

All admin-only. Agent role gets a redirect to `/my-dashboard`.

### 10.2 Profile detail page

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Profile · Sana                                                  [Edit] [Sync Now]  │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Headline:    Senior Full-Stack — Laravel/React/AI                                 │
│ Hourly:      $65/hr · JSS 98 · Top Rated · Earned $425k                          │
│ URL:         https://www.upwork.com/freelancers/sana                              │
│ Last synced: 2 hours ago      Status: complete                                    │
├──────────┬──────────┬────────────┬──────────────┬──────────────┬─────────────────┤
│ Overview │ Stack 24 │ Portfolio 9│ Work Hist 47 │ Categories 3 │ Versions 12     │
├──────────┴──────────┴────────────┴──────────────┴──────────────┴─────────────────┤
│ [Stack tab]                                                                        │
│ [laravel] [php] [react] [vuejs] [nextjs] [stripe] [openai] [postgres]            │
│ [+ Add manually]                                  Unmatched: "custom-cms" [Map]   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

#### "Sync Now" UX

1. Click → POST `/api/profiles/:id/sync` → forwards to n8n.
2. UI shows spinner with stages (Fetch → Parse → Diff → Apply).
3. On success: modal opens with `change_set` rendered as a diff panel:

```
What changed:
  + 1 portfolio added: AI Customer Support Agent (openai, next.js, postgres)
  + 2 skills added: openai, langchain
  ~ Headline changed:
      old: Senior Full-Stack — Laravel/React
      new: Senior Full-Stack — Laravel/React/AI
  ~ JSS: 97 → 98
                                                 [Discard] [Save changes]
```

If admin clicks "Save changes" → already saved (n8n applied surgically); button just dismisses.
If admin clicks "Discard" → POST `/api/profiles/:id/versions/:vN/revert` reverses to prior version.

### 10.3 Job Evaluator page

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Relevancy Evaluator                                                                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Job URL:   [https://www.upwork.com/jobs/~01abc...                          ] [↻]  │
│ Profile:   [Sana ▼]                                                                │
│                                                          [Evaluate]                │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ⏳ Scraping job → Loading profile context → Running classifier...                  │
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
│ [↻ Re-run] [Save to Task Board ▼] [Copy verdict JSON]                             │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 10.4 Relevancy Audit page

| Tile | Source query | Purpose |
|---|---|---|
| Decision distribution (proceed / reject / review) | `SELECT decision, COUNT(*) FROM relevancy_scores WHERE evaluated_at >= ?` | Sanity baseline |
| Gate-fail rate × profile × week | `SELECT profile_id, unnest(gates_failed), COUNT(*) FROM relevancy_scores GROUP BY ...` | "Is Khansa rejecting more 'Out of stack' than Sana?" (PRD §10.4) |
| Classifier-vs-agent agreement | `JOIN relevancy_scores rs ON rs.task_id = tasks.id; agreement = rs.decision='reject' AND tasks.column = N/A` | Accuracy metric |
| Override rate | `COUNT(relevancy_overrides) / COUNT(relevancy_scores) WHERE source='auto'` | "How often do agents disagree with the classifier?" |
| Latency p95 by mode | `percentile_cont(0.95) FROM relevancy_scores GROUP BY prompt_mode` | Performance SLO |
| Cost projection | `SUM(input_tokens + output_tokens) × $/token` | Monthly burn |

### 10.5 Data flow: frontend → backend → n8n

```
React Component (SyncNowButton)
  │ click
  ▼
useMutation(POST /api/profiles/:id/sync)
  │
  ▼
Next.js Route Handler (validates session, looks up profile, signs payload)
  │ POST + Bearer + HMAC
  ▼
n8n Webhook (profile-sync entry)
  │ Apify → diff → apply → version
  ▼
Next.js callback API routes (PATCH profile, POST versions, POST activity_log)
  │
  ▼
Next.js Route Handler returns 200 + change_set
  │
  ▼
React useMutation onSuccess → revalidate `/profiles/:id` → diff modal renders
```

All n8n → Next.js callbacks use the same `n8n-board-sync` Bearer token already in production (CLAUDE.md). No new credentials.

---

## 11. Performance + Cost Considerations

### 11.1 Cost summary

| Service | Driver | Monthly cost @ baseline (40 jobs/day, 8 profiles) |
|---|---|---|
| Apify (job scrapes) | 10 manual evals/day × 30 = 300 runs | ~$3-6 |
| Apify (profile scrapes) | 8 cron syncs/day × 30 = 240 runs | ~$2.40-5 |
| Apify (profile ingest) | <5/month (one-time per new profile) | <$0.50 |
| Gemini Flash 2.5 (auto pipeline) | ~780 LLM calls/month (60% × 1300 jobs) | ~$5.60 (v2 baseline) |
| Gemini Flash 2.5 (manual evals) | 300 calls/month, full Mode A | ~$2.40 |
| Postgres (Contabo) | Existing infra | $0 incremental |
| **Total monthly** | | **~$14-20** |

Scales linearly with traffic. At 400 jobs/day (10× baseline) → ~$50-80/month.

### 11.2 Latency budget (v3 fresh, no cache)

| Front door | Target p95 | Stages |
|---|---|---|
| Auto pipeline (deterministic reject) | ~250ms | C1 + C2 + write |
| Auto pipeline (LLM proceed) | ~1.5s | C1 + C2 + C5 + write |
| Manual job eval | ~6-16s | + Apify scrape (5-15s) |
| Profile ingest | ~10-30s | Apify + persist |
| Profile sync (no changes) | ~5-15s | Apify + diff |
| Profile sync (with changes) | ~6-20s | + apply |

The auto pipeline stays inside the existing 5-20s end-to-end PRD §10.4 budget. The dominant tail is Vollna (memory `latency_vollna_bound.md`: p95 = 10 minutes) — adding the classifier adds <2s, which is invisible against that tail.

### 11.3 Throughput

- Apify: per-actor concurrency limits typically allow ~10-50 concurrent runs on standard plan. Plenty for our cron + manual usage.
- Gemini: 1000 RPM, 1M tokens/min. We're at ~30-50 RPM peak. Plenty.
- n8n cloud workflow: ~10 RPS sustained. Plenty.
- Postgres: writes are tiny (<10 KB/scoring; <100 KB/profile sync). Plenty.

### 11.4 Caching strategy

| Layer | What | TTL | Invalidator |
|---|---|---|---|
| Next.js `unstable_cache` | `/api/profiles/:id/context` response | 5 min | Profile sync action |
| n8n static data | Profile context fallback | 1 hour | None (TTL only) |
| Gemini implicit cache | System instruction (Mode A & B separately) | Provider-managed | None |
| Postgres query cache | `relevancy_scores` aggregates for audit page | 60s | None (read-only analytics) |

### 11.5 Observability hooks

| Signal | Source | Surface |
|---|---|---|
| Per-call token + latency | C10 → relevancy_scores | Audit page |
| Override rate weekly | View on `relevancy_overrides` | Audit page |
| Stale profile alert | `profiles WHERE last_synced_at < NOW() - INTERVAL '48 hours'` | Admin nav badge |
| Apify failure rate | n8n executions filter | n8n exec page; alert if > 5%/day |
| Gemini error rate | n8n executions filter | Same |
| Unmatched skills queue | `profile_stacks WHERE keyword NOT IN (SELECT slug FROM skills_taxonomy)` | Admin "Skills review" page |

### 11.6 Failure modes & blast radius

| Failure | Blast | Mitigation |
|---|---|---|
| Apify down | Profile ingest/sync unavailable; manual evals unavailable. Auto pipeline UNAFFECTED (Vollna feeds it directly). | Manual JSON paste fallback; classifier core untouched |
| Apify rate-limit | Cron syncs queue up | Split In Batches at 1 req/30s |
| Gemini API down | Auto pipeline + manual evals fall to review; cards still flow but unscored | Existing v2 behavior: review queue, no silent loss |
| Postgres write fails during sync | Profile partial-state | `ingest_status = 'partial'` flag; admin sees yellow banner |
| Apify returns garbage (Upwork DOM change) | All scrapes return 0 items | Alert when 3+ consecutive scrapes return empty; switch to fallback actor |
| Skills taxonomy stale | Many "flagged" unknowns | Admin queue; promote regularly |

---

## 12. Future Enhancements

### 12.1 v3.x (post-launch, low effort)

| # | Enhancement | Effort | Trigger |
|---|---|---|---|
| 1 | Bulk profile sync UI (sync all 8 with one click) | 4h | Demand from admin team |
| 2 | "Why did this fail?" deep-dive: click a failed gate in audit, see all examples | 1d | Calibration cycles |
| 3 | Slack notification on apply_now tier (per-profile opt-in) | 4h | PRD §10.5 v1 |
| 4 | A/B prompt versioning (10% to v_next, compare outcomes) | 2d | Tuning rubric weights |
| 5 | Cron-based shadow scoring of Vollna jobs that bypassed n8n | 1d | Data completeness |

### 12.2 v4 (medium effort)

| # | Enhancement | Effort | Why |
|---|---|---|---|
| 1 | Profile auto-creation: paste URL → entire profile + agent provisioned | 1w | Onboarding speed |
| 2 | Skill-level win-rate analytics (post PRD §9.3 fix) | 1w | "Which skills convert?" |
| 3 | Vollna feed auto-tightening: take recurring `Out of stack` keywords and propose Vollna config edits | 1w | PRD §10.6 |
| 4 | Cross-platform support (Freelancer, Fiverr) — extra Apify actors + parsers | 2w | Demand-driven |
| 5 | Live job-watcher: monitor a saved search URL hourly, evaluate each new job, alert on apply_now | 1w | Premium positioning |

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
| `profile-ingest` (NEW) | Low — manual trigger only | n8n-keeper | No |
| `profile-sync` (NEW) | Low for manual / Medium for cron | n8n-keeper | Pause cron during edit |
| `job-evaluate-manual` (NEW) | Low — admin tool | n8n-keeper | No |

### 13.4 Migration 017 update strategy

- **Idempotency** — every `CREATE TABLE` uses `IF NOT EXISTS`; every `ALTER TABLE` uses `ADD COLUMN IF NOT EXISTS`. Re-runs are safe.
- **Order** — run migration 017 BEFORE deploying any code that reads the new columns. The columns are nullable so old code keeps working.
- **Forward compatibility** — code MUST treat new columns as optional for one full deploy cycle (write old + new, read old fallback to new) until all instances are upgraded. Contabo is single-instance so this is moot in practice, but the plan should not assume it forever.
- **Rollback** — additive migrations are not reversible without data loss. A rollback script `017_rollback.sql` ships alongside but only DROPs the new tables (`profile_*`, `skills_taxonomy`, `relevancy_*`, `manual_job_evaluations`, `criteria_versions`) — the additive `ALTER TABLE profiles ADD COLUMN …` columns stay (they're nullable and harmless).
- **Pre-deploy snapshot** — `pg_dump` the affected schemas to a timestamped file in `/var/backups/postgres/` on Contabo before applying.

### 13.5 Shadow-mode rollout (Phase 17 expansion)

Phase 17 in Appendix B says "Shadow rollout, 1 week, write to log only." Operationalized:

1. `Score Relevancy` node ships with `decision` output **NOT WIRED** to the routing branch. The IF after it stays on its v0 (`{{$json.decision === 'proceed'}}`) but downstream of that IF, both branches go to `Build GPT Input` — i.e. the classifier opinion is recorded but ignored.
2. `relevancy_scores` rows accumulate with `request_meta.shadow = true`.
3. Daily review by Waqas: pivot decisions × actual agent action 24h later. If classifier-says-reject + agent-moves-to-N/A agreement ≥ 85% on Day 7 → flip to active routing (Phase 19).
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
- Apify spend spikes >3× expected
- Gemini error rate >10% over 50+ calls
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

### 14.3 Rollback procedure (database, migration 017)

The forward migration is fully additive. A true rollback (drop tables, drop columns) is only safe if NO code is reading the new schema yet. Procedure:

```
# Only if zero relevancy_scores rows exist AND no /api/profiles/:id/context
# call has touched the new tables

psql -f src/lib/migrations/017_rollback.sql
```

If data exists in any new table → do NOT drop. Instead:
- Stop reads (revert dashboard code first)
- Leave tables in place; they're inert until something queries them

The new ALTER TABLE columns on `profiles` (nullable) are harmless and never need to be dropped.

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
| `pg_dump` snapshot | Before migration 017 | 90 days | DB rollback |

The "newest stable" rule: only one file at a time has the `(working)` suffix. After a 7-day-clean window, rename the new snapshot, archive the previous stable, and update `CLAUDE.md` and the rollback memory entry to point at the new file.

### 14.6 What MUST NOT be rolled back

- Migration 017 column additions on `profiles` (nullable, harmless)
- `criteria_versions` rows (they're append-only audit history)
- `relevancy_scores` rows in shadow mode (they're observation-only)

Rolling these back loses calibration evidence with no upside.

---

## 15. Execution Requirements

The user (Waqas) MUST provide the following before Phase 1 of Appendix B can start. This list is exhaustive — engineering will block on any missing item.

### 15.1 API keys & secrets

| Secret | Provider | Where it lives | Used by |
|---|---|---|---|
| `APIFY_TOKEN` | Apify | n8n credentials + Next.js env | `Fetch via Apify` HTTP nodes; `/api/scrape/upwork/*` |
| Apify **profile actor ID** | Apify | n8n env `APIFY_PROFILE_ACTOR_ID` | `profile-ingest`, `profile-sync` |
| Apify **job actor ID** | Apify | n8n env `APIFY_JOB_ACTOR_ID` | `job-evaluate-manual` |
| `GEMINI_API_KEY` | Google AI Studio | n8n credentials | `_relevancy-classifier-core` |
| `PROFILE_INGEST_TOKEN` | Generated (32-byte random) | n8n Header Auth credential + dashboard env | Webhook auth on `profile-ingest` |
| `PROFILE_SYNC_TOKEN` | Generated | Same | Webhook auth on `profile-sync` |
| `MANUAL_EVAL_TOKEN` | Generated | Same | Webhook auth on `job-evaluate-manual` |
| `CRITERIA_PRD_VERSION` | Hardcoded `0.2` | n8n env | Embedded in classifier prompt; mirrors `criteria_versions.version` |
| `RELEVANCY_CLASSIFIER_ENABLED` | Boolean | n8n env | Kill-switch (§13.5) |
| `N8N_API_KEY` | n8n cloud | Dashboard env (already present) | Profile webhook auto-provisioning |
| `N8N_API_URL` | `https://ikonicdev.app.n8n.cloud/api/v1` | Dashboard env (already present) | Same |
| `n8n-board-sync` Bearer | Existing | Dashboard env (already present) | n8n → Next.js callbacks |
| (Optional) `SLACK_ALERT_WEBHOOK` | Slack | Dashboard env | Relevancy + sync alerts |

### 15.2 Third-party accounts

| Account | Plan | Why | Cost ceiling |
|---|---|---|---|
| **Apify** | Personal/Team with $5+ credit | Profile + job scraping. Free tier insufficient for cron. | Set hard cap at $30/mo via Apify settings |
| **Google AI Studio** | Free tier OK at current volume | Gemini Flash 2.5. Move to paid if traffic >10× baseline. | N/A on free; budget alert at $20/mo if paid |
| **Slack** (optional) | Existing workspace | Alerting | Free |

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
| 1 | Apify actor selection | Run a 4-hour spike comparing `apify/upwork-public-profile-scraper` vs `epctex/upwork-scraper` | n8n-keeper or Waqas runs the spike |
| 2 | Profile-thresholds storage | JSONB column vs dedicated table | v3 picks JSONB; user confirms |
| 3 | Manual eval against `active=false` profiles allowed? | Yes/No | v3 default: yes |
| 4 | Override "why" prompt | Optional input vs required | v3 default: optional |
| 5 | Skills taxonomy seed source | Hand-curate ~500 vs scrape | v3 default: hand-curate |
| 6 | Reason label typo migration timing | Pre-launch vs post-shadow | v3 default: post-shadow |
| 7 | Apify per-URL cache TTL | 0 / 5min / 1hr / 24hr | v3 default: 1h profile, 0 job |
| 8 | Cron sync `active=false` profiles | Skip vs include | v3 default: skip |

### 15.5 Stakeholder sign-offs

- **PRD freeze** — `docs/job_relevancy_criteria_prd.md` v0.2 (already signed per current state).
- **Vollna pause window approval** — for high-risk n8n splices and shadow-rollout calibration cycles.
- **Per-agent threshold approvals** — each agent (or owner) signs off on their `thresholds_overrides` JSONB before active rollout.
- **Cost ceilings** — explicit Apify + Gemini monthly cap from Waqas.

### 15.6 Things that are NOT required from the user

For clarity on scope:

- ClickUp credentials — ClickUp is fully decommissioned (see CLAUDE.md). Do not request.
- New Vercel env vars — Vercel is decommissioned.
- New Postgres database — uses existing Contabo Postgres.
- Custom n8n hosting — uses existing n8n cloud.
- New domain or SSL — Contabo over HTTP; HTTPS is post-domain (CLAUDE.md).

---

## 16. Identified Gaps & Production-Readiness Recommendations

This section catalogs gaps in v3 (as written before this revision) and provides actionable recommendations. Every recommendation is non-breaking for existing functionality.

### 16.1 Security hardening

| # | Gap | Risk | Recommendation |
|---|---|---|---|
| S1 | No SSRF protection on `/api/scrape/upwork/*` proxy routes | Admin (or attacker if endpoint leaks) can pass arbitrary URLs to Apify, leaking internal hosts via DNS lookups | Server-side allowlist: only `https://www.upwork.com/...` hosts. Reject anything else with 400. Validate post-redirect target too. |
| S2 | `requested_by` taken from request body | Spoofable — could falsely attribute manual evals | Always derive `requested_by` from `getServerSession()`, never from body. Body field, if present, is ignored. |
| S3 | HMAC signing on n8n → Next.js callbacks not detailed | Replay risk on `/api/webhook/n8n` and the new callback endpoints | Document the signing scheme: `X-Signature: sha256=<hmac(body, secret)>` + `X-Timestamp` + 5-min replay window. Reject duplicates by `(timestamp, hash)` cache (Redis or in-process LRU). |
| S4 | No rotation policy for `PROFILE_INGEST_TOKEN`, `MANUAL_EVAL_TOKEN`, `n8n-board-sync` | Long-lived secrets are exposure-prone | Rotate every 90 days. Store rotation date in n8n env metadata. Issue with `crypto.randomBytes(32).toString('hex')`. |
| S5 | No CSRF on admin POST forms (`/profiles/new`, `/relevancy-evaluator`) | CSRF can fire actions on behalf of logged-in admin | NextAuth v5 ships CSRF tokens for credentials flow; ensure they're applied to all admin POSTs (Server Actions handle this automatically — explicit fetch calls do NOT). |
| S6 | Profile description / job description / portfolio description rendered in HTML | XSS risk if Apify returns malicious content | Always render via React (escapes by default). NEVER use `dangerouslySetInnerHTML` on scraped content. If a description contains markdown, sanitize via `dompurify` first. |
| S7 | `upwork_url` length unbounded | DoS via giant URL | Server-side validate ≤2048 chars. |
| S8 | Apify proxy auth missing | Unauthenticated scrape proxy = abuse vector | Require admin session OR n8n-board-sync Bearer. Rate-limit per session at 30 req/min. |
| S9 | PII in logs (job descriptions, profile bios) | Privacy leak | Scrub `description`, `feedback_text`, `headline` from log payloads. Log only IDs + outcome. |
| S10 | No data retention policy | `relevancy_scores` and `activity_log` grow unbounded | 12-month retention on `relevancy_scores`, 90-day on `profile_versions` snapshots (keep change_set forever, prune full snapshot blob), 180-day on `activity_log`. Add nightly prune cron. |
| S11 | No PII export/erasure pathway for scraped Upwork profiles | If the Upwork user requests deletion, no defined process | Document: profile owner can call `DELETE /api/profiles/:id/scraped-data` which wipes `profile_*` rows but keeps the dashboard `profiles` row (agent assignments, scoring history). |

### 16.2 Validation & schema enforcement

| # | Gap | Recommendation |
|---|---|---|
| V1 | No Zod schemas on API request bodies | Define a shared Zod schema per endpoint in `src/lib/relevancy/schemas.ts`. Reuse server + client. |
| V2 | Apify response trusted blindly | Wrap parser (P4 / S4 / J4) in a Zod schema; on failure, mark `scrape_status='failed'` and return 502. |
| V3 | `change_set` from S6 → S8 not validated server-side | `PATCH /api/profiles/:id/apply-diff` re-validates the diff against the canonical schema before applying. |
| V4 | Job URL pattern check is client-only | Server re-validates `^https://www\.upwork\.com/jobs/~?[A-Za-z0-9_-]+/?$`. |
| V5 | Profile URL pattern check missing | Same: `^https://www\.upwork\.com/freelancers/~?[A-Za-z0-9_-]+/?$`. |
| V6 | `target_column` in `promote-to-card` not validated | Server checks the column belongs to a project the admin can write to. |
| V7 | `gates_failed[]` may contain out-of-range gate IDs | DB CHECK constraint: `gates_failed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]`. |
| V8 | `decision` enum not enforced at app layer | Centralize in a TypeScript const: `export const DECISIONS = ['proceed','reject','review'] as const`. Use `z.enum(DECISIONS)` everywhere. |
| V9 | TEXT columns unbounded | Cap at app layer: headline 200, description 5000, title 200, etc. Reject scrapes that exceed (Upwork doesn't generate them; means parser drift). |
| V10 | No `criteria_version` foreign key | Add `FOREIGN KEY (criteria_version) REFERENCES criteria_versions(version)` on `relevancy_scores`. Catches typos and stale versions. |

### 16.3 Rate limiting & cost caps

| # | Gap | Recommendation |
|---|---|---|
| R1 | No rate limit on `/api/relevancy/evaluate` | Cap admin manual evals at 60/hr, 300/day per admin user. Use `@upstash/ratelimit` or in-process Postgres-backed counter. Returns 429 with `Retry-After`. |
| R2 | No rate limit on `/api/profiles/:id/sync` | Cap manual sync at 10/profile/hour. Sync button shows cooldown timer. |
| R3 | No global Apify cost cap | Daily cost guard: count rows in `relevancy_scores WHERE source='manual_url' AND evaluated_at >= today` × $0.02. If >$5/day, reject new manual evals with "Daily Apify budget exhausted." |
| R4 | No Gemini quota guard | Track `SUM(input_tokens + output_tokens)` per day; alert at 80% of 1M-token soft cap. |
| R5 | Cron sync runs all 8 profiles in batches (1 req/30s = 4 min total) | Acceptable; document the rate. If profile count grows, add Apify-side concurrency cap. |
| R6 | No spam detection on "Re-run" button | Same admin clicking 5× in 30s → rate limit at 6/min/job per admin (forces re-scrape only on expiration of internal cache). |

### 16.4 Idempotency & retry handling

| # | Gap | Recommendation |
|---|---|---|
| I1 | n8n callback POSTs lack idempotency keys | Every n8n → Next.js POST sends `X-Idempotency-Key: <uuid>` (n8n generates per execution). Server caches `(key, response)` for 24h; replay returns cached response. |
| I2 | `Persist Relevancy Score` (C10) is fire-and-forget | Switch `neverError: true` so verdict is returned to caller even if write lags. Failed writes go to a DLQ table `relevancy_scores_dlq` for manual replay. |
| I3 | Apify retry × 2 has no jitter | Exponential backoff: 1s, 4s, 16s with ±25% jitter. n8n's built-in retry config supports this (`retryOnFail: true`, `waitBetweenTries: 2000`, `maxTries: 3`). |
| I4 | Cron sync mid-run failure has no resume | Per-profile state in `profile_sync_runs` table: `(run_id, profile_id, status: pending/done/failed, error, attempted_at)`. On crash, next cron picks up `pending` rows. |
| I5 | Promote-to-card double-submit creates two cards | Server enforces unique on `(score_id, target_column)` in `tasks.custom_fields._score_id` lookup. Returns existing task ID on retry. |
| I6 | Manual eval mid-flight if admin closes tab | Server kicks off n8n call regardless; UI on revisit can hydrate from `manual_job_evaluations` history. Don't tie completion to client connection. |
| I7 | n8n executeWorkflow retries on transient failure not configured | Configure `retryOnFail: true, maxTries: 2, waitBetweenTries: 1500` on the `Score Relevancy` node. |

### 16.5 Logging & monitoring

| # | Gap | Recommendation |
|---|---|---|
| L1 | No structured logging | Use `pino` in Next.js with JSON output. Required fields: `timestamp`, `request_id`, `route`, `user_id`, `latency_ms`, `outcome`. |
| L2 | No request ID propagation | Generate `X-Request-Id` at ingress. Forward through n8n header, persist on `relevancy_scores.request_id`. Lets you trace one job end-to-end. |
| L3 | No alerts on Gemini error spike | Add a check: `SELECT COUNT(*) FROM relevancy_scores WHERE evaluated_at > NOW() - INTERVAL '15 min' AND model='gemini-2.5-flash' AND ai_score IS NULL`. Alert if >5% over a 15-min window. |
| L4 | No cost dashboard | Audit page tile: "This month's spend = Apify scrapes × $0.015 + Gemini tokens × $0.075/1M". Live read-out. |
| L5 | No Slack alert pipeline | Reuse existing `src/lib/alerts.ts` Slack client. New event types: `RELEVANCY_OVERRIDE_RATE_HIGH`, `STALE_PROFILES`, `APIFY_FAILURE_BURST`, `GEMINI_QUOTA_NEAR`. |
| L6 | Activity log unbounded | 180-day retention prune cron. |
| L7 | No SLO definition | Documented SLOs: manual eval p95 ≤ 20s, manual eval error rate ≤ 2%, profile sync error rate ≤ 5%, classifier-vs-agent agreement ≥ 85%. Audit page tracks all four. |
| L8 | Score-to-task traceability missing | Audit page: "Lookup by job ID" search box. Returns the score row + linked task + override (if any) + activity timeline. |
| L9 | No prompt-version change audit | Insert a `criteria_versions` row whenever PRD bumps. Audit page shows a vertical timeline of prompt + criteria version changes overlaid on decision-distribution charts. |
| L10 | No cost-per-decision metric | `SELECT decision, AVG((input_tokens + output_tokens) * cost_per_token) FROM relevancy_scores GROUP BY decision`. Identifies whether rejects are cheaper than proceeds (they should be, given Mode B). |

### 16.6 Data consistency & atomicity

| # | Gap | Recommendation |
|---|---|---|
| D1 | Sync apply-diff (S8) and version snapshot (S9) are two separate HTTP calls — partial failure leaves DB inconsistent | Combine into one server endpoint `/api/profiles/:id/sync-commit` that does apply + snapshot + activity log in one transaction. |
| D2 | `profile_versions` has no FK to `criteria_versions` for the diff that triggered it | Add `criteria_version` column on `profile_versions`; useful when reviewing why a sync ran. |
| D3 | Concurrent sync (cron + manual) on same profile causes race | Acquire advisory lock: `SELECT pg_try_advisory_lock(hashtext('profile-sync-' || $profile_id))`. If false, return 409 `{error: 'sync_already_running'}`. |
| D4 | Override capture relies on `moveTaskAction` instrumentation | Document: any task move that bypasses `moveTaskAction` (raw `PATCH /api/tasks/:id/move`) misses override capture (same caveat as funnel — see CLAUDE.md "Funnel KPIs"). Either lock down the raw endpoint or instrument it too. |
| D5 | Skills taxonomy slug rename desyncs historical `relevancy_scores` | Slugs are immutable once created. Renames go through the alias map: add new slug, append old slug to `aliases[]`, never delete. |
| D6 | Promote-to-card creates a `tasks` row but `task_id` on the `relevancy_scores` row is set by a separate UPDATE | Combine in one transaction inside `/api/relevancy/promote-to-card`. |
| D7 | Profile re-ingest with same `upwork_url` not handled | Server: if `profile_id` already has `ingest_status='complete'`, the ingest endpoint requires `force=true` flag and creates a `profile_versions` entry of source `re-ingest`. |
| D8 | `archived_at` on portfolios doesn't update unique constraint | Replace `UNIQUE (profile_id, external_id)` with a partial unique: `CREATE UNIQUE INDEX ON profile_portfolios(profile_id, external_id) WHERE archived_at IS NULL`. Lets a previously-archived item come back. |

### 16.7 AI scoring quality controls

| # | Gap | Recommendation |
|---|---|---|
| A1 | No retry on Gemini parse-fail beyond once | After 1 retry, fall back to Mode A (full prompt) regardless of input. After Mode A fails too, return `decision='review'` with `_errorDetail` set. Never silently default to `proceed`. |
| A2 | No model fallback if Gemini Flash 2.5 is unavailable | Secondary: Gemini Flash 2.5 8B (cheaper, slower); tertiary: Claude Haiku 4.5 via existing Anthropic credential. Document fallback in `_relevancy-classifier-core` README. |
| A3 | Gemini hallucination on gate evidence (e.g. claims gate 9 passed when "loom" is in description) | Lightweight verifier in C6: regex-scan job description for {`loom`, `video`, `screen recording`, `record yourself`}; if found AND classifier said gate 9 passed → flip to fail with `Video Proposal` reason. Apply same pattern to gates 8 (location) and 7 (already hired). |
| A4 | No grounding-evidence audit | Every gate evidence must cite a substring from the job description OR profile context. C6 verifies via fuzzy match (token-set ratio ≥ 80%). Mismatches flagged in `relevancy_scores.confidence_warnings TEXT[]`. |
| A5 | Token-window overrun (giant job descriptions) | Truncate description to 1500 chars (already in v2); skill list to 30 items; portfolio to top 5 by recency. Apply BEFORE building the user message. |
| A6 | `criteria_version` snapshot not enforced — manual PRD edit could ship without bumping | Add a CI check: `criteria_versions` table must have a row whose `effective_at >= git log HEAD docs/job_relevancy_criteria_prd.md`. |
| A7 | Gemini temperature not specified | Set `temperature: 0.0` for the classifier (deterministic outputs for the same input — matches Apple-grade reproducibility on calibration). |
| A8 | `evidence_panel` only generated for manual_url path | Auto-pipeline cards have empty `evidence_panel` — UI should fall back to rendering `gates_evidence` + `components.reason` (already stored). Document this in 10.x rendering rules. |
| A9 | Bias risk: deterministic results passed to LLM could cause confirmation bias | Mode B prompt explicitly says "Do not re-evaluate gates 1-6 and 11; trust the deterministic verdict." Verify via spot checks during shadow phase. |
| A10 | Gemini structured-output schema drift between prompt versions | Lock the JSON schema in `criteria_versions.output_schema JSONB` per criteria version. Validate every Gemini response against the version's schema. |

### 16.8 Edge cases & failure scenarios

| # | Edge case | Behavior in v3 (if not addressed) | Recommendation |
|---|---|---|---|
| E1 | Profile has zero portfolio items | Gate 10 fails deterministically → reject. Even strong-stack-match jobs get rejected. | Soft-pass gate 10 (don't fail) when `profile_portfolios` is empty AND profile is `top_rated=true OR jss_score >= 90`. Mark as `gate_10_softpassed` in evidence. |
| E2 | Profile has zero work history | Rubric `domain_match` and `skill_match` lose evidence anchor | Fall back to headline-only. Cap component scores at 7/10 in this case (visible in UI as "limited evidence"). |
| E3 | Hourly job with `budget_min=null AND budget_max=null` | Gate 4 deterministic check passes (ambiguous) → LLM evaluates | Document explicit behavior in §7.3. LLM scans description for rate hints; if none found → mark `gate_4_unverified` (proceed but flag). |
| E4 | Job description in non-English | LLM accuracy on gates 7-9 degrades silently | Light language detection (cld3 or franc). Non-English → set `confidence -= 0.1` and add `language_warning: true`. |
| E5 | Apify returns partial profile (skills present, portfolio missing) | `ingest_status='partial'`, banner shows | Already handled. Document the user-facing message: "Profile ingested but portfolio scrape failed. Retry sync to complete." |
| E6 | Same job evaluated twice (manual + auto) | Two separate `relevancy_scores` rows | Acceptable; flag as `duplicate_evaluation: true` on the second one. UI shows both side-by-side. |
| E7 | Cron sync collides with manual sync (same profile) | Race condition; both write versions | Advisory lock (D3); manual wins, cron skips with `_skipped: 'manual_in_progress'`. |
| E8 | Profile `upwork_url` 404s (account closed) | Sync fails forever | After 3 consecutive 404s, set `profiles.ingest_status='failed'`, `active=false`, send Slack alert. Stop trying until admin re-enables. |
| E9 | Skill taxonomy slug renamed | Old `relevancy_scores.gates_evidence` references obsolete slug | Slugs immutable (D5); never rename. |
| E10 | Backfill scenario: scoring jobs older than 30 days | Gate 2 (freshness) fails by default | Add `request_meta.bypass_freshness=true` flag (admin-only on manual eval). Stored in `relevancy_scores.request_meta`. |
| E11 | Webhook replay (n8n retry) | Duplicate writes | Idempotency key (I1). |
| E12 | Concurrent overrides on same task | Last-write-wins | Use Postgres row lock: `SELECT … FOR UPDATE` in `moveTaskAction`. |
| E13 | Long-running Apify run >60s (synchronous timeout) | n8n times out, profile half-ingested | Switch to async pattern: `POST /v2/acts/<id>/runs`, then poll `GET /v2/acts/<id>/runs/<runId>` every 5s up to 5 min. Or use `run-sync-get-dataset-items` with timeout=300. |
| E14 | Apify returns multiple items when 1 expected | First wins silently | Defensive: if `items.length > 1`, log warning, take first, mark `scrape_status='partial'`. |
| E15 | Profile inactive between ingest start and finish | Inconsistent state | Re-check `active=true` before persist. If now inactive, abort persist, return 409. |
| E16 | Promote-to-card on a manual eval where job was scraped but not stored as a "real" job | `_job_id` on the new task references nothing in the `jobs` table | Either: (a) store the scraped job in `jobs` table at promote time (preferred); or (b) set `_job_id=null` and `_source='manual_eval_orphan'`. v3 picks (a). |
| E17 | Override capture for a card created by manual_eval (not auto pipeline) | Override exists but the score was `source='manual_url'` — analytics distort | `relevancy_overrides` includes `source` snapshot; audit page filters on `source='auto'` for the canonical rate. |

### 16.9 Frontend states catalog

The plan describes UI but doesn't enumerate all states each screen must handle. Each screen MUST implement:

**Profile Management (`/profiles`)**

| State | Trigger | UI |
|---|---|---|
| Loading | Initial fetch | Skeleton rows (8 placeholders) |
| Empty | No profiles in DB | Empty state CTA: "Add your first profile" |
| Error | Fetch fails | Inline error banner + Retry button |
| Stale | `last_synced_at < NOW() - INTERVAL '48 hours'` | Yellow badge "Stale — sync needed" |
| Failed ingest | `ingest_status='failed'` | Red badge + tooltip with last error |

**Profile Create Modal (`/profiles/new`)**

| State | Trigger | UI |
|---|---|---|
| Idle | Default | Form with URL + name fields |
| Validating URL | onBlur of URL field | Spinner + "Checking URL pattern…" |
| URL invalid | Pattern fail | Inline error + disabled submit |
| Submitting | Form submit | Disable form, show "Ingesting profile (5-30s)…" with cancel button |
| Apify failed | n8n returns 502 | Error panel + "Paste profile JSON manually" CTA opens fallback paste UI |
| Profile not public | n8n returns 422 | "This profile is private — paste JSON manually below" |
| Success | n8n returns 200 | Toast + redirect to `/profiles/:id` |
| Network failure | Fetch error | Generic retry banner; preserves form state |

**Profile Detail (`/profiles/:id`)**

| State | Trigger | UI |
|---|---|---|
| Tab loading | Tab switch | Per-tab skeleton |
| Empty stack | `profile_stacks` empty | "No skills ingested yet — try Sync Now" |
| Empty portfolio | `profile_portfolios` empty | Same pattern |
| Empty work history | `profile_work_history` empty | Same pattern |
| Sync in progress | After clicking Sync Now | Modal with 4-stage progress + cancel button |
| Sync diff modal | Sync success with `has_changes=true` | Diff panel with Save/Discard |
| Sync no-op | Sync success with `has_changes=false` | Toast: "Profile up to date." |
| Sync failed | n8n returns error | Modal stays, error banner with Retry |
| Unmatched skills queue | Any flagged skill | Yellow card at top: "N unmatched skills — Review" |
| Stale sync | last_synced_at >48h | Banner: "Last synced {timeago}. Refresh recommended." |

**Job Evaluator (`/relevancy-evaluator`)**

| State | Trigger | UI |
|---|---|---|
| Idle | Default | Form fields, Evaluate disabled until both filled |
| URL invalid | Pattern fail | Inline error |
| Profile picker empty | Zero active profiles | Disabled picker + "Add a profile first" link |
| Submitting | Click Evaluate | 4-stage progress (validate → scrape → load profile → classify); each stage shows duration; admin can abort |
| Apify failed | Stage 2 fails | Error panel + Retry; saves attempt to `manual_job_evaluations` with `scrape_status='failed'` for audit |
| Gemini failed | Stage 4 fails | Show partial result (deterministic gates only) + "Re-run" button |
| Verdict ready | Backend returns | Result panel renders |
| Save-to-board failed | Promote-to-card returns error | Inline error + Retry |
| Rate-limited | 429 from `/api/relevancy/evaluate` | Banner with cooldown countdown |

**Relevancy Audit (`/relevancy-audit`)**

| State | Trigger | UI |
|---|---|---|
| Cold start | Zero `relevancy_scores` rows | Empty state: "No evaluations yet. Run a manual eval to seed data." |
| Loading | Tile fetch | Per-tile skeleton |
| Error | One tile fails | Tile-level error with Retry; other tiles still render |
| Empty filter result | Date range too tight | "No data in this range. Try expanding the window." |

**Sync Diff Modal**

| State | Trigger | UI |
|---|---|---|
| Diff rendered | n8n returns change_set | Render added/removed/changed sections; Save+Discard actions |
| Discard pending | Click Discard | Confirm dialog: "Revert profile to version N? This rewrites the database. Cannot be undone." |
| Discard executing | Confirm | Spinner + disable buttons |
| Discard failed | Server error | Error banner; modal stays open |
| Save pending | Click Save | Already saved server-side; just dismisses with toast "Saved" |

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
| P1 | `/api/profiles/:id/context` joins 5 tables every call | Materialize as `profile_context_v` view OR cache the JSON output in a `profile_context_cache` table refreshed on sync. |
| P2 | `relevancy_scores` partition strategy missing | At 12k rows/year baseline this is fine, but plan for partitioning by month at 100k+ rows/year. |
| P3 | `gates_evidence JSONB` per row inflates row size | After 90 days, archive gates_evidence + evidence_panel to `relevancy_scores_archive`. Active table keeps only the structured decision/score fields. |
| P4 | `profile_versions.snapshot` is full JSON; grows fast | Keep latest 12 snapshots fully; older entries store only `change_set`. |
| P5 | n8n `executeWorkflow` adds 200-500ms latency | Acceptable for v3; document. Consider direct embedding into parent workflow if latency budget tightens. |
| P6 | No indexes on `activity_log` for relevancy queries | Add `CREATE INDEX ON activity_log (entity_type, entity_id, action) WHERE entity_type IN ('profile','task')`. |
| P7 | Cache invalidation between Next.js and n8n is one-way | Use a tag-based invalidation scheme: dashboard sets `last_invalidated_at` on profile; n8n compares its cached value's `context_generated_at` and refetches if stale. |
| P8 | Manual eval p95 16s blocks the admin UI tab | Keep the UI tab usable: stream progress via SSE (or chunked transfer); don't block on the full request. |

### 16.11 Fallback mechanisms (degraded modes)

| # | Failure | Degraded mode |
|---|---|---|
| F1 | Apify down | Manual JSON paste fallback for ingest/sync; manual evaluator returns 503 with "Try again later — Apify unavailable" |
| F2 | Gemini down | Auto pipeline: emit `decision='review'` with `_errorDetail='gemini_unavailable'`; cards land in `Todo` column. Manual evaluator: same. Never silently default to `proceed`. |
| F3 | Postgres write fails (relevancy_scores) | Verdict still returned to caller; row goes to in-memory DLQ + retry every 30s for 10 min. After that, write to disk-based DLQ JSON file. Alert. |
| F4 | Profile context endpoint down | n8n falls back to `n8n_static_data` cache (1h TTL). Never hard-fail the parent workflow. |
| F5 | Both Apify and Gemini down | Auto pipeline reverts to v2-pre-classifier behavior (kill-switch §13.5). Manual evaluator + profile management are unavailable; admin sees a system status banner. |
| F6 | `criteria_versions` row missing for the version the prompt cites | Refuse to score; return `decision='review'` with `_errorDetail='criteria_version_unknown'`. Forces a deploy fix instead of silent drift. |

### 16.12 Implementation priority

Recommendations are grouped into three buckets. Phase numbers refer to Appendix B.

**P0 — must ship before active rollout (Phase 19):**

- §13.1 entire safe-update protocol
- §13.5 kill-switch
- §14 rollback procedure + JSON backup discipline
- §15 all execution requirements
- S1, S2, S3, S5, S6, S8 (security)
- V1, V2, V4, V5, V8, V10 (validation)
- I1, I2, I5, I7 (idempotency)
- A1, A2, A6, A7, A10 (AI quality)
- D1, D3, D6 (consistency)
- L2, L7 (logging baselines)
- F2, F3, F6 (fallbacks)
- All §16.9 frontend states for the four primary screens

**P1 — must ship within 30 days of active rollout:**

- S4, S7, S9, S10, S11
- V3, V6, V7, V9
- R1, R2, R3, R4
- I3, I4, I6
- A3, A4, A5, A8, A9
- D2, D4, D5, D7, D8
- L1, L3, L4, L5, L8, L9, L10
- E1–E17 (all edge cases) — at minimum documented if not coded

**P2 — quality of life within 90 days:**

- §16.10 (P1–P8 performance)
- §10.2 sync-diff polish
- Audit page deep-dives

---

## Appendix A — Open Questions

These are decisions BEFORE running migration 017:

1. **Apify actor selection**: pick a specific Upwork profile actor + job actor. Two leading candidates: `apify/upwork-public-profile-scraper` and `epctex/upwork-scraper`. Spike a 4-hour eval comparing reliability + field coverage.
2. **Profile-thresholds storage**: PRD §11 Q1 unresolved. v3 picks `profiles.thresholds_overrides JSONB` (single column). If we need cross-profile threshold queries, switch to a dedicated `profile_thresholds` table in v3.x.
3. **Manual eval audit**: should manual evals against PRIVATE profiles (`active = false`) be allowed? v3 default: yes (research utility). Block if security needs.
4. **Override capture**: when an agent moves a card classifier-said-proceed to N/A, do we surface a "Why did you override?" prompt? v3 default: optional input box (don't block the move).
5. **Skill taxonomy seed source**: hand-curate vs scrape from Upwork's skill list page. Hand-curate for v3 (~500 skills); auto-extend in v3.x.
6. **Reason label typos** (PRD §9.2): migrate `"Low Higher rate"` → `"Low Hourly Rate"` BEFORE or AFTER classifier launch? **v3 recommendation: AFTER** — preserve label-equality with historical data through 2-week shadow mode, then run a single migration that rewrites both the enum AND existing rows.
7. **Apify caching**: cache profile/job scrapes by URL for N minutes? v3 default: 1h cache for profile (sync detects changes anyway), no cache for job (fresh data matters for `proposals_count`).
8. **Idle profile (Nawal)**: skip cron sync for `active = false`? v3 default: yes.

---

## Appendix B — Build Order

Follows PRD §12 phases, with v3 additions interleaved:

| Phase | Scope | Owner | Effort | Done when |
|---|---|---|---|---|
| **0. PRD freeze + Execution Requirements** | Lock PRD v0.2; resolve Appendix A; Waqas provides §15 secrets + accounts | Waqas + leads | 4h | Sign-off; all keys in n8n credentials |
| **0a. Pre-flight backup** | Snapshot current `EWnZg3svZWwcIRs4` to `docs/multiple webhooks (07-05-2026 working).json`; tag PostgreSQL pre-migration | n8n-keeper | 30m | Backup file committed; pg_dump archived |
| **1. Migration 017** | All 9 new/extended tables + rollback script `017_rollback.sql` | Dashboard | 4h | Idempotent run on Contabo; rollback tested in dev |
| **2. skills_taxonomy seed** | Hand-curate ~500 skills + alias map | Dashboard | 1d | Seed runs; coverage check passes |
| **3. Apify actor evaluation** | Pick profile + job actors (Appendix A Q1) | Waqas | 4h | Spike report |
| **4. `/api/scrape/upwork/*` proxy routes** | Apify wrappers + S1 SSRF allowlist + S8 admin auth | Dashboard | 1d | Returns canonical JSON; only `*.upwork.com` allowed |
| **5. `/api/profiles/:id/context` endpoint** | Reads profile_* tables | Dashboard | 4h | Returns classifier-ready JSON for all 8 profiles |
| **6. `/api/skills/normalize`** | Skill matcher | Dashboard | 4h | Lev + alias match works |
| **6a. Shared schemas + idempotency middleware** | V1 Zod schemas, I1 idempotency-key middleware, S3 HMAC verification | Dashboard | 1d | All POST endpoints validated + idempotent |
| **6b. Kill-switch env var** | `RELEVANCY_CLASSIFIER_ENABLED` wired into n8n; rate-limit middleware (R1-R4) | Dashboard + n8n-keeper | 4h | Toggle reverts to v2 in <30s |
| **7. `_relevancy-classifier-core` sub-workflow** | Extract from v2's planned splice + A1 retry/fallback + A3 verifier + A7 temp=0 | n8n-keeper | 6h | Validation green; mock job test passes |
| **8. Existing workflow splice** | Insert `Score Relevancy` node + IF + kill-switch read; follow §13.1 protocol | n8n-keeper | 2h | Mock job through full path; backup snapshot taken |
| **9. `profile-ingest` workflow** | NEW + manual JSON paste fallback (F1) | n8n-keeper | 4h | Public profile ingests cleanly |
| **10. `profile-sync` workflow** | NEW + advisory lock (D3) + sync-commit transaction (D1) | n8n-keeper | 6h | Cron + manual + diff verified |
| **11. `job-evaluate-manual` workflow** | NEW + rate limiting (R1) | n8n-keeper | 4h | Returns verdict in <20s |
| **12. Admin UI: Profile Management** | List + create modal + detail page; all §16.9 states | Dashboard | 2d | Admin can ingest a profile |
| **13. Admin UI: Sync diff modal** | Renders change_set; all states from §16.9 | Dashboard | 1d | Diffs visualized |
| **14. Admin UI: Job Evaluator page** | Paste URL + profile picker + result panel + SSE progress + abort | Dashboard | 2d | End-to-end manual eval |
| **15. Admin UI: Relevancy Audit page** | Tiles + drilldowns + L8 lookup + L4 cost dashboard | Dashboard | 2d | Decision distribution + gate-fail rates + cost live |
| **15a. Logging + alerts baseline** | L1 pino structured, L2 request_id, L5 Slack alerts, F2/F3/F6 fallback paths | Dashboard | 1d | Trace one job end-to-end through logs |
| **16. Smoke test** | Replay 20 historical N/A tasks through manual evaluator | Waqas | 4h | ≥85% agreement |
| **17. Shadow rollout** | `Score Relevancy` writes to log only; kill-switch verified; daily decision pivot | n8n-keeper + Waqas | 1 week | 7 days × 8 profiles of `relevancy_scores` rows; agreement ≥85% |
| **18. Calibration review** | Audit shadow data; tune per-profile thresholds | Waqas | 1d | Threshold doc updated |
| **19. Active rollout** | Connect `Score Relevancy` → routing branch; pre-flight §13.1 + post-flight smoke | n8n-keeper | 1h | First N/A card auto-created |
| **20. Override capture** | Wire `relevancy_overrides` insertion into `moveTaskAction` | Dashboard | 4h | Override rate visible in audit |
| **21. P1 hardening pass** | All §16 P1 items (R1-R6, A3-A9, S4/S7/S9-S11, V3/V6/V7/V9, etc.) | Dashboard + n8n | 1 week | All P1 items closed in audit |
| **22. Post-launch review** | 30-day review; promote stable JSON snapshot to backup; archive previous | Waqas | 1h | New `(working).json` baseline; `CLAUDE.md` updated |

**Total engineering effort**: ~17–18 working days, gated by Apify actor selection (Phase 3), PRD freeze, Execution Requirements (Phase 0), and 1-week shadow. P0 items (§16.12) are blocking for Phase 19; P1 items run in parallel with Phase 19+.

---

## Document conventions

- **Gate IDs** match PRD §7 row order verbatim. Never renumber.
- **Reason labels** quoted verbatim from PRD §6.2 (typos preserved). Migration is a separate workstream.
- **`criteria_version` / `prompt_version` / `prompt_mode`** stored on every `relevancy_scores` row. Three together let us reconstruct any historical decision exactly.
- **Profile IDs** are UUIDs from `profiles` table. Display names appear only in human-readable fields.
- **Sub-workflow naming**: prefix with underscore (`_relevancy-classifier-core`) to signal "internal, do not webhook directly".
- **Apify replaceability**: `Fetch via Apify` HTTP nodes call our `/api/scrape/upwork/*` routes (not Apify directly). If we swap to ScrapingBee or self-hosted Playwright later, only those routes change — n8n stays put.
