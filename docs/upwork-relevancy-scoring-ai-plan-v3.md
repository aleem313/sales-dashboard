# Upwork Relevancy Scoring AI — Build Plan **v3.3**

**Status:** Engineering-ready · 2026-05-11
**Supersedes:** v3.2 (2026-05-08), v3.1 (2026-05-07), v3 (2026-05-06), `upwork-relevancy-scoring-ai-plan-v2.md` (2026-05-06), v1
**Source PRD:** `job_relevancy_criteria_prd.md` v0.2
**Stack:** existing `upwork_profile_snapshots` (migration 017 — already shipped) + `tasks.custom_fields` (Vollna→n8n→Task Board) → n8n classifier sub-workflow → Gemini Flash 2.5 → Postgres (Contabo) + Next.js admin dashboard
**Stable n8n backup:** [`docs/multiple webhooks (07-05-2026 working).json`](./multiple%20webhooks%20%2807-05-2026%20working%29.json) — see [§14 Rollback Strategy](#14-rollback-strategy)

**v3.3 changes vs v3.2.** v3.2 used an n8n env var (`RELEVANCY_CLASSIFIER_ENABLED`) as the only shadow/active lever and routed `proceed` cards straight into the Task Board's `Proposal Submitted` column. v3.3 makes three operationally significant changes:

1. **Operator controls move into the admin UI.** Four knobs live in `/settings` → Relevancy Classifier: a global mode toggle (Shadow | Active), a global minimum-score threshold (0–100), a per-profile `classifier_enabled` override, and a per-profile `min_score_override`. The DB-backed `system_settings` table is the source of truth; n8n reads the effective mode through the existing profile-context endpoint. The env var stays — but only as an **emergency kill-switch**, not for routine operation. See §1.4, §10.6, §13.5.
2. **Threshold-driven routing.** When global mode is Active and the classifier returns `decision=proceed` with `total_score < min_score`, the verdict is flipped to `reject` post-classifier. `relevancy_scores` records both the raw AI verdict AND the threshold-adjusted `effective_decision`, so the audit trail tells the truth. See §7.5.
3. **Today's `Proposal Submitted` auto-routing is a bug, and v3.3 fixes it.** n8n cannot actually submit on Upwork — it only drafts proposals — yet today's pipeline drops every card into `Proposal Submitted`. Humans cannot tell which proposals are actually live on Upwork. v3.3's rule: **every auto-created card lands in `Todo`**, regardless of mode or verdict. `Proposal Submitted` becomes a human-only destination, populated by a human moving the card after they've copy-pasted the proposal into Upwork and clicked Submit. The card-creation rule simplifies to **card created ⇔ proposal written**: branches that don't create a card don't write a proposal either, and vice versa. See §4.2.

The classifier core, the schemas, and the manual evaluator are all unchanged from v3.2 — only the parent workflow's routing block, the migration 018 surface, and the admin UI gain new shape.

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

v3.3 is a single relevancy scoring system reachable via two front doors. Profile ingestion is no longer a workflow — the snapshot uploader (existing UI + CLI) is the third "door" but it doesn't trigger any scoring, just persists profile data.

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
- **`profiles` table** (existing) is the canonical profile registry. v3.3 adds two columns: `classifier_enabled BOOLEAN DEFAULT TRUE` and `min_score_override INTEGER` (nullable — `NULL` = use global).
- **`upwork_profile_snapshots` table + `upwork_profile_snapshots_current` view** (existing — migration 017) is the canonical profile-context store. The full Upwork JSON lives in the `data` JSONB column with promoted hot columns for fast filtering.
- **`tasks` table + `tasks.custom_fields`** (existing) is the canonical job-snapshot store. Every Vollna job is already persisted as a Task Board card by the existing n8n pipeline; manual eval reads it back. v3.3 adds `_relevancy_*` keys to `custom_fields` on every auto-created card (see §10.7).
- **`relevancy_scores` table** (new in v3.2 — migration 018) is the canonical scoring log for both front doors. v3.3 extends it with `effective_decision`, `threshold_flipped`, `min_score_at_decision`.
- **`system_settings` table** (new in v3.3 — migration 018) is the canonical store for the operator controls. Two rows seeded at migration time: `relevancy.classifier_mode='shadow'` and `relevancy.min_score=50`.

### 1.4 Operator controls (NEW in v3.3)

Four knobs decide how aggressively the classifier routes traffic. All four are admin-editable from `/settings` → Relevancy Classifier; none require a code deploy or n8n edit.

| Knob | Scope | Type | Default | Effect when set |
|---|---|---|---|---|
| `classifier_mode` | Global | `'shadow' \| 'active'` | `'shadow'` | `shadow` = AI scores every job but never routes; all cards land in Todo. `active` = AI's `effective_decision` drives routing. |
| `min_score` | Global | integer 0–100 | `50` | Only used when `classifier_mode='active'`. Jobs the classifier scored `proceed` with `total_score < min_score` are flipped to `reject`. |
| `classifier_enabled` | Per-profile | boolean | `TRUE` | Only consulted when global is `active`. `FALSE` means "this profile stays in shadow even though global is active." |
| `min_score_override` | Per-profile | integer 0–100 or `NULL` | `NULL` | When non-null, replaces the global `min_score` for that profile. `NULL` = inherit global. |

**Precedence rules** (the effective mode the classifier uses for a given job):

```
if (global.classifier_mode === 'shadow')         → effective_mode = 'shadow'
elif (profile.classifier_enabled === false)      → effective_mode = 'shadow'
else                                              → effective_mode = 'active'

effective_min_score = profile.min_score_override ?? global.min_score
```

**Master-switch semantics.** Flipping global to `shadow` puts every profile into shadow regardless of per-profile overrides (the per-profile toggle becomes a no-op while global is shadow). Flipping global to `active` re-enables per-profile granularity — profiles default to active, and the admin can individually opt any profile back into shadow without touching global.

The effective values are computed server-side in `/api/profiles/:id/context` and returned as `_system.classifier_mode` and `_system.effective_min_score`. n8n's `_relevancy-classifier-core` reads these on every job; the parent workflow's `Route Verdict` switch (§4.2) consumes them. Settings changes propagate within ~60s via the existing `revalidateTag('profile-context-<id>')` cache-bust path.

**Emergency kill-switch.** The `RELEVANCY_CLASSIFIER_ENABLED` env var on n8n stays as a separate, lower-level lever: setting it to `false` bypasses the `Score Relevancy` node entirely (reverts to v2-pre-classifier behavior in <30s). This is for "Gemini is broken" or "the classifier is producing garbage" — NOT for routine shadow/active operation. Routine operation uses the Settings toggle.

| Lever | Where | What it does | Latency | When to use |
|---|---|---|---|---|
| Settings toggle (4 knobs) | `/settings` UI | Score yes, route by AI yes/no (granular) | ~60s | Routine ops, calibration → go-live, per-profile rollout |
| Kill-switch env var | n8n environment | Skip scoring entirely (emergency) | <30s | "Something's badly wrong, get classifier out of the way" |

---

## 2. Key Improvements Over v2

v3.2 keeps every architectural improvement v3.1 promised over v2 — the difference is HOW the data arrives. v3.1 scraped Upwork; v3.2 reads from existing internal stores.

| # | v2 weakness | v3 family fix | Section |
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
│ ┌────────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────┐ ┌─────┐ │
│ │ /settings                  │ │  /relevancy-evaluator    │ │ /relevancy-audit     │ │ /tasks│
│ │ - Profile Snapshots drawer │ │  Paste card URL +        │ │ Decision distrib /  │ │ Board │
│ │   (existing)               │ │  Pick profile (NEW)      │ │ Gates / Cost /      │ │ +     │
│ │ - Relevancy Classifier card│ │                          │ │ Settings history    │ │ Badge │
│ │   (NEW v3.3 — §10.6)       │ │                          │ │ overlay (NEW)       │ │ (NEW) │
│ │   * Global toggle (Sh/Act) │ │                          │ │                      │ └───────┘
│ │   * Min score (0-100)      │ │                          │ │                      │         │
│ │   * Per-profile table      │ │                          │ │                      │         │
│ └────────┬───────────────────┘ └────────┬─────────────────┘ └────────┬─────────────┘         │
└──────────┼──────────────────────────────┼──────────────────────────┼──────────────────────────┘
           │                              │                          │
           ▼                              ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Next.js API routes (Contabo)                                    │
│  Profile snapshots (existing — admin only):                                                  │
│   GET/POST /api/profiles/:id/upwork-snapshot                                                 │
│                                                                                              │
│  v3.3 operator controls (admin only):                                                        │
│   GET   /api/admin/system-settings                          → mode + min_score               │
│   PATCH /api/admin/system-settings/relevancy-mode           → server action wrapper          │
│   PATCH /api/admin/system-settings/min-score                → server action wrapper          │
│   PATCH /api/profiles/:id/classifier-config                 → enabled + min_override         │
│   GET   /api/admin/system-settings/threshold-preview?value=N → live distribution             │
│                                                                                              │
│  Classifier surface:                                                                         │
│   GET  /api/profiles/:id/context     → snapshot + thresholds_overrides + _system block      │
│                                         (cached, tagged `profile-context-<id>` + `system-   │
│                                          settings`)                                          │
│   GET  /api/tasks/:id/job-payload    → tasks.custom_fields → canonical job JSON              │
│   POST /api/relevancy/evaluate-task  → forwards to n8n job-evaluate-manual webhook          │
│   POST /api/relevancy-scores         → audit-log writer (called by n8n; idempotency keyed)  │
│   GET  /api/relevancy-scores/accuracy → admin metrics (audit page)                          │
│   POST /api/cron/relevancy-dlq-drain  → background DLQ retry (hourly GH Actions cron)       │
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
│  ┌────────────────────────────────────────────────────────────────────────────┐               │
│  │ _relevancy-classifier-core (NEW)                                           │               │
│  │  C1  Load Profile Context (reads _system.classifier_mode +                │               │
│  │      _system.effective_min_score from snapshot endpoint)                  │               │
│  │  C2  Deterministic Pre-check                                              │               │
│  │  C3-4 Prepare Classifier Input (Mode A or B)                              │               │
│  │  C5  AI Agent — Gemini Flash 2.5                                          │               │
│  │  C6  Validate Output + Apply Threshold (v3.3 — produces effective_decision)│               │
│  │  C7-9 Build {Reject|Review|Proceed} Payload (key off effective_decision)  │               │
│  │  C10 Persist Relevancy Score → /api/relevancy-scores                     │               │
│  │  C11 (on C10 fail) Persist to DLQ → relevancy_scores_dlq via             │               │
│  │      POST /api/relevancy-scores?dlq=1 (v3.3)                             │               │
│  └─────────────▲──────────────────────────────────────────────────────────────┘               │
│                │ executeWorkflow                                                              │
│                │                                                                              │
│  ┌─────────────┴─────────────────────────────────────────────────────────────┐                │
│  │  EWnZg3svZWwcIRs4 (EXISTING — Vollna auto-pipeline) — v3.3 SPLICE         │                │
│  │   8 webhooks → Merge → Process Job →                                      │                │
│  │     [Kill-switch IF — env $RELEVANCY_CLASSIFIER_ENABLED] (NEW) ─┐         │                │
│  │       ├─ true  → Score Relevancy (NEW) → Route Verdict (NEW switch)      │                │
│  │       │                ├─ Active+reject       → End (Audit Only) (NEW)   │                │
│  │       │                ├─ Active+proceed<min  → End (Audit Only)         │                │
│  │       │                ├─ Active+proceed≥min  → Build GPT Input → ...    │                │
│  │       │                ├─ Active+review       → Build GPT Input → ...    │                │
│  │       │                └─ Shadow+any          → Build GPT Input → ...    │                │
│  │       └─ false → Build GPT Input (v2-pre-classifier emergency path)      │                │
│  │     → AI Proposal Writer → Format ClickUp Task (column = "Todo" — v3.3)  │                │
│  │     → Create Board Task (POST /api/v1/webhooks/tasks)                    │                │
│  └───────────────────────────────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────┐
                    │  Google AI Studio (Gemini)  │
                    │  gemini-2.5-flash           │
                    └─────────────────────────────┘

(No external scraping service. Profile data lives in upwork_profile_snapshots, uploaded via
admin UI / CLI. Job data lives in tasks.custom_fields, written by the existing Vollna pipeline.
Operator controls live in system_settings + profiles columns; n8n reads through profile-context.)
```

---

## 4. n8n Workflows

Two total in v3.3. One shared core, one new front door. (v3.1's `profile-ingest` and `profile-sync` workflows are gone — profile data is uploaded by the admin via the existing UI/CLI, not scraped.)

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

v3.3 splices three new nodes between `Process Job` and `Build GPT Input`:

| Node | Type | Purpose |
|---|---|---|
| `Score Relevancy` | `n8n-nodes-base.executeWorkflow` v1 | `workflowId: <_relevancy-classifier-core ID>`, `mode: 'each'`, passes `{profile_id, job, request_meta: { source: 'auto', task_id: null }}`. Returns the full verdict including `effective_decision`, `threshold_flipped`, and the resolved `_system.classifier_mode` / `_system.effective_min_score`. |
| `Route Verdict` | `n8n-nodes-base.switch` v3.2 | 5-way branch on `(effective_mode, effective_decision)`. See routing matrix below. |
| `End (Audit Only)` | `n8n-nodes-base.noOp` | Terminal — the `relevancy_scores` row was already written by `_relevancy-classifier-core`'s C10. Nothing else happens. |

#### Routing matrix

After `Score Relevancy`, every job falls into exactly one of five branches. The `effective_decision` field has already been computed inside the classifier core (it's `decision` adjusted by the min_score threshold — see §7.5):

| # | Branch trigger | Proposal written? | Card created? | Card column |
|---|---|---|---|---|
| 1 | `mode='active'` AND `effective_decision='reject'` *(gate fail OR below-threshold)* | No | No | — *(audit-log only)* |
| 2 | `mode='active'` AND `effective_decision='proceed'` | Yes | Yes | **Todo** |
| 3 | `mode='active'` AND `effective_decision='review'` | Yes | Yes | **Todo** |
| 4 | `mode='shadow'` AND any `decision` | Yes | Yes | **Todo** |
| 5 | `mode='shadow'` AND `decision='reject'` *(no rubric score)* | Yes | Yes | **Todo** |

Branch 1 routes to `End (Audit Only)` and terminates. Branches 2–5 enter the **existing** `Build GPT Input → AI Agent (Proposal Writer) → Format ClickUp Task → Create Board Task` chain — unchanged from today **except** for the column field, which is forced to `Todo` everywhere.

The simplifying rule: **card created ⇔ proposal written**. There is no branch that drafts a proposal without creating a card, and no branch that creates a card without a proposal. This means a human picking up a card in Todo can always rely on the proposal being already drafted in the description.

#### Today's `Proposal Submitted`-column bug (fixed in v3.3)

Today, `Format ClickUp Task` writes `column: "Proposal Submitted"` for every auto-created card. But n8n cannot actually submit on Upwork — it only drafts proposals. Cards landing in `Proposal Submitted` are operationally misleading: humans cannot distinguish "this proposal is live on Upwork awaiting client response" from "this proposal is drafted but still needs a human to paste it into Upwork and click Submit."

v3.3 changes `Format ClickUp Task` to write `column: "Todo"` for every auto-created card. `Proposal Submitted` becomes a **human-only** destination: a human moves the card there manually after they've copy-pasted the proposal into Upwork and clicked Submit. The column name then accurately reflects "proposals that are live on Upwork right now."

This is a one-line change inside `Format ClickUp Task`, applied to all card-creating branches (2, 3, 4, 5 above). No other downstream behavior changes — `syncJobStatusFromTask` still keys off `column.name`, so dashboards and lifecycle milestones continue working as today.

#### Kill-switch gate

Before `Score Relevancy`, an `IF` node reads `$env.RELEVANCY_CLASSIFIER_ENABLED`:

```
Process Job ─► IF (env=true) ─► Score Relevancy ─► Route Verdict ─► [branches 1–5]
                            └─► Build GPT Input (v2-pre-classifier behavior — emergency only)
```

When the env var is `false`, the workflow bypasses scoring entirely and falls through to today's behavior. This is intentionally separate from the Settings toggle: the Settings toggle says "AI should/shouldn't route" (granular, routine), the env var says "AI shouldn't run at all" (broad, emergency).

Net new nodes in the parent workflow: **4** (`Score Relevancy`, `Route Verdict`, `End (Audit Only)`, and one kill-switch `IF`).

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

UI shows a brief progress indicator (sub-second on most paths): "Loading task…" → "Loading profile context…" → "Running classifier…" → result. Compared to v3.1's 6–16s budget (Apify-bound), v3.3 evaluator is roughly an order of magnitude faster because no external network fetch is involved.

### 4.4 n8n implementation blueprint (v3.3)

This subsection is the **n8n-keeper agent's execution reference** — every new node has its type, typeVersion, position, error handler, sticky-note text, and (where relevant) the exact code body specified. Following the safe-update protocol in §13.1.

#### 4.4.1 New nodes for `EWnZg3svZWwcIRs4` (parent splice — Phase 7)

| ID | Node name | Type | typeVersion | Position | onError | Credentials |
|---|---|---|---|---|---|---|
| K1 | `IF — Classifier Enabled` | `n8n-nodes-base.if` | 2.2 | `[-720, 240]` (between `Process Job` and the legacy `Route Job`) | `continueRegularOutput` | none |
| K2 | `Score Relevancy` | `n8n-nodes-base.executeWorkflow` | 1 | `[-512, 192]` | `continueErrorOutput` | none (sub-workflow inherits) |
| K3 | `Route Verdict` | `n8n-nodes-base.switch` | 3.2 | `[-304, 192]` | `continueRegularOutput` | none |
| K4 | `End (Audit Only)` | `n8n-nodes-base.noOp` | 1 | `[-96, 320]` | n/a | none |
| K5 | *(EDIT existing)* `Format ClickUp Task` | (existing) | (unchanged) | (unchanged) | (unchanged) | (unchanged) |

K1 condition (n8n expression):

```
{{ ($env.RELEVANCY_CLASSIFIER_ENABLED ?? 'true') !== 'false' }}
```

K2 parameters:

```jsonc
{
  "workflowId":           "{{ _relevancy-classifier-core ID — pinned post-Phase 6 }}",
  "mode":                 "each",
  "options": {
    "waitForSubWorkflow": true
  }
}
```

Retry settings on K2: `retryOnFail: true, maxTries: 2, waitBetweenTries: 1500` (mirrors J5 in `job-evaluate-manual`).

K3 (`Route Verdict`) — five rules, evaluated top-down (first match wins). All expressions read from `$json` (the verdict output of K2):

```jsonc
{
  "rules": {
    "values": [
      {
        "outputKey": "active_reject",
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" },
          "conditions": [
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.request_meta.classifier_mode }}", "rightValue": "active" },
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.effective_decision }}", "rightValue": "reject" }
          ],
          "combinator": "and"
        }
      },
      {
        "outputKey": "active_proceed",
        "conditions": {
          "conditions": [
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.request_meta.classifier_mode }}", "rightValue": "active" },
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.effective_decision }}", "rightValue": "proceed" }
          ],
          "combinator": "and"
        }
      },
      {
        "outputKey": "active_review",
        "conditions": {
          "conditions": [
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.request_meta.classifier_mode }}", "rightValue": "active" },
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.effective_decision }}", "rightValue": "review" }
          ],
          "combinator": "and"
        }
      },
      {
        "outputKey": "shadow_any",
        "conditions": {
          "conditions": [
            { "operator": { "type": "string", "operation": "equals" },
              "leftValue": "={{ $json.request_meta.classifier_mode }}", "rightValue": "shadow" }
          ],
          "combinator": "and"
        }
      }
    ]
  },
  "fallbackOutput": "active_reject"
}
```

Output wiring:

- `active_reject` → K4 (`End (Audit Only)`)
- `active_proceed` → existing `Build GPT Input`
- `active_review` → existing `Build GPT Input`
- `shadow_any` → existing `Build GPT Input`

#### 4.4.2 `Format ClickUp Task` — the one-line column edit

`Format ClickUp Task` is the existing Code node that builds the Task Board payload. The current code has a literal `"column": "Proposal Submitted"` (or equivalent) inside the object returned by the code. v3.3 changes it to `"Todo"`. Exact `n8n_update_partial_workflow` operation:

```
updateNode → nodeName: "Format ClickUp Task"
  edit: parameters.jsCode — replace the substring `"column": "Proposal Submitted"`
                                              with `"column": "Todo"`
  (also update the human-readable "Status" custom field key if it mirrors column)
```

If the column name is built from a variable (e.g. `_column` driven by the upstream Switch), then v3.3 simply removes the variable assignment and hardcodes `'Todo'`. The n8n-keeper agent inspects the existing code at Phase 7 time and applies whichever pattern matches.

K5 also writes the v3.3 `_relevancy_*` custom_fields (§10.7.1) by reading from `$input.first().json` — the verdict propagated from K2. The keeper inserts this block in the code:

```js
custom_fields._relevancy_score             = verdict.total_score              ?? null;
custom_fields._relevancy_decision          = verdict.decision;
custom_fields._relevancy_effective         = verdict.effective_decision;
custom_fields._relevancy_threshold_flipped = verdict.threshold_flipped         ?? false;
custom_fields._relevancy_reasons           = verdict.rejection_reasons         ?? [];
custom_fields._relevancy_tier              = verdict.tier                      ?? null;
custom_fields._relevancy_confidence        = verdict.confidence                ?? null;
custom_fields._relevancy_score_id          = verdict._score_id                 ?? null;
custom_fields._relevancy_evaluated_at      = new Date().toISOString();
custom_fields._relevancy_mode_at_decision  = verdict.request_meta?.classifier_mode ?? 'shadow';
```

`verdict._score_id` is set by C10 (the persist call) and propagated back through the executeWorkflow return. If the DLQ path fired, `_score_id` is null and the card still renders the badge from the in-memory verdict.

#### 4.4.3 New nodes for `_relevancy-classifier-core` (Phase 6)

| ID | Node name | Type | typeVersion | Position | onError |
|---|---|---|---|---|---|
| C1 | `Load Profile Context` | `n8n-nodes-base.httpRequest` | 4.2 | `[-1200, 0]` | `continueErrorOutput` |
| C2 | `Deterministic Pre-check` | `n8n-nodes-base.code` | 2 | `[-992, 0]` | `continueRegularOutput` |
| C3 | `Gate Switch` | `n8n-nodes-base.if` | 2.2 | `[-784, 0]` | `continueRegularOutput` |
| C4 | `Prepare Classifier Input` | `n8n-nodes-base.set` | 3.4 | `[-576, -96]` | `continueRegularOutput` |
| C5 | `AI Agent — Relevancy Classifier` | `@n8n/n8n-nodes-langchain.agent` | 1.6 | `[-368, -96]` | `continueErrorOutput` |
| C6 | `Validate Output + Apply Threshold` | `n8n-nodes-base.code` | 2 | `[-160, -96]` | `continueRegularOutput` |
| C7 | `Build Reject Payload` | `n8n-nodes-base.set` | 3.4 | `[48, 96]` | `continueRegularOutput` |
| C8 | `Decision Switch` | `n8n-nodes-base.switch` | 3.2 | `[256, 0]` | `continueRegularOutput` |
| C9 | `Build Review Payload` | `n8n-nodes-base.set` | 3.4 | `[48, -96]` | `continueRegularOutput` |
| C10 | `Persist Relevancy Score` | `n8n-nodes-base.httpRequest` | 4.2 | `[464, 0]` | `continueErrorOutput` |
| C11 | `Persist to DLQ` | `n8n-nodes-base.httpRequest` | 4.2 | `[672, 192]` | `continueRegularOutput` |

C1 parameters:

```jsonc
{
  "method":        "GET",
  "url":           "=http://157.173.110.62/api/profiles/{{ $json.profile_id }}/context",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "options": {
    "timeout": 10000,
    "response": { "response": { "neverError": true } }
  }
}
```

Credentials: `n8n-board-sync` (Header Auth — existing).

C10 parameters:

```jsonc
{
  "method": "POST",
  "url":    "http://157.173.110.62/api/relevancy-scores",
  "sendHeaders": true,
  "headerParameters": { "parameters": [
    { "name": "X-Idempotency-Key", "value": "={{ $execution.id }}-{{ $('Webhook (Manual Eval)').first().json.task_id ?? $json.job_external_id }}" }
  ]},
  "sendBody":      true,
  "bodyParameters": { "parameters": [ { "name": "verdict", "value": "={{ JSON.stringify($json) }}" } ] },
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "options": { "timeout": 10000 }
}
```

C11 (DLQ writer) — wired on C10's **error output**:

```jsonc
{
  "method": "POST",
  "url":    "http://157.173.110.62/api/relevancy-scores?dlq=1",
  "sendBody": true,
  "bodyParameters": { "parameters": [
    { "name": "payload",      "value": "={{ JSON.stringify($('Validate Output + Apply Threshold').item.json) }}" },
    { "name": "error_detail", "value": "={{ $json.error?.message ?? 'unknown' }}" }
  ]},
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "options": { "neverError": true }
}
```

#### 4.4.4 C6 — threshold logic (JavaScript body)

The exact `code` node body for C6 (drop-in):

```js
// C6 — Validate Output + Apply Threshold (v3.3)
//
// Input  ($json):  raw classifier verdict (from C5 AI Agent or from C2/C3 deterministic-reject path)
// Output ($json):  validated verdict with effective_decision + threshold_flipped + min_score_at_decision

const verdict = items[0].json;

// 1. Schema sanity check — minimal subset
const ALLOWED_DECISIONS = new Set(['proceed', 'reject', 'review']);
if (!ALLOWED_DECISIONS.has(verdict.decision)) {
  // Schema drift — fall back to 'review' so the parent doesn't silently default to proceed (§16.7 A1)
  verdict.decision         = 'review';
  verdict.confidence       = (verdict.confidence ?? 0) * 0.5;
  verdict.confidence_warnings = [...(verdict.confidence_warnings ?? []), 'invalid_decision_value'];
}

// 2. Verifier (§16.7 A3) — regex-scan job description for gate-9/8/7 hallucinations
const jobDescription = items[0].json._jobDescription ?? '';
const VIDEO_RE       = /\b(loom|video|screen[-\s]?recording|record yourself)\b/i;
if (verdict.decision === 'proceed' && VIDEO_RE.test(jobDescription)) {
  // Flip to reject — classifier missed a video requirement
  verdict.decision         = 'reject';
  verdict.rejection_reasons = [...(verdict.rejection_reasons ?? []), 'Video Proposal'];
  verdict.confidence_warnings = [...(verdict.confidence_warnings ?? []), 'verifier_flipped_video'];
}

// 3. Threshold application (v3.3 — §7.5)
const reqMeta            = verdict.request_meta ?? {};
const classifierMode     = reqMeta.classifier_mode ?? 'shadow';   // resolved by C1 from /api/profiles/:id/context._system
const minScore           = reqMeta.min_score        ?? 50;
const totalScore         = verdict.total_score      ?? null;

let effectiveDecision = verdict.decision;
let thresholdFlipped  = false;

if (verdict.decision === 'proceed' && totalScore !== null && totalScore < minScore) {
  effectiveDecision        = 'reject';
  thresholdFlipped         = true;
  verdict.rejection_reasons = [...(verdict.rejection_reasons ?? []), 'Below score threshold'];
}

// 4. Pin the verdict's mode + threshold context for downstream + audit log
verdict.effective_decision           = effectiveDecision;
verdict.threshold_flipped            = thresholdFlipped;
verdict.min_score_at_decision        = minScore;
verdict.classifier_mode_at_decision  = classifierMode;

return [{ json: verdict }];
```

This JS body is committed to the workflow JSON at Phase 6 time; the n8n-keeper agent's `n8n_update_partial_workflow` `updateNode` op writes it into C6's `parameters.jsCode`.

#### 4.4.5 Sticky-note text (per §13.2)

Each new node gets a sticky-note pinned adjacent. The keeper agent writes these on the canvas via `addStickyNote` operations.

| Node | Sticky-note text |
|---|---|
| K1 `IF — Classifier Enabled` | "v3.3 kill-switch. Reads `$env.RELEVANCY_CLASSIFIER_ENABLED`. Default `true`. Set to `'false'` to bypass scoring and revert to v2 behavior in <30s. Routine ops use the Settings UI; this is the panic button." |
| K2 `Score Relevancy` | "v3.3 splice. Invokes `_relevancy-classifier-core` (workflowId pinned). Returns full verdict including `effective_decision`. `retryOnFail: true`, `maxTries: 2`. On 2× failure → fall through to `End (Audit Only)` via error output." |
| K3 `Route Verdict` | "v3.3 5-way switch. Reads `effective_decision` and `classifier_mode`. Branches: active_reject + active_proceed_below_min → End (no card). active_proceed/review/shadow_any → existing Build GPT Input. Fallback = active_reject (safe default)." |
| K4 `End (Audit Only)` | "v3.3 terminal. Score already persisted by C10 (or DLQ'd by C11). Nothing else happens — no proposal, no card. Audit visible in `/relevancy-audit`." |
| K5 `Format ClickUp Task` (edited) | "v3.3 EDIT: column changed from `Proposal Submitted` to `Todo`. Cards are now human-routed to Proposal Submitted only after Upwork submission. Also writes `_relevancy_*` custom_fields." |
| C1 `Load Profile Context` | "v3.3: returns `_system.classifier_mode` and `_system.effective_min_score`. Read these via `$('Load Profile Context').item.json._system` downstream. Cached upstream by dashboard (5min TTL + tag invalidation)." |
| C6 `Validate Output + Apply Threshold` | "v3.3: computes `effective_decision`. If raw `decision='proceed'` AND `total_score < min_score` → flip to `reject` + append `Below score threshold`. Also schema-validates and runs the gate-9 verifier (§16.7 A3)." |
| C10 `Persist Relevancy Score` | "Writes the full v3.3 verdict to `relevancy_scores`. Idempotency-keyed by `(execution_id, task_or_job_id)`. On HTTP failure → error output flows to C11." |
| C11 `Persist to DLQ` | "v3.3: on C10 failure, parks the payload in `relevancy_scores_dlq` for the background drain worker (§DLQ retry, Appendix C). `neverError: true` — pipeline never blocks on audit-log writes." |

#### 4.4.6 Partial-update operation list (Phase 7)

The exact `n8n_update_partial_workflow` operation sequence to ship the parent splice:

```
1. addNode K1 (IF — Classifier Enabled)             ← see 4.4.1
2. addNode K2 (Score Relevancy)
3. addNode K3 (Route Verdict)
4. addNode K4 (End (Audit Only))
5. addStickyNote — adjacent to each of K1..K4
6. removeConnection — Process Job → Route Job (legacy or current downstream link)
7. addConnection   — Process Job → K1
8. addConnection   — K1 (output 0 = true)  → K2
9. addConnection   — K1 (output 1 = false) → Build GPT Input (emergency bypass)
10. addConnection  — K2 (main output)      → K3
11. addConnection  — K2 (error output)     → K4
12. addConnection  — K3 outputs:
                      active_reject  → K4
                      active_proceed → Build GPT Input
                      active_review  → Build GPT Input
                      shadow_any     → Build GPT Input
13. updateNode Format ClickUp Task  — edit parameters.jsCode per 4.4.2
14. n8n_validate_workflow → expect 0 errors
15. n8n_test_workflow with a known-good fixture
```

For `_relevancy-classifier-core` (Phase 6), it's a brand-new workflow created via `n8n_create_workflow` with all 11 C-nodes specified in one shot, then individually validated.

#### 4.4.7 Credentials map

| Credential | Type | Used by |
|---|---|---|
| `Gemini` (existing or new) | `@n8n/n8n-nodes-langchain` agent credential | C5 |
| `n8n-board-sync` (existing) | `httpHeaderAuth` (`Authorization: Bearer n8n-board-sync`) | C1, C10, C11, J3 |
| `MANUAL_EVAL_TOKEN` (new) | `httpHeaderAuth` | `job-evaluate-manual` J1 (webhook auth) |

The Gemini credential carries the `GEMINI_API_KEY` env value. Provisioning is Phase 0 (§15.1).

#### 4.4.8 Profile-context cache contract (n8n side)

n8n's `Load Profile Context` (C1) calls `/api/profiles/:id/context`. The dashboard side caches the response per `profile-context-<id>` + `system-settings` tags (§11.4). n8n's own fallback is `n8n_static_data` keyed by `profile_id`, 1h TTL — used only when C1 errors out (HTTP failure, 5xx). On success, n8n does NOT cache; the dashboard's `unstable_cache` already provides the bulk of the hot-path acceleration.

This guarantees that **settings flips propagate within ~60s** (dashboard cache TTL) and **never longer than 1h** (n8n static-data TTL as the worst-case stale window if the dashboard is down).

---

## 5. Profile Data Source

The v3.x family has no scraping workflow. Profile data is sourced from `upwork_profile_snapshots` — an existing append-only table populated by admin uploads. Migration 017 (already shipped) and the surrounding tooling cover the entire profile-ingest concern.

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

**Loaded profiles as of 2026-05-11 (v3.3 doc snapshot):** Shayan, Saim, Craig, Sana, Khansa, Rebekah, Nawal (7 profiles, verified live against Contabo `upwork_profile_snapshots_current`). **Laiba is intentionally unloaded** — her profile is currently inactive and her Vollna feed is paused/disabled at the source; no scoring is expected to flow through her. If the inactive status changes later, the standard snapshot-upload procedure (§5.5) applies. The classifier returns a clean error (`profile_snapshot_missing`) when an evaluation is requested for a profile with zero `is_current` rows.

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
  "_system": {
    "classifier_mode":      "shadow",     // effective mode for THIS profile (global × per-profile resolved server-side)
    "effective_min_score":  50,            // profile.min_score_override ?? global.min_score
    "global_mode":          "shadow",      // raw global value (for transparency in audit page; n8n routes off classifier_mode)
    "profile_enabled":      true,          // profiles.classifier_enabled at fetch time
    "profile_min_override": null           // null = inherit global
  },
  "criteria_version":     "0.2",
  "context_generated_at": "2026-05-11T13:00:00Z"
}
```

**`_system` block (v3.3 addition)** — computed server-side by `getProfileContext(profileId)` in `src/lib/data.ts` from the `system_settings` table × `profiles.classifier_enabled` × `profiles.min_score_override`. The `classifier_mode` value is the resolved effective mode that `_relevancy-classifier-core`'s C1 reads — the parent workflow's `Route Verdict` switch keys off this field. The `global_mode` and `profile_enabled` keys are kept for audit-page rendering ("why is this profile in shadow? because global is shadow" vs "because the per-profile toggle is off"). Cache invalidation: `revalidateTag('profile-context-<id>')` fires on snapshot upload AND on any `system_settings` or `profiles.classifier_*` mutation (§10.6.6).

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

### 7.5 Min-score threshold (NEW in v3.3)

The 11 hard gates produce `decision = reject` for binary failures (no portfolio, wrong stack, below hourly floor, etc). The 7-component rubric produces a 0–100 score for everything that passed the gates. v3.3 adds a third layer between them and routing: the **min-score threshold**.

#### Why this exists

A job can pass every hard gate (legitimately decent client, stack-adjacent skills, in-budget, fresh, no video proposal, etc.) and still score 35/100 on the rubric — typical when the portfolio overlap is weak or the competition is brutal. Pre-v3.3, the binary verdict would be `proceed`; in Active mode this would burn an Anthropic call and clutter the board with a low-quality lead. The threshold gives the admin a single number to express "don't pursue proceeds below this score."

#### Where it's applied

Inside `_relevancy-classifier-core` after the LLM returns its raw verdict, in node C6 (`Validate Classifier Output`). The transform:

```
raw_decision = classifier.decision           // 'proceed' | 'reject' | 'review'
total_score  = classifier.total_score        // 0–100 (null if gate-failed)
min_score    = profile.min_score_override ?? global.min_score
threshold_flipped = (raw_decision === 'proceed' && total_score < min_score)

effective_decision = threshold_flipped
                   ? 'reject'                // proceed below threshold → reject
                   : raw_decision            // everything else passes through unchanged
```

Only `proceed` verdicts can be flipped. `reject` stays `reject` (already worse than threshold-flipped). `review` stays `review` (the AI is explicitly asking for human eyes — threshold doesn't apply).

#### What gets recorded

Every `relevancy_scores` row stores **both** verdicts plus the threshold value at the time of scoring:

```jsonc
{
  "decision":               "proceed",   // raw AI verdict (never adjusted)
  "total_score":            42,
  "effective_decision":     "reject",    // post-threshold (what routing acts on)
  "threshold_flipped":      true,
  "min_score_at_decision":  50,
  "rejection_reasons":      ["Below score threshold"]   // appended when flipped
}
```

The `rejection_reasons` array gains a synthetic `"Below score threshold"` entry when a flip occurred, so audit-page filtering on `rejection_reasons @> '{Below score threshold}'` returns exactly the threshold-flipped rows.

#### Why store both verdicts

Reconstructing "what did the AI think?" vs "what did we do?" matters for:

1. **Threshold tuning.** "If I'd set min=40 instead of 50, how many cards would have proceeded?" → `SELECT COUNT(*) FROM relevancy_scores WHERE decision='proceed' AND total_score BETWEEN 40 AND 49`.
2. **Calibration.** "Of the cards the threshold flipped to reject, what fraction did an agent later mark as a missed opportunity?" → join `relevancy_scores` against `relevancy_overrides`.
3. **Confidence in the threshold.** A tile on `/relevancy-audit` shows `threshold_flipped` rate over time — if it climbs, the classifier is producing more mid-score proceeds and the threshold is doing more work; if it drops, gates are catching more or the rubric is harshening.

#### Shadow mode ignores the threshold's routing effect — but still records it

In `mode='shadow'`, every card lands in Todo regardless of `effective_decision`. But C6 still computes `effective_decision` and writes it to `relevancy_scores`. This is so the admin can answer "if I flipped to Active today, with the current threshold, what would happen?" without changing anything. The Settings page can render: "At today's threshold (50), 28 of last week's 142 jobs would have been auto-rejected." That preview is what makes calibration tractable.

#### Threshold validation at save time

When the admin updates global `min_score` (or a per-profile override), the API computes a live preview from the last 7 days of `relevancy_scores`:

```
of N proceeds in the window, X would have been flipped to reject at the new value
```

If `X / N > 0.5`, the save returns a soft warning: "At this threshold, more than half of currently-proceed jobs would be flipped. Continue?" The admin can confirm or back out. Hard reject only on `value < 0 || value > 100`.

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

### 8.4 Output schema (v3.3)

Same as v2 §5.4 with the v3 additions PLUS the v3.3 threshold fields:

```jsonc
{
  // ... v2 fields (decision, gates_passed, gates_failed, rejection_reasons,
  //                components, total_score, tier, confidence, proposal_angles,
  //                summary, missing_signals, model, prompt_version, etc.) ...

  // ---- v3.3 threshold + effective-decision fields ----
  "effective_decision":     "reject",   // 'proceed' | 'reject' | 'review' — what routing acts on
  "threshold_flipped":      true,       // true iff decision='proceed' AND total_score < min_score
  "min_score_at_decision":  50,         // integer 0–100 — the threshold in force at score time

  "request_meta": {
    "source": "auto | manual_url | shadow",
    "task_id": "string|null",
    "thresholds_used": { ... },         // snapshot of effective per-gate thresholds
    "min_score":              50,        // duplicated here for n8n switch convenience
    "classifier_mode":        "active",  // resolved effective mode (global × per-profile)
    "deterministic_resolved": ["1_stack_match","2_freshness", ...],
    "llm_resolved":           ["7_job_availability", ...]
  },
  "evidence_panel": {
    // human-readable bundle for the dashboard UI
    "strengths":         ["Stripe + Laravel portfolio direct match", "Client $18k spent, 26 hires"],
    "weaknesses":        ["12 proposals already submitted (high but under cap)"],
    "match_explanation": "Job needs Laravel + Stripe billing; profile has direct portfolio piece + multi-tenant SaaS work."
  }
}
```

**`effective_decision` semantics** (computed in C6, see §7.5):

- `decision='reject'` (any cause) → `effective_decision='reject'`
- `decision='proceed'` AND `total_score >= min_score` → `effective_decision='proceed'`
- `decision='proceed'` AND `total_score < min_score` → `effective_decision='reject'`, `threshold_flipped=true`, `rejection_reasons` appended with `"Below score threshold"`
- `decision='review'` → `effective_decision='review'` (threshold never applies)

**Routing (in `Route Verdict` switch, §4.2) keys off `effective_decision` + `request_meta.classifier_mode`** — never the raw `decision`. The audit page can render both for transparency.

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

### 9.2 New: migration 018 — relevancy scoring tables + operator controls

```sql
-- ============================================================================
-- v3.3 — Operator controls
-- ============================================================================

-- Global system settings. Key/value store; one row per setting.
CREATE TABLE IF NOT EXISTS system_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  description  TEXT,
  updated_by   TEXT,                                  -- session.user.id of last editor
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated ON system_settings (updated_at DESC);

-- Seed v3.3 settings (idempotent).
INSERT INTO system_settings (key, value, description) VALUES
  ('relevancy.classifier_mode', '"shadow"'::jsonb,
   'Global classifier routing mode. shadow = score only, no routing. active = AI decision drives routing.'),
  ('relevancy.min_score', '50'::jsonb,
   'Global minimum total_score threshold. proceed verdicts with total_score < this value are flipped to reject when classifier_mode=active.')
ON CONFLICT (key) DO NOTHING;

-- Per-profile gate threshold overrides. JSONB keeps the schema flexible.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS thresholds_overrides JSONB DEFAULT '{}'::jsonb;

-- Per-profile operator controls (v3.3).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS classifier_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS min_score_override INTEGER
  CHECK (min_score_override IS NULL OR (min_score_override >= 0 AND min_score_override <= 100));

-- ============================================================================
-- Criteria version snapshot (immutable history of PRD versions).
-- ============================================================================
CREATE TABLE IF NOT EXISTS criteria_versions (
  version          TEXT PRIMARY KEY,
  prd_changelog    TEXT NOT NULL,
  thresholds       JSONB NOT NULL,                  -- snapshot of all gate thresholds at this version
  reason_enum      TEXT[] NOT NULL,                 -- snapshot of valid rejection reasons (PRD §6.2 labels, typos preserved)
  output_schema    JSONB,                           -- expected Gemini structured-output schema for this version (A10)
  prompt_versions  TEXT[],                          -- prompt versions compatible with this criteria version
  effective_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Canonical scoring log for both auto pipeline and manual evaluator.
-- ============================================================================
CREATE TABLE IF NOT EXISTS relevancy_scores (
  id                BIGSERIAL PRIMARY KEY,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  job_external_id   TEXT,                                                       -- Upwork stable job ID
  profile_id        TEXT REFERENCES profiles(profile_id),
  decision          TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),
  -- v3.3 threshold fields
  effective_decision     TEXT NOT NULL CHECK (effective_decision IN ('proceed','reject','review')),
  threshold_flipped      BOOLEAN NOT NULL DEFAULT FALSE,
  min_score_at_decision  INTEGER CHECK (min_score_at_decision IS NULL OR (min_score_at_decision BETWEEN 0 AND 100)),
  classifier_mode_at_decision TEXT NOT NULL CHECK (classifier_mode_at_decision IN ('shadow','active')),
  snapshot_id       UUID,                                                       -- FK to upwork_profile_snapshots.id (the row C1 read). Nullable: snapshot may be deleted later.
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
  thresholds_used   JSONB,                                                      -- snapshot of effective per-gate thresholds at score time
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
-- v3.3 indexes for threshold + effective-decision analytics
CREATE INDEX IF NOT EXISTS idx_rs_effective    ON relevancy_scores (effective_decision, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_flipped      ON relevancy_scores (threshold_flipped, evaluated_at DESC) WHERE threshold_flipped = TRUE;
CREATE INDEX IF NOT EXISTS idx_rs_mode         ON relevancy_scores (classifier_mode_at_decision, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rs_snapshot     ON relevancy_scores (snapshot_id);
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

What's NOT in v3.3's migration (versus v3.1's planned tables):

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

Net new objects in v3.3: **3 columns on `profiles`** (`thresholds_overrides`, `classifier_enabled`, `min_score_override`), **6 tables** (`system_settings`, `criteria_versions`, `relevancy_scores`, `relevancy_scores_dlq`, `manual_job_evaluations`, `relevancy_overrides`), and **4 new columns on `relevancy_scores`** (`effective_decision`, `threshold_flipped`, `min_score_at_decision`, `classifier_mode_at_decision`).

### 9.3 Migration 018 rollback (`018_rollback.sql`)

The forward migration is mostly additive (three columns on `profiles`, six new tables — none of them referenced by existing rows). Rollback is safe at any time before the classifier ships:

```sql
DROP TABLE IF EXISTS relevancy_overrides;
DROP TABLE IF EXISTS manual_job_evaluations;
DROP TABLE IF EXISTS relevancy_scores_dlq;
DROP TABLE IF EXISTS relevancy_scores;
DROP TABLE IF EXISTS criteria_versions;
DROP TABLE IF EXISTS system_settings;
ALTER TABLE profiles DROP COLUMN IF EXISTS thresholds_overrides;
ALTER TABLE profiles DROP COLUMN IF EXISTS classifier_enabled;
ALTER TABLE profiles DROP COLUMN IF EXISTS min_score_override;
```

Once the classifier is live and `relevancy_scores` rows accumulate, rollback loses calibration data — see §14.6. `system_settings` rows are operator state (mode toggle, min score) — losing them is harmless because the seed in §9.2 re-creates them with safe defaults (`shadow`, `50`) on re-run.

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

v3.3 adds two new admin routes (`/relevancy-evaluator`, `/relevancy-audit`) and one new card on the existing `/settings` page (Relevancy Classifier — see §10.6). Profile Management already exists in Settings via the snapshot drawer.

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
│ Auto-pipeline ran:  2026-05-06 08:14 → decision = proceed (score 91, badge 🟢)    │
│ Card flow:          Auto-created in Todo (per §4.2) → Sana moved to Proposal      │
│                     Submitted at 08:42 after sending on Upwork                    │
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

### 10.6 Operator Settings (NEW in v3.3)

The four operator knobs live in a new `Relevancy Classifier` card on the existing `/settings` page (admin only). The card has two sections: **global controls** at the top, **per-profile overrides** in a table below.

#### 10.6.1 Global section — when mode is Shadow

```
┌─ Relevancy Classifier ─────────────────────────────────────────────────┐
│                                                                        │
│  Global mode      ●  Shadow   ○  Active                                │
│                                                                        │
│   ⓘ While global is Shadow, every job runs through scoring AND the    │
│     existing proposal writer. AI verdict is logged but does NOT       │
│     route. All cards land in Todo with the relevancy badge visible.   │
│     Per-profile toggles below are inert while global is Shadow.       │
│                                                                        │
│  Minimum score    [ 50 ] / 100   (only used when Active)               │
│                                                                        │
│  Last changed: 2026-05-11 14:02 by you (was: Active → Shadow)         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### 10.6.2 Global section — when mode is Active

```
┌─ Relevancy Classifier ─────────────────────────────────────────────────┐
│                                                                        │
│  Global mode      ○  Shadow   ●  Active                                │
│                                                                        │
│   ⓘ Per-profile toggles below now drive routing. A profile set to     │
│     Shadow here will be scored but not routed by the AI.              │
│                                                                        │
│  Minimum score    [ 50 ] / 100                                         │
│                                                                        │
│   At today's threshold, 28 of last 7 days' 142 proceeds (20%) would   │
│   have been flipped to reject. [Preview distribution ↗]               │
│                                                                        │
│  Last changed: 2026-05-11 14:02 by you (was: Shadow → Active)         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### 10.6.3 Per-profile table

```
┌─ Profiles ─────────────────────────────────────────────────────────────┐
│                                                                        │
│  Sana        [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│  Laiba       [   ⬤  ] Active     Min score: [ 60 ] override          │
│  Khansa      [ ⬤    ] Shadow     Min score:  —    (mode is shadow)   │
│  Shayan      [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│  Saim        [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│  Craig       [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│  Rebekah     [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│  Nawal       [   ⬤  ] Active     Min score: [ 50 ] (using global)    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

When global is `shadow`, every row in this table is greyed out and the toggles are disabled (clicks are no-ops with a tooltip "Enable global classifier first"). When global is `active`, all rows are interactive.

A profile in Shadow (per-profile) shows `—` for its Min score column — that override doesn't apply while the profile is shadow.

#### 10.6.4 Confirmation rules

| Action | Confirm? | Why |
|---|---|---|
| Global Shadow → Active | **Modal** | Flips production routing for every enabled profile. Modal previews "X jobs in last 24h would have been auto-rejected." |
| Global Active → Shadow | **Modal** | Disables AI routing for everyone. Modal confirms "all proceeds will now go to Todo for human review." |
| Min score change > ±20 from current | **Soft modal** | Cushion against accidental keyboard-flick changes. |
| Min score change ≤ ±20 | Instant save | Small tweaks during calibration shouldn't gate on a modal. |
| Per-profile toggle (when global Active) | Instant flip | Small blast radius, easy to undo. |
| Per-profile min override change | Instant save | Same — small blast radius. |

#### 10.6.5 API endpoints

| Method | Endpoint | Body | Auth |
|---|---|---|---|
| GET | `/api/admin/system-settings` | — | Admin session |
| PATCH | `/api/admin/system-settings/relevancy-mode` | `{ mode: 'shadow' \| 'active' }` | Admin session |
| PATCH | `/api/admin/system-settings/min-score` | `{ value: number }` (0–100 integer) | Admin session |
| PATCH | `/api/profiles/:id/classifier-config` | `{ classifier_enabled?: boolean, min_score_override?: number \| null }` | Admin session |
| GET | `/api/admin/system-settings/threshold-preview?value=N` | — | Admin session — returns `{ proceeds_in_window, would_flip, percentage }` |

#### 10.6.6 Cache busting

Every successful PATCH triggers:

- `revalidateTag('system-settings')` — invalidates the global settings cache (read by `/api/profiles/:id/context` to embed `_system.classifier_mode` + `_system.effective_min_score`)
- `revalidateTag('profile-context-<id>')` for the affected profile(s)
- For global changes, all `profile-context-*` tags are busted

n8n picks up the new effective values on its next profile-context cache miss — typically within 60s. There is no push channel from the dashboard to n8n; the TTL is the bound.

#### 10.6.7 Audit trail

Every operator-controls change writes a row to `activity_log`:

```sql
INSERT INTO activity_log (entity_type, entity_id, action, payload, actor_id, created_at)
VALUES
  ('system_setting', 'relevancy.classifier_mode', 'updated',
   '{"old":"shadow","new":"active"}', '<admin-user-id>', NOW()),
  ('system_setting', 'relevancy.min_score',      'updated',
   '{"old":50,"new":60}',              '<admin-user-id>', NOW()),
  ('profile',        '<profile-uuid>', 'classifier_config_updated',
   '{"classifier_enabled":{"old":true,"new":false}}',
                                       '<admin-user-id>', NOW());
```

The `/relevancy-audit` page shows a "Settings history" timeline overlay on the decision-distribution chart so admins can correlate "we flipped to Active on May 13" with "proceed rate dropped 60%."

### 10.7 Task card relevancy badge (NEW in v3.3)

Every auto-created card now carries the classifier's verdict in its `custom_fields`. The Task Board card component renders a compact badge that lets a human triage from Todo at a glance — no need to click into the detail modal first.

#### 10.7.1 `custom_fields` contract

`Format ClickUp Task` writes these keys on every auto-created card (in addition to the existing `_job_id`, `_skills`, `_proposal`, etc.):

```jsonc
{
  "_relevancy_score":             42,
  "_relevancy_decision":          "proceed",          // raw AI verdict
  "_relevancy_effective":         "reject",           // post-threshold
  "_relevancy_threshold_flipped": true,
  "_relevancy_reasons":           ["Below score threshold"],
  "_relevancy_tier":              "caution",
  "_relevancy_confidence":        0.78,
  "_relevancy_score_id":          12345,              // FK to relevancy_scores.id
  "_relevancy_evaluated_at":      "2026-05-11T...",
  "_relevancy_mode_at_decision":  "shadow"            // 'shadow' | 'active'
}
```

These keys are always populated when an auto-created card exists, because in v3.3 every auto-created card came through `Score Relevancy`. They are NEVER populated on manually-created cards (which never invoke the classifier).

#### 10.7.2 Badge rendering rules

Three visual states, picked by `_relevancy_effective`:

| `_relevancy_effective` | Badge color | Label |
|---|---|---|
| `proceed` | 🟢 green | `Score: N · AI proceed` |
| `review` | 🟡 yellow | `Score: N · AI review` |
| `reject` (shadow only — in active these cards don't exist) | 🔴 red | `AI reject` |

Score is omitted when `null` (gate-failed reject in shadow mode).

A `threshold_flipped=true` card gets a small "⚠ Below threshold" sub-label under the badge so the admin can spot threshold-driven flips without opening the card.

#### 10.7.3 Examples

```
┌──────────────────────────────────────────────────────┐
│ [Sana] Build Laravel + Stripe SaaS billing          │
│ 🟢 Score: 91 · AI proceed                           │
│ Strong stack + portfolio match                       │
│                                                      │
│ $35-60/hr · Client $18k · 4.97★ · 5h ago            │
└──────────────────────────────────────────────────────┘     ← Active+proceed (≥ min) OR Shadow+proceed

┌──────────────────────────────────────────────────────┐
│ [Laiba] Need React + Three.js demo                  │
│ 🟢 Score: 42 · AI proceed                           │
│ ⚠ Below threshold (50)                              │
│                                                      │
│ $30-50/hr · USA · 4.97★ · 12 proposals · 4h ago     │
└──────────────────────────────────────────────────────┘     ← Shadow only — in Active this card would not exist

┌──────────────────────────────────────────────────────┐
│ [Sana] $5 fixed WordPress fix                       │
│ 🔴 AI reject                                         │
│ Bad client rating · Low client spend                 │
│                                                      │
│ Fixed $5 · Unverified client · 7h ago               │
└──────────────────────────────────────────────────────┘     ← Shadow only — in Active no card created
```

#### 10.7.4 Where the badge appears

| Surface | Renders badge? | Note |
|---|---|---|
| Task Board kanban card | Yes | Compact form (top of card) |
| Task detail modal | Yes | Full gate + rubric breakdown in a collapsible "Relevancy" section |
| Tasks list page | Yes | Inline in the row |
| Search results | Yes | Inline |
| Manual evaluator result panel (§10.3) | Already covered | Existing |

The detail-modal "Relevancy" section reads `relevancy_scores.id` from `_relevancy_score_id` and fetches the full row — gives gate-by-gate evidence, rubric components, proposal angles. No need to duplicate this data into `custom_fields`.

### 10.8 Frontend implementation catalog (v3.3)

This subsection names every new React component, its file path, components-to-edit, and the supporting libraries / primitives. It's the "what files do I create / touch?" checklist for the dashboard engineer.

#### 10.8.1 New components

| Component | File path | Purpose | Parent |
|---|---|---|---|
| `<RelevancyClassifierCard>` | `src/components/settings/relevancy-classifier-card.tsx` | The §10.6 Settings card. Composes global controls + per-profile sub-table + confirm dialogs. | `src/app/(dashboard)/settings/page.tsx` (existing) |
| `<RelevancyModeToggle>` | `src/components/settings/relevancy-mode-toggle.tsx` | shadcn `<RadioGroup>` for `'shadow' \| 'active'`. Server-action backed (`setRelevancyMode`). | `<RelevancyClassifierCard>` |
| `<MinScoreInput>` | `src/components/settings/min-score-input.tsx` | shadcn `<Input type=number>` 0-100 + threshold-preview fetch on blur. Server-action backed (`setMinScore`). | `<RelevancyClassifierCard>` |
| `<RelevancyProfileTable>` | `src/components/settings/relevancy-profile-table.tsx` | shadcn `<Table>` listing profiles with `<Switch>` and inline `<Input>` per row. | `<RelevancyClassifierCard>` |
| `<RelevancyProfileRow>` | `src/components/settings/relevancy-profile-row.tsx` | Single row — toggle + min-override input + disabled-when-global-shadow state. Server-action backed (`setProfileClassifierConfig`). | `<RelevancyProfileTable>` |
| `<RelevancyModeConfirmDialog>` | `src/components/settings/relevancy-mode-confirm-dialog.tsx` | shadcn `<AlertDialog>` with preview metrics ("X jobs in last 24h would have been auto-rejected") before flipping global. | `<RelevancyModeToggle>` |
| `<ThresholdPreviewChart>` | `src/components/settings/threshold-preview-chart.tsx` | Recharts sparkline of `would_flip / proceeds_in_window` × candidate min. Renders inline when min input is focused. | `<MinScoreInput>` |
| `<RelevancyBadge>` | `src/components/tasks/relevancy-badge.tsx` | Compact colored badge for the task card. Reads `_relevancy_*` from `custom_fields`. Three states: proceed / review / reject. | `<TaskCard>` + list rows + search result rows |
| `<RelevancyDetailSection>` | `src/components/tasks/relevancy-detail-section.tsx` | Collapsible section in the task detail modal. Fetches the full `relevancy_scores` row via `_relevancy_score_id`. | `<TaskDetailModal>` |
| `<RelevancyEvaluatorForm>` | `src/components/relevancy/relevancy-evaluator-form.tsx` | URL paste + profile picker + submit. | `src/app/(dashboard)/relevancy-evaluator/page.tsx` |
| `<RelevancyEvaluatorResult>` | `src/components/relevancy/relevancy-evaluator-result.tsx` | The verdict panel (gates / rubric / angles / card-status / auto-pipeline-ran row). | Same |
| `<RelevancyAuditPage>` | `src/app/(dashboard)/relevancy-audit/page.tsx` | Server component composing all tiles. | (route) |
| `<RelevancyDecisionDistributionTile>` | `src/components/relevancy-audit/decision-distribution-tile.tsx` | Decision pie/bar from §10.4 | `<RelevancyAuditPage>` |
| `<RelevancyGateFailRateTile>` | `src/components/relevancy-audit/gate-fail-rate-tile.tsx` | Profile × gate matrix | Same |
| `<RelevancyAgreementTile>` | `src/components/relevancy-audit/agreement-tile.tsx` | Classifier-vs-agent agreement gauge | Same |
| `<RelevancyOverrideRateTile>` | `src/components/relevancy-audit/override-rate-tile.tsx` | Override % | Same |
| `<RelevancyLatencyTile>` | `src/components/relevancy-audit/latency-tile.tsx` | p95 by mode | Same |
| `<RelevancyCostTile>` | `src/components/relevancy-audit/cost-tile.tsx` | This-month spend; reads `relevancy_scores.input_tokens + output_tokens` | Same |
| `<RelevancySnapshotFreshnessTile>` | `src/components/relevancy-audit/snapshot-freshness-tile.tsx` | Per-profile snapshot age + stale-warn count | Same |
| `<RelevancySettingsHistoryTimeline>` | `src/components/relevancy-audit/settings-history-timeline.tsx` | Vertical timeline of `activity_log` rows where `entity_type IN ('system_setting','profile') AND action LIKE 'classifier%'` | Same |
| `<RelevancyThresholdFlippedTile>` | `src/components/relevancy-audit/threshold-flipped-tile.tsx` | % of last-week proceeds flipped by threshold + trend sparkline | Same |
| `<RelevancyDlqTile>` | `src/components/relevancy-audit/dlq-tile.tsx` | DLQ depth + last-drain timestamp | Same |

#### 10.8.2 Existing components to EDIT

| Component | File path | Edit |
|---|---|---|
| `<TaskCard>` | `src/components/tasks/task-card.tsx` | Mount `<RelevancyBadge>` at the top of the card body when `custom_fields._relevancy_score_id` is present |
| `<TaskDetailModal>` | `src/components/tasks/task-detail-modal.tsx` | Mount `<RelevancyDetailSection>` in a new collapsible "Relevancy" section near the top |
| `<BoardColumn>` | `src/components/tasks/board-column.tsx` | No edit needed (cards self-render) — but verify the column-name change `Proposal Submitted → Todo` in n8n's Format Task doesn't break this component's expected column labels |
| Settings page | `src/app/(dashboard)/settings/page.tsx` | Mount `<RelevancyClassifierCard>` below the existing Profile Snapshots section |
| Tasks list | wherever the list view lives (per existing repo conv. — `src/app/(dashboard)/tasks/list/*` or similar) | Mount inline `<RelevancyBadge>` in each row |
| Search results | likely `src/components/search/search-results.tsx` | Mount inline `<RelevancyBadge>` per task hit |

The Settings page is currently `src/app/(dashboard)/settings/page.tsx`. The new Relevancy Classifier card slots in as a new sibling section below "Profile Snapshots" — same `<Card>` shell pattern.

#### 10.8.3 Form-state library + mutation pattern

CLAUDE.md convention is **server actions for mutations** with `revalidatePath`. v3.3 follows that:

- All Settings UI mutations call server actions exported from `src/lib/actions.ts` (e.g. `setRelevancyMode(formData)`).
- The PATCH HTTP routes listed in §10.6.5 exist for **n8n-callable parity** (so a future operator-CLI or n8n auto-tuner could hit them) but the UI never uses them directly.
- Forms use `useFormState` + `useFormStatus` (React 19 native) for pending state. No `react-hook-form` for these simple forms (1–3 inputs each).

#### 10.8.4 shadcn / Tailwind primitives needed

`Card`, `CardHeader`, `CardTitle`, `CardContent` (existing) · `RadioGroup`, `RadioGroupItem` (NEW if not yet imported) · `Switch` (existing) · `Input` (existing) · `Label` (existing) · `Tooltip` (existing) · `AlertDialog`, `AlertDialogContent`, `AlertDialogTrigger`, etc. (existing) · `Table`, `TableHeader`, `TableRow`, `TableCell` (existing) · `Skeleton` (existing) · `Badge` (existing — reused by `<RelevancyBadge>`).

Recharts (already a dependency) for `<ThresholdPreviewChart>` and the audit page tiles.

#### 10.8.5 Role visibility

| Surface | Admin sees | Agent sees |
|---|---|---|
| Settings → Relevancy Classifier card | Full controls | Hidden — admin-only route gate |
| Task Card kanban badge | Full (score + decision + reasons label) | **Same as admin** — agents need the score to triage their Todo queue |
| Task Detail modal Relevancy section | Full (gates + rubric + proposal angles + cost metadata) | Truncated — gates + rubric + proposal angles visible; cost/tokens/model metadata HIDDEN (agents don't need to see infra cost) |
| Relevancy Evaluator page | Yes | No — admin-only route |
| Relevancy Audit page | Yes | No — admin-only route |

Agent visibility on the badge is **decided** (per Appendix A Q10): yes, agents see the badge with score + decision + reasons. The data is already in `custom_fields` on the card they own; hiding it would force them to triage blind.

#### 10.8.6 Zod schemas

Co-located in `src/lib/relevancy/schemas.ts`:

```ts
export const RelevancyModePatchSchema = z.object({
  mode: z.enum(['shadow', 'active']),
});

export const MinScorePatchSchema = z.object({
  value: z.number().int().min(0).max(100),
});

export const ProfileClassifierConfigPatchSchema = z.object({
  classifier_enabled:  z.boolean().optional(),
  min_score_override:  z.number().int().min(0).max(100).nullable().optional(),
});

export const TaskCardUrlSchema = z.object({
  task_card_url: z.string().url().max(2048).regex(/^https?:\/\/[^/]+\/(tasks|my-tasks)\?task=[0-9a-f-]{36}$/).optional(),
  task_id:       z.string().uuid().optional(),
  profile_id:    z.string().min(1),
}).refine(d => d.task_card_url || d.task_id, { message: 'one of task_card_url or task_id is required' });
```

Same schemas are imported on the client (for form-level validation) and on the server-action / API-route handlers (authoritative).

### 10.9 Backend implementation catalog (v3.3)

This subsection names every server action, every data-layer function, every TypeScript interface, every API response shape, every middleware module. It's the "what files do I create / touch?" checklist for the backend engineer.

#### 10.9.1 Server actions (`src/lib/actions.ts`)

| Function | Body | Revalidates |
|---|---|---|
| `setRelevancyMode(mode: 'shadow' \| 'active'): Promise<{ ok: boolean }>` | Auth (admin) + Zod + `UPDATE system_settings SET value=... WHERE key='relevancy.classifier_mode'` + activity_log INSERT | `revalidateTag('system-settings')` |
| `setMinScore(value: number): Promise<{ ok: boolean }>` | Same pattern for `relevancy.min_score` | `revalidateTag('system-settings')` |
| `setProfileClassifierConfig(profileId: string, patch: { classifier_enabled?, min_score_override? }): Promise<{ ok: boolean }>` | Auth + Zod + `UPDATE profiles SET ... WHERE profile_id=$1` + activity_log INSERT | `revalidateTag('profile-context-<id>')` |

Server actions are the authoritative write path. The PATCH routes in §10.6.5 are thin wrappers that call these same functions, so an external caller (n8n auto-tuner, a CLI) can also write — but the dashboard UI always uses the server action directly.

#### 10.9.2 Data-layer query functions (`src/lib/data.ts`)

| Function | Returns | Used by |
|---|---|---|
| `getSystemSetting(key: string): Promise<JSONB \| null>` | The raw value | All readers |
| `getSystemSettings(): Promise<{ classifier_mode, min_score, updated_by, updated_at }>` | Composite shape for the Settings page | `<RelevancyClassifierCard>` server-loader |
| `getProfileClassifierConfig(profileId: string): Promise<{ classifier_enabled: boolean, min_score_override: number \| null }>` | Per-profile config | `<RelevancyProfileRow>` |
| `getEffectiveClassifierMode(profileId: string): Promise<'shadow' \| 'active'>` | Computed effective mode | `getProfileContext` (NEW) |
| `getEffectiveMinScore(profileId: string): Promise<number>` | Computed effective min score | Same |
| `getProfileContext(profileId: string): Promise<ProfileContext>` | Full §5.4 response INCLUDING `_system` block | `/api/profiles/:id/context` route handler |
| `getThresholdPreview(windowDays: number, candidateMin: number): Promise<{ proceeds_in_window, would_flip, percentage, sample_window_days }>` | Live distribution for slider previews | `/api/admin/system-settings/threshold-preview` |
| `getRelevancyDecisionDistribution(rangeStart: Date, rangeEnd: Date, opts?: { profileId?, mode? }): Promise<{ proceed, reject, review, threshold_flipped }>` | Audit page tile | `<RelevancyDecisionDistributionTile>` |
| `getGateFailRateByProfile(rangeStart, rangeEnd): Promise<Array<{ profileId, gateId, count }>>` | Audit page matrix | `<RelevancyGateFailRateTile>` |
| `getClassifierAgentAgreement(rangeStart, rangeEnd): Promise<{ agreement_rate, sample_size }>` | Audit page | `<RelevancyAgreementTile>` |
| `getOverrideRate(rangeStart, rangeEnd, opts?: { source? }): Promise<{ rate, total, overrides }>` | Audit page | `<RelevancyOverrideRateTile>` |
| `getLatencyP95(rangeStart, rangeEnd): Promise<Record<'A_full' \| 'B_edge', number>>` | Audit page | `<RelevancyLatencyTile>` |
| `getCostThisMonth(): Promise<{ input_tokens, output_tokens, dollars }>` | Audit page | `<RelevancyCostTile>` |
| `getSnapshotFreshnessTable(): Promise<Array<{ profileId, last_extracted_at, snapshots_count, age_days }>>` | Audit page | `<RelevancySnapshotFreshnessTile>` |
| `getSettingsHistory(rangeStart, rangeEnd): Promise<Array<ActivityLogRow>>` | Audit page timeline | `<RelevancySettingsHistoryTimeline>` |
| `getThresholdFlippedRate(rangeStart, rangeEnd): Promise<{ rate, total, flipped }>` | Audit page | `<RelevancyThresholdFlippedTile>` |
| `getDlqDepth(): Promise<{ pending, last_drain_at }>` | Audit page | `<RelevancyDlqTile>` |
| `getRelevancyScoreById(id: number): Promise<RelevancyScoreRow \| null>` | Read full score row by id | `<RelevancyDetailSection>` |
| `getJobPayload(taskId: string): Promise<JobPayload>` | §6.2 canonical job JSON | `/api/tasks/:id/job-payload` route |
| `insertRelevancyScore(row: RelevancyScoreInsert): Promise<{ id: number }>` | Audit-log writer | `/api/relevancy-scores` route |
| `insertRelevancyScoreDlq(payload: JSONB, error: string): Promise<{ id: number }>` | DLQ writer | Same route, `?dlq=1` |
| `drainRelevancyScoresDlq(maxAttempts: number): Promise<{ retried, succeeded, failed }>` | DLQ retry loop | `/api/cron/relevancy-dlq-drain` |

All functions use raw SQL with the `sql` tagged template from `@vercel/postgres` per CLAUDE.md convention.

#### 10.9.3 TypeScript interfaces (`src/lib/types.ts`)

```ts
export type ClassifierMode = 'shadow' | 'active';
export type EffectiveDecision = 'proceed' | 'reject' | 'review';
export type RawDecision = 'proceed' | 'reject' | 'review';

export interface SystemSetting<T = unknown> {
  key:         string;
  value:       T;
  description: string | null;
  updated_by:  string | null;
  updated_at:  string; // ISO
}

export interface ProfileClassifierConfig {
  classifier_enabled:  boolean;
  min_score_override:  number | null;
}

export interface ProfileContextSystemBlock {
  classifier_mode:      ClassifierMode;
  effective_min_score:  number;
  global_mode:          ClassifierMode;
  profile_enabled:      boolean;
  profile_min_override: number | null;
}

export interface ProfileContext {
  profile:              ProfileContextProfile;            // §5.4
  thresholds_overrides: ProfileThresholdsOverrides;
  _system:              ProfileContextSystemBlock;
  criteria_version:     string;
  context_generated_at: string;
}

export interface RelevancyVerdict {
  decision:                    RawDecision;
  effective_decision:          EffectiveDecision;
  threshold_flipped:           boolean;
  min_score_at_decision:       number | null;
  classifier_mode_at_decision: ClassifierMode;
  total_score:                 number | null;
  tier:                        string | null;
  confidence:                  number | null;
  confidence_warnings:         string[];
  rejection_reasons:           string[];
  gates_passed:                number[];
  gates_failed:                number[];
  gates_evidence:              Record<string, unknown>;
  components:                  Record<string, unknown>;
  proposal_angles:             string[];
  summary:                     string | null;
  missing_signals:             string[];
  evidence_panel:              Record<string, unknown> | null;
  request_meta:                RelevancyRequestMeta;
}

export interface RelevancyScoreRow extends RelevancyVerdict {
  id:                 number;
  task_id:            string | null;
  job_external_id:    string | null;
  profile_id:         string;
  snapshot_id:        string | null;
  thresholds_used:    Record<string, unknown>;
  model:              string;
  prompt_version:     string;
  prompt_mode:        'A_full' | 'B_edge';
  criteria_version:   string;
  evaluation_path:    'deterministic' | 'llm' | 'llm_after_deterministic' | 'manual_url' | 'shadow';
  request_id:         string | null;
  source:             'auto' | 'manual_url';
  requested_by:       string | null;
  input_tokens:       number | null;
  output_tokens:      number | null;
  latency_ms:         number | null;
  evaluated_at:       string;
}

export interface TaskCardRelevancyFields {
  _relevancy_score:             number | null;
  _relevancy_decision:          RawDecision;
  _relevancy_effective:         EffectiveDecision;
  _relevancy_threshold_flipped: boolean;
  _relevancy_reasons:           string[];
  _relevancy_tier:              string | null;
  _relevancy_confidence:        number | null;
  _relevancy_score_id:          number;
  _relevancy_evaluated_at:      string;
  _relevancy_mode_at_decision:  ClassifierMode;
}

export interface ThresholdPreviewResponse {
  proceeds_in_window:  number;
  would_flip:          number;
  percentage:          number;
  sample_window_days:  number; // always 7 in v3.3
}
```

#### 10.9.4 API response schemas + error codes

All admin routes share the auth-failure pattern: 401 (no session) / 403 (session but not admin).

| Endpoint | Success response | Error codes |
|---|---|---|
| `GET /api/admin/system-settings` | `{ classifier_mode: ClassifierMode, min_score: number, updated_by: string \| null, updated_at: string }` | 401, 403, 500 |
| `PATCH /api/admin/system-settings/relevancy-mode` | `{ ok: true, mode: ClassifierMode, activity_log_id: number }` | 400 (Zod), 401, 403, 409 (concurrent flip — see §16.4 I9), 500 |
| `PATCH /api/admin/system-settings/min-score` | `{ ok: true, value: number, activity_log_id: number }` | 400, 401, 403, 500 |
| `PATCH /api/profiles/:id/classifier-config` | `{ ok: true, effective_mode: ClassifierMode, effective_min_score: number, activity_log_id: number }` | 400, 401, 403, 404 (profile not found), 500 |
| `GET /api/admin/system-settings/threshold-preview?value=N` | `ThresholdPreviewResponse` | 400 (value out of range), 401, 403, 500 |
| `GET /api/profiles/:id/context` | `ProfileContext` (§5.4) | 401, 403 (non-owner agent), 404 (profile), 422 (`profile_snapshot_missing`), 500 |
| `GET /api/tasks/:id/job-payload` | `JobPayload` (§6.2) | 401, 403, 404, 500 |
| `POST /api/relevancy/evaluate-task` | `RelevancyVerdict` | 400, 401, 403, 422 (`task_not_found` \| `profile_snapshot_missing`), 429 (rate limit), 502 (n8n unreachable), 504 (timeout), 500 |
| `POST /api/relevancy-scores` | `{ ok: true, id: number }` | 400, 401 (Bearer), 409 (idempotency-key replay returns the prior body verbatim), 500 |
| `POST /api/relevancy-scores?dlq=1` | `{ ok: true, dlq_id: number }` | Same |
| `GET /api/relevancy-scores/accuracy?range=7d&profileId=X` | `{ agreement_rate, sample_size, by_decision: {...} }` | 401, 403, 500 |
| `POST /api/cron/relevancy-dlq-drain` | `{ retried: number, succeeded: number, failed: number }` | 401 (no CRON_SECRET Bearer), 500 |

Every endpoint logs (via pino — §16.5 L1): `request_id`, `route`, `method`, `user_id`, `latency_ms`, `outcome` ('ok' \| 'client_error' \| 'server_error'), plus any route-specific structured fields (e.g. `decision`, `profile_id`).

#### 10.9.5 Middleware modules

| Module | File path | Behavior |
|---|---|---|
| HMAC verifier | `src/lib/middleware/hmac.ts` | `verifyHmac(req, secret): { ok: boolean, error?: string }` — validates `X-Signature` + `X-Timestamp` + 5-min replay window. Used on `POST /api/webhook/n8n` and all n8n-callable callbacks. |
| Idempotency | `src/lib/middleware/idempotency.ts` | `withIdempotency(handler, opts: { ttl: 24h })` — wraps any POST. Reads `X-Idempotency-Key`; caches `(key, response, status)` in-memory LRU (1k entries) AND in `idempotency_keys` Postgres table (24h TTL). Replay returns the cached response. |
| Rate limit | `src/lib/middleware/rate-limit.ts` | `withRateLimit(handler, { window: '1h', max: 60, key: req => req.session.user.id })`. Backend selected by `RATE_LIMIT_BACKEND` env (Postgres default). |
| HMAC + idempotency composer | `src/lib/middleware/n8n-callback.ts` | Composes HMAC + idempotency for the n8n callback endpoints. Single import per route. |

`idempotency_keys` table is added to migration 018 (see below).

#### 10.9.6 Additional migration 018 objects

```sql
-- Idempotency cache (24h TTL, pruned by cron).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
```

This makes the §10.9 backend catalog the canonical implementation reference. Anything not in §10.9.1–6 is either pre-existing (CLAUDE.md `src/lib/...`) or out of scope.

---

## 11. Performance + Cost Considerations

### 11.1 Cost summary

| Service | Driver | Monthly cost @ baseline (40 jobs/day, 8 profiles) |
|---|---|---|
| Gemini Flash 2.5 (auto pipeline — scoring) | ~780 LLM calls/month (60% × 1300 jobs) | ~$5.60 |
| Gemini Flash 2.5 (manual evals) | 300 calls/month, full Mode A | ~$2.40 |
| Anthropic (proposal writer — Shadow mode) | 1300 jobs × $0.02 = $26/mo (parity with today) | ~$26 |
| Anthropic (proposal writer — Active, min=50) | ~50% of 1300 jobs skip → $13/mo saved → ~$13 spent | ~$13 |
| Postgres (Contabo) | Existing infra | $0 incremental |
| n8n cloud | Existing | $0 incremental |
| **Total monthly (Shadow)** | Anthropic spend unchanged | **~$34** (was ~$31 pre-classifier) |
| **Total monthly (Active, min=50)** | Anthropic cut roughly in half | **~$21** (savings ≈$13/mo) |

The classifier itself is cheap (~$8/mo Gemini); the cost story is **what it saves on Anthropic** once Active mode is on. Shadow mode is intentionally cost-neutral plus a small Gemini overhead — the price you pay for calibration data.

Scales linearly with traffic. At 400 jobs/day (10× baseline) → Shadow ~$340/mo, Active ~$210/mo, Anthropic savings ~$130/mo. The cost of running Active vs Shadow grows with traffic; calibrating sooner pays back faster.

Compared to v3.1 (~$14–20/mo with Apify, classifier only), v3.3 + active mode is **net cost-positive** when you include Anthropic savings. The savings free up budget for higher-tier Gemini models (e.g. Gemini 2.5 Pro for the manual evaluator) if calibration data shows accuracy gaps.

### 11.2 Latency budget (v3.3 fresh, no cache)

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
| Next.js `unstable_cache` | `/api/profiles/:id/context` response (includes `_system` block) | 5 min, tagged `profile-context-<id>` AND `system-settings` | `revalidateTag('profile-context-<id>')` on `saveUpworkProfileSnapshotAction` + per-profile config change; `revalidateTag('system-settings')` on any `system_settings` mutation (busts ALL profile-context entries simultaneously) |
| Next.js `unstable_cache` | `/api/admin/system-settings` response | 60s, tagged `system-settings` | `revalidateTag('system-settings')` on any mutation through `setRelevancyMode` / `setMinScore` server actions |
| Next.js `unstable_cache` | `/api/tasks/:id/job-payload` response | 30 sec | `revalidateTag` on `moveTaskAction` (column change can flip card status) |
| n8n static data | Profile context fallback | 1 hour | None (TTL only) — accepts a short stale-window if dashboard is unavailable |
| Gemini implicit cache | System instruction (Mode A & B separately) | Provider-managed | None |
| Postgres query cache | `relevancy_scores` aggregates for audit page | 60s | None (read-only analytics) |

**Two-tag invalidation pattern** — A per-profile config change busts `profile-context-<id>` only; a global system-settings change busts both `system-settings` and (via the dual-tag wrap on `getProfileContext`) every profile-context entry at once. This means a global flip propagates to n8n within ~60s without per-profile fan-out logic.

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
- **Rollback** — `018_rollback.sql` drops all six new tables (`system_settings` + the v3.2 five) and removes three `profiles` columns (`thresholds_overrides`, `classifier_enabled`, `min_score_override`). Safe BEFORE any score is written; loses calibration + operator-state data after.
- **Pre-deploy snapshot** — `pg_dump` the affected schemas (mostly empty pre-migration) to a timestamped file in `/var/backups/postgres/` on Contabo before applying. Migration 017 is already shipped — do NOT re-run or re-snapshot it.

### 13.5 Shadow-mode rollout (Phase 12 expansion)

v3.3 replaces v3.2's env-var-only shadow toggle with a DB-backed Settings UI. The `Route Verdict` switch (§4.2) keys off `request_meta.classifier_mode` returned by `_relevancy-classifier-core` — that field is computed in C1 from `system_settings.relevancy.classifier_mode` × `profiles.classifier_enabled` (see §1.4 precedence rules). No n8n redeploy is needed to flip between Shadow and Active.

Operationalized:

1. **Initial deploy.** Migration 018 seeds `system_settings.relevancy.classifier_mode = 'shadow'`. All profiles ship with `classifier_enabled = TRUE` and `min_score_override = NULL`. Phase 7 splices `Score Relevancy + Route Verdict + End` into `EWnZg3svZWwcIRs4`. Because global is Shadow, every job lands in Todo branch 4 of the matrix — same end-state as today (Anthropic call + card creation) except cards now land in `Todo` instead of `Proposal Submitted` and carry the relevancy badge.

2. **Shadow phase (1 week).** `relevancy_scores` accumulates rows with `classifier_mode_at_decision = 'shadow'`. The badge on every Todo card lets agents see what the AI thinks WITHOUT being forced by it. Daily metric: classifier-says-reject vs agent-moves-to-N/A agreement (target ≥85% on Day 7).

3. **Calibration review.** Waqas tunes `system_settings.relevancy.min_score` from `/settings` based on the audit page's "threshold preview" — e.g. tightens 50 → 60 if too many noisy proceeds slip through, loosens 50 → 40 if good leads are being flagged below threshold. Per-profile overrides absorb agent-specific drift.

4. **Active flip.** Admin navigates to `/settings` → Relevancy Classifier → Global mode toggle → Active → confirm modal. Within ~60s (cache TTL), n8n routing picks up the change. The `Route Verdict` switch now sends rejects + below-threshold proceeds to `End (Audit Only)` instead of the proposal-writer chain.

5. **Per-profile gating.** If only some profiles are calibrated enough to go Active (e.g. Khansa's data looks good, Sana needs more time), the admin can flip global to Active and individually toggle `classifier_enabled = false` on the unready profiles. Those profiles continue to behave like shadow until their toggle is flipped on. No redeploy. No n8n edit.

6. **Emergency kill-switch.** Env var `RELEVANCY_CLASSIFIER_ENABLED=false` (n8n environment) is the lower-level lever. It bypasses the `Score Relevancy` node entirely (the kill-switch `IF` in §4.2 routes around it), reverting to v2-pre-classifier behavior in <30s. Used only for "Gemini is broken" / "classifier is producing garbage" / "deploy is wedged" — NOT routine operation. Settings toggles handle everything else.

Two levers, distinct purposes:

| Lever | Where | Latency | Granularity | When to use |
|---|---|---|---|---|
| **Settings toggle** | `/settings` UI (DB-backed) | ~60s (cache TTL) | Global mode + per-profile + min score | Routine ops, calibration, go-live, per-profile rollout |
| **Kill-switch env** | n8n environment | <30s (immediate at next execution) | All-or-nothing | Emergency stop |

#### Why a DB toggle instead of pure env var

v3.2's design used the env var as the only lever. That was fine for binary go-live, but operationally awkward for:

- **Per-profile gating** — env var is global; one bad profile would force everyone back to shadow.
- **Audit trail** — env-var changes don't write to `activity_log` (no `actor_id`, no "old → new").
- **Live preview** — UI can show "at this threshold, X jobs would have been flipped" before saving; env vars can't preview.
- **Min-score tuning** — making `min_score` env-var-backed would mean redeploys for every calibration tweak. UI-backed lets the admin nudge the number freely.

v3.3 keeps the env var as the panic button and moves routine operation into the UI. Best-of-both.

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

v3.3 needs FEWER secrets than v3.1 (no Apify, no profile-ingest/sync workflows). v3.3 adds nothing beyond v3.2's secret list.

| Secret | Provider | Where it lives | Used by |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | n8n credentials | `_relevancy-classifier-core` C5 (langchain.agent) |
| `RELEVANCY_MANUAL_EVAL_TOKEN` | Generated (32-byte random) | n8n Header Auth credential + dashboard env (`process.env.RELEVANCY_MANUAL_EVAL_TOKEN`) | Webhook auth on `job-evaluate-manual` J1 |
| `CRITERIA_PRD_VERSION` | Hardcoded `0.2` | n8n env | Embedded in classifier prompt; mirrors `criteria_versions.version` |
| `RELEVANCY_CLASSIFIER_ENABLED` | Boolean (`'true'` \| `'false'`) | n8n env | Kill-switch read by K1 IF (§4.4.1, §13.5). Defaults to `'true'` when unset. |
| `GEMINI_DAILY_TOKEN_CAP` | Integer (default `1000000`) | Dashboard env | Cost guard alert threshold |
| `RATE_LIMIT_BACKEND` | `postgres` \| `upstash` (default `postgres`) | Dashboard env | Manual evaluator + threshold-preview rate limiting |
| `SNAPSHOT_STALE_DAYS_WARN` | Integer (default `30`) | Dashboard env | Audit page snapshot freshness threshold |
| `SNAPSHOT_STALE_DAYS_BLOCK` | Integer (unset by default = no blocking) | Dashboard env | Set non-zero to refuse scoring on stale snapshots |
| `CRON_SECRET` | Existing | Dashboard + GH Actions secrets | Bearer for `/api/cron/relevancy-dlq-drain` (Appendix C) — reused from existing `/api/migrate` route |
| `N8N_API_KEY` | n8n cloud | Dashboard env (already present) | n8n MCP / partial-update operations |
| `N8N_API_URL` | `https://ikonicdev.app.n8n.cloud/api/v1` | Dashboard env (already present) | Same |
| `n8n-board-sync` Bearer | Existing | n8n credential (already present) | n8n → Next.js callbacks (C1, C10, C11, J3) |
| `N8N_WEBHOOK_SECRET` | Existing | Dashboard env (already present) | HMAC signing on n8n → /api/webhook/n8n callbacks |
| (Optional) `SLACK_ALERT_WEBHOOK` | Slack | Dashboard env | Relevancy + DLQ + stale-snapshot + v3.3 mode-flip alerts |
| (Optional) `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash | Dashboard env | Only needed if `RATE_LIMIT_BACKEND=upstash` |

Net new secrets to provision for v3.3: **2** (`GEMINI_API_KEY`, `RELEVANCY_MANUAL_EVAL_TOKEN`). Everything else is either already present or has a sensible default.

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
- **Cost ceilings** — explicit Gemini monthly cap from Waqas (default: free-tier ~$20/mo soft limit). Anthropic spend is governed by today's existing budget — v3.3 reduces it via Active-mode skipping (§11.1).

### 15.6 Things that are NOT required from the user

For clarity on scope:

- **No Apify account, no Apify API token, no Upwork scraping infra.** v3.2's profile data comes from the existing `upwork_profile_snapshots` table (admin-uploaded JSON). v3.2's job data comes from existing `tasks.custom_fields` (Vollna-driven, already populated). Neither requires any external service.
- **No `apify/upwork-public-profile-scraper` or `epctex/upwork-scraper` evaluation.** No actor selection spike. No actor-output schema validation.
- ClickUp credentials — ClickUp is fully decommissioned (see CLAUDE.md). Do not request.
- New Vercel env vars — Vercel is decommissioned.
- New Postgres database — uses existing Contabo Postgres.
- Custom n8n hosting — uses existing n8n cloud.
- New domain or SSL — Contabo over HTTP; HTTPS is post-domain (CLAUDE.md).
- **No new admin UI for profile management.** The existing Settings → profile table + `<ProfileUpworkSnapshotSheet>` drawer covers all profile CRUD and snapshot upload. v3.3 only adds two new pages (`/relevancy-evaluator`, `/relevancy-audit`) and one new card on the existing `/settings` page.

### 15.7 Documentation updates required (post-deploy)

Each phase below mandates specific edits to repo-checked-in docs. The plan blocks at Phase 17 (post-launch review) until all checkboxes are ticked.

#### CLAUDE.md edits (after Phase 1 migration + after Phase 14 active rollout)

- [ ] **"Database Tables"** section — add `system_settings`, `criteria_versions`, `relevancy_scores`, `relevancy_scores_dlq`, `manual_job_evaluations`, `relevancy_overrides`, `idempotency_keys`.
- [ ] **"Migration Version History"** table — add row for migration 018 with full description (v3.3 surface: operator controls + relevancy scoring tables).
- [ ] **"n8n Integration Gotchas (CRITICAL)"** — add three new gotchas:
  - "Auto-created cards land in `Todo`, NOT `Proposal Submitted`. Proposal Submitted is human-only (signals the proposal IS live on Upwork). Format ClickUp Task hardcodes `column: 'Todo'` as of v3.3."
  - "The K1 IF before Score Relevancy reads `$env.RELEVANCY_CLASSIFIER_ENABLED`. Default `'true'`. Toggling to `'false'` reverts to v2 behavior — emergency only."
  - "Routine shadow/active control is via the Settings UI (DB-backed `system_settings.relevancy.classifier_mode`), NOT the env var. The env var is the panic button."
- [ ] **"API Conventions"** / Task Management API table — add all v3.3 routes from §10.6.5 + §10.9.4.
- [ ] **"Known Patterns & Gotchas"** — add bullet: "Relevancy classifier mode toggle: per CLAUDE.md `feedback_audit_records_admin_only_delete.md` pattern, classifier-mode + min-score writes are admin-only; per-profile config writes are admin-only too (agents have no UI for these even on profiles they own)."
- [ ] Routes table — add `/relevancy-evaluator`, `/relevancy-audit`.

#### `docs/n8n_workflow_prd.md` edits (after Phase 7 splice + after Phase 6 sub-workflow)

- [ ] § "Nodes" — add K1-K4 + C1-C11 with type, typeVersion, position, purpose (one line each), per §4.4.
- [ ] § "Changelog" — record the v3.3 splice with a dated entry referencing this plan.
- [ ] Sticky-note text from §4.4.5 mirrored in the PRD prose so canvas + doc stay in sync.

#### Memory file updates (after Phase 14)

Per CLAUDE.md memory conventions, the n8n-keeper agent writes:

- [ ] Update `memory/n8n_multiple_webhooks_workflow.md` — record the K1-K4 topology + Format Task column edit.
- [ ] Update `memory/relevancy_classifier_status.md` — flip from "not yet wired" to "live in `classifier_mode_at_decision = <whatever was set at Phase 14>`."
- [ ] Create `memory/relevancy_settings_toggle.md` — operator note: where the toggle lives, what it does, who can edit it.

#### Working-flow JSON snapshot (after 7-day soak per §13.1)

- [ ] Promote `docs/multiple-webhooks-<post-soak-date>-stable.json` to the new canonical baseline.
- [ ] Update CLAUDE.md "Stable n8n backup" pointer.
- [ ] Archive the previous `(07-05-2026 working).json` baseline.

---

## 16. Identified Gaps & Production-Readiness Recommendations

This section catalogs gaps in v3.3 and provides actionable recommendations. Every recommendation is non-breaking for existing functionality. Apify-related items from v3.1 are removed.

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
| L5 | No Slack alert pipeline | **DEFERRED in v3.3 per user decision.** The Slack client at `src/lib/alerts.ts` is NOT wired for v3.3 relevancy events. All alerting surfaces are in-dashboard only: red/yellow banners on `/relevancy-audit` for DLQ backlog, stale snapshots, Gemini error spikes, manual-eval failure bursts, threshold-flip rate anomalies, and override-rate spikes. Revisit when calibration data shows in-dashboard banners are missed too often. If revived later, alert types would be: `RELEVANCY_OVERRIDE_RATE_HIGH`, `STALE_SNAPSHOTS`, `GEMINI_QUOTA_NEAR`, `RELEVANCY_DLQ_BACKLOG`, `MANUAL_EVAL_FAILURE_BURST` — plus v3.3-specific `RELEVANCY_MODE_FLIPPED`, `MIN_SCORE_CHANGED`, `BELOW_THRESHOLD_RATE_HIGH`, `KILL_SWITCH_ACTIVATED`, `PER_PROFILE_CLASSIFIER_DISABLED`. None of these are required for execution-readiness. |
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

**Settings → Relevancy Classifier card (`/settings`)** — v3.3

| State | Trigger | UI |
|---|---|---|
| Idle — Shadow | `system_settings.relevancy.classifier_mode = 'shadow'` | Global radio = Shadow selected; min-score input still editable but visually de-emphasized with tooltip "Only applies when Active"; per-profile table rows all greyed out with `aria-disabled="true"` + tooltip "Enable global classifier first" |
| Idle — Active | `…= 'active'` | Global radio = Active; min-score input + threshold-preview live; per-profile table rows interactive |
| Loading initial settings | First mount, `getSystemSettings()` pending | Card skeleton (gray bars where toggle / min-score input / table will be) |
| Threshold-preview loading | Min-score input focused, debounced 300ms | Inline "Calculating…" + small spinner; chart renders when API responds |
| Threshold-preview error | `/api/admin/system-settings/threshold-preview` non-200 | Inline: "Preview unavailable. Save to apply anyway." (does not block save) |
| Saving | `setRelevancyMode` / `setMinScore` / `setProfileClassifierConfig` pending | Disable the changed control, show inline spinner; other controls remain interactive |
| Save success | 200 from server action | Brief toast "Saved." + "Last changed" line updates optimistically; tag-invalidation runs in background |
| Save failure | 5xx or network error | Toast "Save failed — retry?" + the form value reverts (optimistic rollback) + prior "Last changed" line restored |
| Concurrent edit (409 from server) | Another admin modified the same key between load and save | Toast "Someone else just changed this. Latest value is X. Save your version anyway?" with [Overwrite] / [Discard mine] choices |
| Confirm modal — hard flip | Shadow → Active or Active → Shadow | AlertDialog with: title, preview "X of last 24h proceeds would be flipped to reject" or "X proceeds will now be auto-rejected" / "X cards will start landing in Todo instead of being auto-rejected", Cancel + Confirm buttons; focus trap; Esc closes |
| Confirm modal — soft (min-score drift > ±20) | Saving min_score where `\|new − old\| > 20` | Lighter modal with the drift number + Continue / Cancel |
| Per-profile toggle change | Click `<Switch>` on a row | Optimistic flip + spinner on that row only; rollback on failure |
| Per-profile min override change | Edit number in row, blur | Same pattern; empty input → null (= inherit global), shown as "(using global)" placeholder |
| Per-profile row when global=Shadow | global classifier_mode=`shadow` | Row visually disabled; toggle + min input have `aria-disabled="true"`; click has no effect; tooltip explains why |
| Empty profile table | Zero rows in `profiles` (unlikely) | Empty state: "No profiles defined yet. Create a profile in Settings → Profiles first." |

**Task card relevancy badge (kanban / list / search / detail modal)** — v3.3

| State | Trigger | UI |
|---|---|---|
| Present, decision = proceed | `_relevancy_effective='proceed'` | 🟢 green badge: `Score: N · AI proceed` + optional reasons line |
| Present, decision = review | `_relevancy_effective='review'` | 🟡 yellow badge: `Score: N · AI review` |
| Present, decision = reject (Shadow mode only) | `_relevancy_effective='reject'` AND `_relevancy_mode_at_decision='shadow'` | 🔴 red badge: `AI reject` + reasons list |
| Threshold-flipped | `_relevancy_threshold_flipped=true` | Add small "⚠ Below threshold (N)" sub-label under main badge |
| Missing relevancy fields | `_relevancy_score_id` absent on card | **Render nothing** — manually-created cards silently omit the badge; do NOT show a placeholder |
| Detail modal — loading score row | `_relevancy_score_id` present, fetch pending | Skeleton in the Relevancy section; rest of modal renders |
| Detail modal — score row fetch failed | `/api/relevancy-scores/:id` returns 404/500 | Section shows "Failed to load classifier details — score may have been pruned" + retry button |
| Score row pruned (12-month retention) | row `id` no longer exists | Same as fetch-failed; the badge still renders from `custom_fields` (those don't expire) |

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

**P0 — must ship before active rollout (Phase 14):**

- §13.1 entire safe-update protocol
- §13.5 kill-switch
- §14 rollback procedure + JSON backup discipline
- §15 all execution requirements
- §15.7 documentation updates (CLAUDE.md, n8n_workflow_prd.md, memory files)
- S2, S3, S5, S6, S8 (security)
- V1, V2, V4, V8, V10, V11, V12 (validation)
- I1, I2, I5, I7, I8 (idempotency)
- A1, A2, A6, A7, A10 (AI quality)
- D7, D9 (consistency)
- L2, L7 (logging baselines)
- F2, F3, F6 (fallbacks)
- All §16.9 frontend states for the five primary screens (Settings snapshot drawer, Settings Relevancy Classifier card, Task Card Evaluator, Relevancy Audit, Task Card Badge)
- **v3.3 P0 additions:**
  - Settings UI CSRF protection on server actions (server actions inherit Next.js CSRF; explicit `getServerSession()` admin check at every action entry — re-cite S5)
  - Badge missing-data render = `null` for cards lacking `_relevancy_score_id` (V11-analog)
  - Threshold-preview rate limit (60/min/admin — prevents slider-drag DoS — re-cite R1)
  - Concurrent-flip 409 handling on Settings UI server actions (`updated_at` row-version check; UI shows merge-or-overwrite modal)
  - `Format ClickUp Task` column edit applied to ALL 8 webhook entry paths (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal) — verify in n8n exec replay
  - Appendix C DLQ retry worker live before Phase 14 (GitHub Actions cron registered)
  - Appendix D smoke-test fixture filled before Phase 11

**P1 — must ship within 30 days of active rollout:**

- S4, S7, S9, S10, S11
- V7, V9
- R1, R2, R4, R6
- I3, I6
- A3, A4, A5, A8, A9, A11
- D2, D4, D6
- L1, L3, L4, L6, L8, L9, L10, L11   *(L5 Slack alerting deferred — see §16.5 note)*
- E1–E20 (all edge cases) — at minimum documented if not coded
- F4, F5, F7
- **v3.3 P1 additions:**
  - Audit-page threshold-flipped tile + settings-history overlay
  - Per-profile min-override cross-profile threshold queries (if calibration shows the per-profile JSONB isn't enough — switch to a dedicated `profile_thresholds` table)
  - Bulk "re-evaluate all N/A from last 7 days" admin button on `/relevancy-audit` (for after a snapshot upload or threshold change)
  - Override-rate spike detection (statistical alert when `relevancy_overrides` rate jumps >2σ in a week — surface as a yellow banner on `/relevancy-audit`, NOT a Slack alert)

**P2 — quality of life within 90 days:**

- §16.10 (P1–P8 performance)
- Audit page deep-dives
- Bulk re-evaluation UI (§12.1 #1)

---

## Appendix A — Open Questions

Carried-over decisions BEFORE running migration 018 (defaults are baked into the plan; user may override):

1. **Snapshot freshness policy**: warn-only vs block-after-N-days. **Default: warn at 30 days, never block.** Admin owns refresh cadence. Setting `SNAPSHOT_STALE_DAYS_BLOCK` enables blocking; default unset.
2. **Profile-thresholds storage**: PRD §11 Q1. **Default: `profiles.thresholds_overrides JSONB`** (single column). If we need cross-profile threshold queries, switch to a dedicated `profile_thresholds` table in v3.x.
3. **Manual eval against `active=false` profiles**: should manual evals against inactive profiles be allowed? **Default: yes** (research utility). Block if security needs.
4. **Override capture**: when an agent moves a card classifier-said-proceed to N/A, do we surface a "Why did you override?" prompt? **Default: optional input box** (don't block the move).
5. **Skill taxonomy**: build now (curate ~500 slugs) vs defer? **Default: defer.** The snapshot's `skills_summary` ILIKE + JSONB containment is sufficient for the deterministic gate-1 path; calibration data after the shadow phase decides whether the small accuracy lift is worth seed-curation cost.
6. **Reason label typos** (PRD §9.2): migrate `"Low Higher rate"` → `"Low Hourly Rate"` BEFORE or AFTER classifier launch? **Recommendation: AFTER** — preserve label-equality with historical data through 2-week shadow mode, then run a single migration that rewrites both the enum AND existing rows.
7. **Profile mismatch warning**: when admin selects a different profile than the auto-pipeline used for that card, **default: yellow warning, no block** — admin is doing intentional research.
8. **Re-evaluation idempotency**: each click writes a new score, OR replaces the most-recent score for `(task_id, profile_id)`? **Default: append.** Each evaluation is its own row; audit page treats most-recent as canonical.
9. **Rate-limit backend**: Postgres-backed counter vs Upstash Redis? **Default: Postgres** (no extra service); switch to Upstash via `RATE_LIMIT_BACKEND=upstash` if Postgres-counter contention shows up.

### v3.3 additions

10. **Agent visibility on the relevancy badge**: does an agent looking at their Todo column see the full badge (score + decision + reasons), or just a colored dot? **v3.3 default: full badge.** Rationale: agents need the score to triage their Todo queue; hiding it would force them to triage blind. Detail-modal cost/model/token metadata IS admin-only. (Already implemented in §10.8.5.)
11. **Default `min_score`**: what value should ship in the migration 018 seed? **v3.3 default: `50`.** Rationale: midpoint of the rubric range; calibration adjusts up/down from there. Easy to tweak via Settings UI on Day 1 without redeploy.
12. **Slack alerting for v3.3 events**: send a Slack ping when the global mode flips Shadow→Active or vice versa? When `min_score` changes? When DLQ depth exceeds threshold? **v3.3 default: NO Slack alerts at all.** Per user decision: all alerting is in-dashboard banners on `/relevancy-audit`. (See §16.5 L5.) Revisit if calibration data shows banners are routinely missed.
13. **Cache invalidation scope on per-profile change**: when `profiles.classifier_enabled` or `min_score_override` changes on profile X, bust ONLY `profile-context-X`, or also bust other profile-context entries? **v3.3 default: scope to the changed profile only.** Per-profile config never affects other profiles' effective values. Global `system_settings` changes are the only ones that fan out (via `system-settings` tag).
14. **Settings concurrent-edit conflict resolution**: when two admins edit simultaneously, last-write-wins or 409? **v3.3 default: 409 with merge-or-overwrite modal.** `system_settings.updated_at` is checked as a row-version on every PATCH; mismatch returns 409. UI gives the user the choice to overwrite or discard their version. (Implementation in §10.9.4 error codes.)
15. **What happens to in-flight Vollna jobs when global flips mid-pipeline?** A job that entered `Score Relevancy` while mode was Shadow may finish while mode is Active. The verdict's `classifier_mode_at_decision` is fixed at C1 read-time (cached profile-context value), so each job's mode is internally consistent — but a 60-second window of "mixed mode" jobs is expected during a flip. **v3.3 default: accept the mixed-mode window** (~1 minute, ~5 jobs at baseline). Document in the audit-page tooltip on the Settings History timeline.
16. **Threshold preview window**: should the preview chart show last 7 days or be configurable? **v3.3 default: hardcoded 7 days.** Configurable adds UI complexity for marginal value; 7-day window aligns with the calibration cadence.
17. **Cron schedule for DLQ drain**: hourly (cron `7 * * * *`) vs every 15 minutes? **v3.3 default: hourly.** DLQ writes are rare (only on transient Postgres failures); aggressive draining wastes cycles. If DLQ depth grows post-launch, tighten to 15min in `.github/workflows/relevancy-dlq-drain.yml`.

---

## Appendix B — Build Order

v3.2 has fewer phases than v3.1 because the profile-ingest, profile-sync, scrape-proxy, and skills-taxonomy phases are gone.

| Phase | Scope | Owner | Effort | Done when |
|---|---|---|---|---|
| **0. PRD freeze + Execution Requirements** | Lock PRD v0.2; resolve Appendix A; Waqas provides §15 secrets (Gemini API key + MANUAL_EVAL_TOKEN) | Waqas + leads | 2h | Sign-off; all keys in n8n credentials |
| **0a. Pre-flight backup** | Snapshot current `EWnZg3svZWwcIRs4` to `docs/multiple webhooks (11-05-2026 working).json`; pg_dump pre-migration baseline | n8n-keeper | 30m | Backup file committed; pg_dump archived |
| **1. Migration 018** | `system_settings` + `profiles.classifier_enabled` + `profiles.min_score_override` + `profiles.thresholds_overrides` + `criteria_versions` + `relevancy_scores` (with v3.3 columns: `effective_decision`, `threshold_flipped`, `min_score_at_decision`, `classifier_mode_at_decision`) + `relevancy_scores_dlq` + `manual_job_evaluations` + `relevancy_overrides` + `018_rollback.sql` | Dashboard | 4h | Idempotent run on Contabo; rollback tested in dev; `system_settings` seeded with `shadow` + `50` |
| **2. `criteria_versions` v0.2 seed** | Insert one row mirroring `docs/job_relevancy_criteria_prd.md` v0.2 (thresholds, reason_enum, prompt_versions, output_schema) | Dashboard | 2h | Seed runs; classifier `criteria_version=0.2` resolves |
| **3. `/api/profiles/:id/context` endpoint** | Reads `upwork_profile_snapshots_current` view + `profiles.thresholds_overrides` + `profiles.classifier_enabled` + `profiles.min_score_override` + `system_settings`; computes `tech_stack_inferred[]` per portfolio item; returns `_system.classifier_mode` (effective) and `_system.effective_min_score` | Dashboard | 5h | Returns classifier-ready JSON for Shayan, Saim, Craig; effective-mode logic unit-tested for all 4 precedence cases |
| **4. `/api/tasks/:id/job-payload` endpoint** | Reads `tasks` row, projects `custom_fields` into canonical job payload (§6.2) with `_missing_fields[]` populated | Dashboard | 4h | Returns canonical JSON for any current Vollna-fed card |
| **5. `/api/relevancy/evaluate-task` route** | Parse task card URL → resolve UUID → forward to n8n; rate-limit (R1); auth (admin); idempotency (I5) | Dashboard | 4h | Posts to n8n + returns verdict; rate-limit returns 429 |
| **5a. Shared schemas + idempotency middleware** | V1 Zod schemas, I1 idempotency-key middleware, S3 HMAC verification | Dashboard | 1d | All POST endpoints validated + idempotent |
| **5b. Operator Settings API + UI** *(NEW in v3.3)* | `GET /api/admin/system-settings` + 3 PATCH endpoints (§10.6.5) + `<RelevancyClassifierSettings>` card on `/settings` (global toggle, min score, per-profile table, threshold preview, confirmation modals) + cache-bust on save + `activity_log` write | Dashboard | 2d | Admin can flip global Shadow ↔ Active; per-profile toggles enable/disable correctly with global; threshold preview returns live distribution; every change writes to `activity_log` |
| **5c. Kill-switch env var + rate-limit middleware** | `RELEVANCY_CLASSIFIER_ENABLED` wired into n8n kill-switch `IF` (§4.2); rate-limit middleware (R1, R2, R4, R6) | Dashboard + n8n-keeper | 4h | Env=`false` reverts to v2 in <30s; rate-limit returns 429 with `Retry-After` |
| **6. `_relevancy-classifier-core` sub-workflow** | Build C1–C10 + A1 retry/fallback + A3 verifier + A7 temp=0; embed PRD §16 examples; **C6 computes `effective_decision` + `threshold_flipped` + `min_score_at_decision`** (§7.5); C10 persists all v3.3 columns | n8n-keeper | 8h | Validation green; mock job tests pass against Shayan snapshot for both raw-proceed-above-min and raw-proceed-below-min cases |
| **7. Existing workflow splice** *(REVISED in v3.3)* | Insert kill-switch `IF` + `Score Relevancy` executeWorkflow + `Route Verdict` switch (5 branches) + `End (Audit Only)` noOp + the one-line `column: "Todo"` change in `Format ClickUp Task`; follow §13.1 protocol | n8n-keeper | 4h | Mock Vollna job traverses all 5 routing branches based on synthesized verdicts; backup snapshot taken; **`Proposal Submitted` no longer receives auto-created cards** |
| **8. `job-evaluate-manual` workflow** | NEW: J1-J7 nodes per §4.3; J3 reads `/api/tasks/:id/job-payload`; J5 invokes core | n8n-keeper | 4h | Returns verdict in <3s |
| **9. Admin UI: Task Card Evaluator page** | Paste URL + profile picker (with snapshot-availability filter) + result panel + abort; SSE-ready endpoint built but not enabled | Dashboard | 2d | End-to-end manual eval; profiles without snapshots disabled |
| **9a. Task card relevancy badge** *(NEW in v3.3)* | Render `_relevancy_*` custom_fields as a colored badge on every task card surface (kanban, list, search, detail modal). Detail modal fetches full `relevancy_scores` row via `_relevancy_score_id` and renders gate + rubric breakdown in a collapsible section. | Dashboard | 1.5d | All 4 card surfaces show badge; detail modal renders full breakdown; threshold-flipped cards show "⚠ Below threshold" sub-label |
| **10. Admin UI: Relevancy Audit page** | Tiles + drilldowns + L8 lookup + L4 cost dashboard + L11 snapshot-staleness tile + **threshold-flipped rate tile + Settings-history timeline overlay** | Dashboard | 2d | Decision distribution + effective vs raw + gate-fail rates + cost + snapshot freshness + settings-change overlay live |
| **10a. Logging + alerts baseline** | L1 pino structured, L2 request_id, L5 Slack alerts, F2/F3/F6 fallback paths | Dashboard | 1d | Trace one job end-to-end through logs |
| **11. Smoke test** | Replay 20 historical N/A tasks through manual evaluator (against the Shayan/Saim/Craig snapshots) | Waqas | 4h | ≥85% agreement |
| **12. Shadow rollout** *(REVISED in v3.3)* | `system_settings.relevancy.classifier_mode='shadow'` (the migration default). Routing already wired — cards traverse branch 4/5 of the matrix (Todo + badge). Daily decision pivot; admin tunes `min_score` via Settings UI based on live preview. | n8n-keeper + Waqas | 1 week | 7 days × loaded-profile of `relevancy_scores` rows; classifier-vs-agent agreement ≥85%; min_score calibrated |
| **13. Calibration review** | Audit shadow data; set per-profile `min_score_override` for profiles that need it. All 7 active profiles already have snapshots loaded as of 2026-05-11 (Laiba is intentionally unloaded — inactive profile). | Waqas | 2d | Per-profile thresholds documented in PRD changelog; no snapshot uploads pending |
| **14. Active rollout** *(REVISED in v3.3)* | Admin flips `/settings` → Relevancy Classifier → Global Mode → Active (with confirm modal). No n8n edit, no redeploy. Cards matching branches 1+2 stop being created within ~60s. | Waqas | 5 min | First "AI-rejected" entry in `relevancy_scores` with `classifier_mode_at_decision='active'`; audit page shows decision distribution updating live |
| **14a. Per-profile staggered activation** *(NEW in v3.3)* | If any profile needs more shadow time, set its `classifier_enabled=false` from Settings UI before flipping global. Re-enable individually as each profile's data converges. | Waqas | ad-hoc | All profiles eventually have `classifier_enabled=true` |
| **15. Override capture** | Wire `relevancy_overrides` insertion into `moveTaskAction` (D4) | Dashboard | 4h | Override rate visible in audit |
| **16. P1 hardening pass** | All §16 P1 items (R1/R2/R4/R6, A3-A9/A11, S4/S7/S9-S11, V7/V9, etc.) | Dashboard + n8n | 1 week | All P1 items closed in audit |
| **17. Post-launch review** | 30-day review; promote stable JSON snapshot to backup; archive previous; document calibrated thresholds + final per-profile settings in PRD changelog | Waqas | 1h | New `(working).json` baseline; `CLAUDE.md` updated |

**Total engineering effort** (v3.3): ~10–12 working days, gated by PRD freeze + secrets (Phase 0), snapshot uploads for currently-empty profiles (Phase 13), and 1-week shadow. P0 items (§16.12) are blocking for Phase 14; P1 items run in parallel with Phase 14+. The v3.2 → v3.3 delta added ~2 days of work: Settings UI (5b ≈ 2d), task-card badge rendering (9a ≈ 1.5d), and the C6 threshold logic + extra `relevancy_scores` columns (Phase 6 ≈ +2h vs v3.2).

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

## Appendix C — DLQ retry worker spec

Background drain for `relevancy_scores_dlq` (failed C10 writes parked by C11). Triggered hourly by GitHub Actions (the repo already uses GH Actions for Contabo deploy — no new infra).

### C.1 Route handler

`src/app/api/cron/relevancy-dlq-drain/route.ts`:

```ts
// Hit hourly by GH Actions; protected by CRON_SECRET Bearer header (same pattern as the
// existing /api/migrate route in this repo).
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await drainRelevancyScoresDlq({ maxAttempts: 5, batchSize: 50 });
  return Response.json(result);
}
```

The data-layer function `drainRelevancyScoresDlq` (§10.9.2):

1. `SELECT * FROM relevancy_scores_dlq WHERE resolved_at IS NULL AND next_attempt_at <= NOW() ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`
2. For each row: re-attempt the `INSERT INTO relevancy_scores` using the parked `payload`.
3. On success: `UPDATE relevancy_scores_dlq SET resolved_at = NOW() WHERE id = $1`.
4. On failure: `UPDATE relevancy_scores_dlq SET attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '1 hour' * POW(2, attempts) WHERE id = $1`.
5. After 5 attempts (`attempts >= 5`): leave `resolved_at = NULL`, but emit a Slack alert (`RELEVANCY_DLQ_PERMANENT_FAILURE`) and skip on future runs.
6. Return `{ retried, succeeded, failed, permanent }`.

### C.2 GitHub Actions workflow

`.github/workflows/relevancy-dlq-drain.yml`:

```yaml
name: Relevancy DLQ Drain

on:
  schedule:
    - cron: '7 * * * *'   # 07 minutes past every hour
  workflow_dispatch:

jobs:
  drain:
    runs-on: ubuntu-latest
    steps:
      - name: Hit drain endpoint
        run: |
          curl -X POST \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
               -H "Content-Type: application/json" \
               -sSf \
               --retry 3 \
               --max-time 60 \
               http://157.173.110.62/api/cron/relevancy-dlq-drain \
            | jq .
```

`CRON_SECRET` is already in the GH Actions secret store (re-used from the existing `/api/migrate` route per CLAUDE.md). No new secret to provision.

### C.3 Acceptance criteria

- DLQ depth (`SELECT COUNT(*) FROM relevancy_scores_dlq WHERE resolved_at IS NULL`) should drop to zero within 5 hours of any DB write blip, assuming the underlying issue is transient.
- Permanent failures (5 attempts exhausted) page Waqas via Slack; the row stays in the DLQ with `attempts=5` for forensic review until manually marked `resolved_at` or deleted.
- The audit page `<RelevancyDlqTile>` shows live `pending` count + last-drain timestamp (from the most recent `resolved_at`).

### C.4 Idempotency

The hourly cron may overlap with a manual `workflow_dispatch` run. `SELECT … FOR UPDATE SKIP LOCKED` guarantees only one worker drains a given row at a time. Even if two workers race, neither sees the same row.

---

## Appendix D — Smoke-test fixture catalog

Phase 11 ("Replay 20 historical N/A tasks") frozen fixture. Sourced from Contabo Postgres on 2026-05-11 — `tasks` rows in the N/A column (`03203fe7-c062-4291-93a9-454252f2b3b9`) created within the last 60 days, joined with each agent's tagged `_reason` (the human ground truth captured at move-to-N/A time).

**Status:** POPULATED — ready for Phase 11.

### D.1 Selection criteria

Three strata, 20 tasks total:

| Stratum | Count | Selection rule |
|---|---|---|
| Single-reason rejects | 12 | One task per PRD §6.2 rejection reason — covers the full gate space |
| Multi-reason rejects | 4 | Interesting reason combinations — stress-tests multi-gate logic |
| Candidate false rejects | 4 | High client signal (spent > $10k, rating ≥ 4.8) but agent moved to N/A without tagging a reason — tests whether the classifier picks up signal the human missed |

Profile distribution: skewed toward Shayan (he owns 50% of N/A volume) but covers Craig, Khansa, Sana, Saim. Rebekah and Nawal not represented in this fixture; Phase 13 calibration may add cases from them after a few weeks of post-launch data.

### D.2 Fixture table

| # | Task UUID | Profile | Title (truncated) | Captured reason(s) | Client signal | Expected classifier verdict |
|---|---|---|---|---|---|---|
| 1 | `d2aeea13-d4d3-4e66-ac13-5b0d53f49a99` | Craig | iOS App UX and UI Review | `["Already hired"]` | spent $2.1k · rating 4.93 | reject — gate 7 (Job unavailable / Already hired) |
| 2 | `8c9e2288-8cdf-48dc-9f75-c266de740deb` | Khansa | Proactive Funnel & Website Assistant for Showit + Systeme.io | `["Bad rating client"]` | spent $1k · rating **1.52** | reject — gate 6 (client_rating_floor) |
| 3 | `bfa1eed1-b525-4198-a864-1da119cb891a` | Shayan | Simple Browser Automation Script to Save Pages as PDFs | `["Client Low spending"]` | spent **$154** · rating 4.75 | reject — gate 5 (client_spend_floor) |
| 4 | `68795ef9-8073-47e2-889b-439ae9e5255b` | Shayan | Joomla Web Maintenance | `["Job unavailable"]` | spent $28.8k · rating 4.99 | reject — gate 7 (semantic: marked closed/unavailable) |
| 5 | `bdae7586-c8b0-4ab1-8fa8-cbb3e65adb04` | Shayan | Przebudowa 2 serwisów + migracja + SEO (WordPress) *(Polish)* | `["Language barrier"]` | n/a | reject — soft signal (non-English description) |
| 6 | `99ab1646-87b3-4736-8c79-c2ccaba3ae97` | Shayan | Peptide Website Development | `["Location loc"]` | n/a · budget $15-25/hr | reject — gate 8 (no_location_lockin) |
| 7 | `520f74af-1e4a-4c96-8c9f-5f8ff993bf74` | Shayan | WordPress Speed Optimization Expert | `["Low Higher rate"]` | spent $5.2k · rating 3.81 · budget "Not specified" | reject — gate 4 (hourly_floor) — note: this also has a low rating, classifier may surface gate 6 |
| 8 | `34d3baac-bc20-4873-9d4c-26a086ac182c` | Saim | Operations Specialist wanted for busy Founder | `["Old job"]` | spent $29k · rating 4.72 · budget $25/hr | reject — gate 2 (freshness, >24h) |
| 9 | `18b996e2-1bb3-42e1-8c1b-174218d2f1d2` | Shayan | Kartra Central Hub + GoHighLevel Funnel Builder | `["Out of stack"]` | spent $8.9k · rating 4.53 · budget $16-20/hr | reject — gate 1 (stack_match) — Kartra/GHL not in Shayan's Laravel/WP stack |
| 10 | `d1de1bfc-5d21-405e-983e-a693a43d9101` | Khansa | AI-Augmented Software Engineer (Contract) — Claude Code | `["Portfolio unavailable"]` | spent $10.4k · budget $30-45/hr | reject — gate 10 (portfolio_match) — but note: gate-10 soft-pass triggers if Khansa is top_rated (she is). Classifier likely SOFT-PASSES → may proceed. **Calibration case.** |
| 11 | `731abf6b-79f3-4cba-a464-61d2e4649318` | Shayan | Website Re-Theming and Design | `["Too many invites"]` | budget $20-50/hr | reject — gate 3 (proposal_saturation, ≥30 proposals) |
| 12 | `c10162c1-2d27-4a40-a3b2-8cbdca319a64` | Sana | Product Engineer (Next.js / Node) - AI Encouraged | `["Video Proposal"]` | spent **$1.2M** · rating 4.97 · budget $40-65/hr | reject — gate 9 (no_video_proposal). **Strong calibration case** — every other signal is excellent; verifier (§16.7 A3) must catch the video requirement. |
| 13 | `746aa467-d495-49a3-8dc1-5756bfcb57da` | Shayan | Landing Page Designer for Physiotherapy Clinics | `["Low Higher rate", "Client Low spending"]` | spent $255 · rating 5.0 | reject — both gates 4 + 5 fire |
| 14 | `61f61a79-3abe-4e76-aaf6-d8b0fd5879eb` | Shayan | Ai calling agent | `["Out of stack", "Too many invites"]` | spent $9.8k · rating 5.0 | reject — gates 1 + 3 |
| 15 | `fd765ae2-8c6d-4ed6-87aa-38ee9dafb03e` | Saim | Senior Node.js/NestJS Engineer – 7-Day SaaS Deployment | `["Old job", "Low Higher rate"]` | spent $149 · rating 5.0 · budget $3,500 fixed | reject — gates 2 + 4 (fixed budget interpretation) — also low client spend |
| 16 | `7b505a3a-1e62-476e-a5a4-86da99346aa3` | Shayan | Small Website Changes Needed | `["Old job", "Client Low spending"]` | spent $315 · rating 5.0 · budget $12-25/hr | reject — gates 2 + 5 |
| 17 | `86641e0f-0f95-4030-86a6-d051e927b87d` | Khansa | Supabase + Clay backend integration for Lovable-built SaaS | `[]` *(no reason captured)* | spent **$137.9k** · rating 4.88 · budget **$50-100/hr** | **CANDIDATE FALSE REJECT** — every gate should pass for Khansa (Supabase/Clay are in stack, client is excellent, budget is high). Expected: classifier says PROCEED. If it agrees with the agent and rejects → the rejection reason is informative. |
| 18 | `c8e6ead1-283d-4cc0-aef9-e6638eb94854` | Sana | (lra) Website development (in React/NextJS 16) w/ Sliders, Animations | `[]` *(no reason)* | spent **$189.8k** · rating 4.81 · budget $2,300 fixed | **CANDIDATE FALSE REJECT** — Next.js is Sana's stack, client is excellent. Expected: PROCEED. |
| 19 | `b206db0f-564a-4ed8-be53-31d60dc4d23b` | Craig | Zoho Creator App Development | `[]` *(no reason)* | spent **$145.8k** · rating 5.0 · budget $1,500 fixed | **CANDIDATE BORDERLINE** — Zoho Creator is not Craig's typical mobile-dev stack. Expected: reject (gate 1) — agent may have just forgotten to tag. |
| 20 | `db37076e-4750-4be6-8d15-b19efb315d25` | Sana | Elementor WordPress Page Builder (Execution Only – No Design Required) | `[]` *(no reason)* | spent **$11.9k** · rating 4.95 · budget **$12-22/hr** | **CANDIDATE BORDERLINE** — Elementor is in Sana's stack but budget is at/below hourly floor. Expected: reject (gate 4) OR proceed if Sana's hourly is < $22. |

### D.3 Scoring the smoke test

For each fixture, run `/relevancy-evaluator` against the task's tagged profile (per `custom_fields._profile_name`). Compare:

| Metric | Pass criterion |
|---|---|
| **Effective decision agreement** | Classifier `effective_decision` matches "Expected classifier verdict" column → +1 point. 20 points max. Target ≥17 (85%). |
| **Reason overlap (single-reason cases #1–12)** | Classifier's `rejection_reasons` array contains the captured reason → +1 bonus per case. Tracks "is the classifier choosing the right gate?" not just "is it rejecting?". Target ≥10/12 reason overlap. |
| **False-reject signal (#17–20)** | If classifier says PROCEED on #17 and #18 (the strongest "should have proceeded" cases), that's positive calibration evidence. If it agrees with the agent and rejects, the rejection reason tells us which gate the agent (subconsciously) used. Both outcomes are informative. |

Borderline cases (#10, #19, #20) — half-point credit; explicit notes in the result panel about why the classifier disagreed are more valuable than the binary match.

### D.4 What to do with the results

1. **If overall agreement ≥85%** → proceed to Phase 12 (shadow rollout).
2. **If 70–85%** → tighten thresholds via `/settings` UI (e.g. bump global `min_score` from 50 → 60); re-run the smoke test; retry Phase 12 entry.
3. **If <70%** → re-examine the classifier prompt + PRD §16 examples; do not start shadow.
4. **For cases #17–20** specifically: regardless of decision agreement, file the verdict + reasoning as calibration evidence in `relevancy_overrides` (manual entry, since these pre-date the override-capture wiring). They are gold for tuning.

### D.5 Refresh cadence

The fixture is **frozen** for v3.3 Phase 11. After active rollout, the `/relevancy-audit` page surfaces live disagreement data — at that point the smoke test becomes obsolete and Phase 17 (post-launch review) decides whether to refresh the fixture for v3.4 testing.

### D.6 Auxiliary stats (from the same Contabo pull, 2026-05-11)

| Profile | Total N/A in last 30d | Snapshot loaded? |
|---|---|---|
| Shayan | ~301 | ✅ Yes |
| Khansa | ~230 | ✅ Yes |
| Laiba | ~122 (historical) | ⏸ Profile inactive — no upload needed |
| Craig | ~50 | ✅ Yes |
| Sana | ~45 | ✅ Yes |
| Saim | ~21 | ✅ Yes |
| Rebekah | ~18 | ✅ Yes |
| Nawal | (very low) | ✅ Yes |

Laiba's historical N/A volume in the table above reflects the 60-day window — she was active for part of it but is now disabled at the Vollna source. No new traffic is expected on her webhook; the classifier never reaches her path. If she's reactivated later, the standard snapshot-upload flow (§5.5) covers it.

Rejection-reason distribution (last 30d, all profiles):

| Reason | Count |
|---|---|
| Out of stack | 157 |
| Too many invites | 104 |
| Old job | 98 |
| Low Higher rate | 74 |
| Location loc | 62 |
| Client Low spending | 20 |
| Job unavailable | 14 |
| Already hired | 8 |
| Language barrier | 4 |
| Video Proposal | 3 |
| Bad rating client | 3 |
| Portfolio unavailable | 2 |
| *(no reason captured)* | 105 |
| *(multi-reason combinations)* | 73 |

The "no reason captured" bucket (105 tasks in 30d) is the biggest calibration opportunity — these are cards an agent moved to N/A without explaining why, which the classifier might either confirm (real reject) or dispute (false reject). The 4 false-reject candidates in §D.2 sample from this bucket.

---

## Document conventions

- **Gate IDs** match PRD §7 row order verbatim. Never renumber.
- **Reason labels** quoted verbatim from PRD §6.2 (typos preserved). Migration is a separate workstream.
- **`criteria_version` / `prompt_version` / `prompt_mode`** stored on every `relevancy_scores` row. Three together let us reconstruct any historical decision exactly.
- **Profile IDs** are TEXT slugs (matching `profiles.profile_id`). Snapshot rows reference the same slug. Display names appear only in human-readable fields.
- **Sub-workflow naming**: prefix with underscore (`_relevancy-classifier-core`) to signal "internal, do not webhook directly".
- **No external scraping**. Profile data is uploaded by admin to `upwork_profile_snapshots`; job data is read from `tasks.custom_fields` (populated by the existing Vollna pipeline). If we ever need to re-introduce live scraping (e.g. a saved-search watcher in v4), the entry point is a NEW workflow — never the classifier core.
- **Snapshot uploader is the source of profile truth.** Never read profile context from anywhere except `upwork_profile_snapshots_current` (or its data-layer wrappers). Don't build separate `profile_stacks` / `profile_portfolios` tables.
