# Upwork Relevancy Scoring AI — Build Plan **v2**

**Status:** Draft for engineering review · 2026-05-06
**Supersedes:** `upwork-relevancy-scoring-ai-plan.md` (v1)
**Source PRD:** `job_relevancy_criteria_prd.md` v0.2
**Stack:** Vollna → n8n (`EWnZg3svZWwcIRs4`) → Gemini Flash 2.5 → Postgres (Contabo) + Task Board

This plan unifies the v1 build plan with the data-grounded PRD, locks in **Gemini Flash 2.5** as the classifier LLM, and produces a system that is gate-driven (binary pass/fail with verbatim reason labels) **and** score-driven (0-100 with tiers for ranking) — neither alone.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Key Improvements Over Existing Plan](#2-key-improvements-over-existing-plan)
3. [n8n Workflow Design](#3-n8n-workflow-design)
4. [Relevancy Scoring Model](#4-relevancy-scoring-model)
5. [Gemini Flash 2.5 Prompt Design](#5-gemini-flash-25-prompt-design)
6. [New n8n Nodes](#6-new-n8n-nodes)
7. [Data Schema (JSON + DDL)](#7-data-schema)
8. [Performance + Cost Considerations](#8-performance--cost-considerations)
9. [Future Enhancements](#9-future-enhancements)
10. [Appendix A — Open Questions Inherited from PRD](#appendix-a)
11. [Appendix B — Build Order](#appendix-b)

---

## 1. System Overview

### 1.1 Purpose

Replace the current **manual triage** (where agents reject 42% of incoming Vollna jobs by hand using 13 verbatim `_reason` labels on Task Board cards) with an **automated relevancy classifier** that runs inside the existing n8n workflow `EWnZg3svZWwcIRs4`, between `Process Job` and `Build GPT Input`. The classifier emits both a binary decision (proceed/reject/review) and a 0-100 relevance score, and writes its verdict into the existing Task Board so agents can audit and override.

### 1.2 Architecture in one diagram

```
   Vollna  ─[ 8 webhooks ]─►  n8n EWnZg3svZWwcIRs4
                                                                                                                         (existing)
   Webhook-{Sana|Laiba|...|Nawal} ──► Respond ──► Merge All Webhooks (v3.2, 8 inputs)
                                                                          │
                                                                          ▼
                                                                  Process Job  ── emits proceed | no_profile | rejected
                                                                          │
                                                                          ▼
                                                                   Route Job  (Switch v3)
                          ┌───────────────────────────────────────┴──────────────────────────────────────┐
                          │ no_profile / rejected                                                                │ proceed
                          ▼                                                                                                 ▼
                    Format Dashboard Event ──► /api/webhook/n8n                                ┌─────────────────────────────┐
                                                                                                              │  ⓘ NEW pipeline starts here │
                                                                                                              └─────────────────────────────┘
                                                                                                              │
                                                                                              [N1] Load Profile Context  (HTTP GET /api/profiles/:id/context)
                                                                                                              │
                                                                                              [N2] Deterministic Pre-check  (Code) — gates 2,3,5,6,11
                                                                                                              │
                                                                                              [N3] Gate Switch  (IF: any_deterministic_fail?)
                                                                                          ┌──────────┴──────────┐
                                                                                          │ YES                              │ NO
                                                                                          ▼                                       ▼
                                                                          [N7] Build Reject Payload      [N4] Prepare Classifier Input  (Set)
                                                                                          │                                       │
                                                                                          │                                 [N5] AI Agent — Relevancy Classifier
                                                                                          │                                       │     ↳ ai_languageModel ← Gemini Flash 2.5
                                                                                          │                                       │     ↳ ai_outputParser  ← Structured Output Parser
                                                                                          │                                 [N6] Validate Output  (Code; retry-once on schema fail)
                                                                                          │                                       │
                                                                                          │                                 [N8] Decision Switch
                                                                                          │                       ┌─────────────┼──────────────┐
                                                                                          │                       │ reject              │ review                │ proceed
                                                                                          │                       ▼                            ▼                          ▼
                                                                                          └─►  [N7] Build Reject Payload     [N9] Build Review Payload     Build GPT Input  (existing)
                                                                                                            │                                            │                                                │
                                                                                                            ▼                                            ▼                                                ▼
                                                                                          Format ClickUp Task              Format ClickUp Task                AI Agent - Proposal Writer  (existing)
                                                                                          (column = "N/A",                  (column = "Todo",                     │
                                                                                            _reason = labels)                 _flag = "needs_review")            ... existing proposal flow ...
                                                                                                            │                                            │                                                │
                                                                                                            └────────────────┬───────────────┘                                                ▼
                                                                                                                                       │                                              [N10] Persist Relevancy Score
                                                                                                                                       ▼                                                       │
                                                                                          Format Dashboard Event (extended)  ◄────┴───────────────────────────────┘
                                                                                                            │
                                                                                                            ▼
                                                                                                  /api/webhook/n8n  (now populates scores.aiRelevant, scores.aiScore, scores.heuristic)
```

### 1.3 Decision matrix at a glance

| Path | Trigger | Output | Card destination | LLM call? |
|---|---|---|---|---|
| **A. Deterministic reject** | Any of gates 2,3,5,6,11 fails | `decision=reject`, `rejection_reasons=[verbatim]` | `N/A` column with reason | **No** (saves $$) |
| **B. LLM reject** | All deterministic pass; LLM fails any of gates 1,4,7,8,9,10 | `decision=reject`, `rejection_reasons=[verbatim]` | `N/A` column with reason | Yes |
| **C. LLM review** | All gates pass but `confidence < 0.6` OR `total_score < 40` | `decision=review` | `Todo` with `needs_review` flag | Yes |
| **D. LLM proceed** | All gates pass, score ≥ 40 | `decision=proceed`, full score breakdown, top 3 angles | Continues to existing Proposal Writer → `Proposal Submitted` | Yes |

### 1.4 What this plan does NOT change

- The 8 per-agent webhooks, Respond nodes, Merge node, or Process Job (existing logic preserved)
- The AI Agent — Proposal Writer (still Claude Haiku 4.5 — proposal craft, not gating)
- The two Contabo sinks (`/api/v1/webhooks/tasks` Board API + `/api/webhook/n8n` dashboard webhook)
- The 13 verbatim rejection labels (typos preserved per PRD §9.2 until DB migration)

---

## 2. Key Improvements Over Existing Plan

| # | v1 weakness | v2 improvement | Reference |
|---|---|---|---|
| 1 | Single-profile assumption | Multi-profile aware: 8 profiles, each with own stack bucket, portfolio, thresholds | PRD §5, §6.4 |
| 2 | Pure 100-point rubric → opaque, hard to action operationally | Hybrid: 11 binary gates (PRD §7) + 7-component rubric for ranking | PRD §7, v1 §4 |
| 3 | All jobs go through LLM → wasted $$ on trivial rejects | Deterministic pre-check kills 60-70% of fails before LLM | PRD §10.5 |
| 4 | Rubric labels free-form → can't drive existing N/A workflow | Verbatim §6.2 labels via `responseSchema` enum (typos preserved: `"Low Higher rate"`, `"Location loc"`) | PRD §6.2, §9.2 |
| 5 | No few-shot anchoring → behavior drifts | Embed PRD §16 Appendix C JSON (40 reject + 18 proceed examples) as system-prompt few-shot | PRD §16 |
| 6 | Profile-via-HTML pipeline → fragile, off-DB | Profile context from Postgres: new `profile_stacks` + `profile_portfolios` tables; existing `profiles` table | PRD §10.1 Option B |
| 7 | New parallel `scores`/`outcomes`/`profile`/`jobs` tables ignore existing schema | Reuse `tasks` + `jobs` + `profiles`; add only `relevancy_scores` log + 2 profile-side tables | repo schema |
| 8 | Greenfield n8n workflow ignores existing one | Splice into `EWnZg3svZWwcIRs4` between `Process Job` and `Build GPT Input` | live workflow |
| 9 | Telegram notifications as primary output | Task Board card is source of truth; `scores.aiRelevant`/`aiScore`/`heuristic` populate dashboard payload (currently null placeholders); Telegram optional for tier=apply_now only | repo conventions |
| 10 | No error-path → Gemini 503 silently drops jobs | Retry × 3 with exponential backoff; permanent failure → `Todo` card with `needs_review=true` flag (no silent loss) | new |
| 11 | No prompt-version ⟷ criteria-version coupling | Every score row stores both `prompt_version` and `criteria_version` (matches PRD version) for clean calibration | extends v1 §schema |
| 12 | No per-profile threshold variation | Threshold config is per-profile (loaded by [N1]); calibration loop can tighten Khansa's spend floor without touching Sana's | PRD §11 Q1 |
| 13 | Confidence not surfaced | Classifier emits `confidence ∈ [0,1]`; low-confidence proceeds get routed to review queue, not directly to Proposal Writer | new |
| 14 | No observability beyond Postgres log | Dashboard view: rejection rate by gate × profile × week (PRD §10.4); classifier accuracy = (agent N/A move agrees with classifier reject) ÷ total | PRD §10.4 |
| 15 | No context caching → pays full input every call | Gemini 2.5 implicit/explicit caching: system+few-shot (~7k tokens) cached → ~75% cost reduction on repeat input | new |

---

## 3. n8n Workflow Design

### 3.1 Splice point

The classifier inserts between **Route Job (output 0: proceed)** and **Build GPT Input** in workflow `EWnZg3svZWwcIRs4`. This is the only workflow path that currently leads to a proposal being drafted; intercepting it is sufficient.

The 4 other Route Job branches (`no_profile`, `inactive`, `duplicate`, `rejected`) are unchanged — they continue to flow to `Format Dashboard Event` only. (`inactive` and `duplicate` remain dead branches per CLAUDE.md; the classifier may later emit those values if business rules change, but v2 does not.)

### 3.2 Node-by-node breakdown (NEW nodes only — N1–N10)

| ID | Node name | Type | Purpose | Key inputs | Key outputs |
|---|---|---|---|---|---|
| N1 | **Load Profile Context** | `n8n-nodes-base.httpRequest` v4.2 | Fetch profile stack bucket, portfolio, thresholds | `profile_id` from Process Job | `{ profile, criteria_version }` |
| N2 | **Deterministic Pre-check** | `n8n-nodes-base.code` v2 | Run gates 2,3,5,6,11 with deterministic logic | Job + profile | `{ deterministic: { passed[], failed[] } }` |
| N3 | **Gate Switch** | `n8n-nodes-base.if` v2 | Branch on `deterministic.failed.length > 0` | Output of N2 | true → N7, false → N4 |
| N4 | **Prepare Classifier Input** | `n8n-nodes-base.set` v3.4 | Assemble single JSON object for the LLM | Job, profile, deterministic results | `{ input_text }` for langchain |
| N5 | **AI Agent — Relevancy Classifier** | `@n8n/n8n-nodes-langchain.agent` v3.1 | LLM classification with structured output | `input_text` + sub-nodes | Validated JSON (relevancy schema) |
| N5a | ↳ **Gemini Flash 2.5** | `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` v1 | The LLM | model = `gemini-2.5-flash`, temp = 0.15 | Token stream |
| N5b | ↳ **Structured Output Parser** | `@n8n/n8n-nodes-langchain.outputParserStructured` v1.2 | Enforce relevancy schema (see §5.4) | Schema JSON | Parsed object |
| N6 | **Validate Classifier Output** | `n8n-nodes-base.code` v2 | Sanity check: enum labels, score range, gates_failed ↔ rejection_reasons consistency. Retry-once on parse fail. | Output of N5 | Validated object or `{ error: ... }` |
| N7 | **Build Reject Payload** | `n8n-nodes-base.set` v3.4 | Construct task payload for `N/A` column with verbatim reasons | Job + (deterministic OR LLM) reject reasons | `{ taskName, taskDescription, custom_fields, _column: 'N/A' }` |
| N8 | **Decision Switch** | `n8n-nodes-base.switch` v3 | 3-way branch: reject / review / proceed | Output of N6 | Rule 0 → N7, Rule 1 → N9, Rule 2 → existing `Build GPT Input` |
| N9 | **Build Review Payload** | `n8n-nodes-base.set` v3.4 | Same as N7 but column = `Todo`, flag = `needs_review` | Job + classifier output | Same shape as N7 with `_column: 'Todo'` |
| N10 | **Persist Relevancy Score** | `n8n-nodes-base.httpRequest` v4.2 | POST classification verdict to `/api/relevancy-scores` for audit | Full classifier output + path metadata | 200 OK |

### 3.3 Wire-up summary

```
Process Job ─► Route Job (output 0: proceed) ─► [N1] ─► [N2] ─► [N3 IF]
                                                                                                               ├─true→ [N7] ─► Format ClickUp Task (existing)
                                                                                                               └─false→ [N4] ─► [N5] ─► [N6]
                                                                                                                                                                ↓
                                                                                                                                                          [N8 Switch]
                                                                                                                                  ├─reject→ [N7] ─► Format ClickUp Task
                                                                                                                                  ├─review→ [N9] ─► Format ClickUp Task
                                                                                                                                  └─proceed→ Build GPT Input (existing)

[N7]/[N9] ─► Format ClickUp Task ─► (existing fan-out: Board API + Format Dashboard Event)
Anywhere a classification fires ─► [N10] in parallel (does NOT block the Switch path)
```

### 3.4 Existing nodes touched (no logic change, only payload extension)

| Existing node | Change | Why |
|---|---|---|
| `Format ClickUp Task` | Read `_column` from input (defaults to `Proposal Submitted` for proceed; `N/A` for reject; `Todo` for review). Same node serves all three paths. | Single sink keeps Board API call surface tight |
| `Format Dashboard Event` | Populate `scores.aiRelevant` (boolean), `scores.aiScore` (0-1), `scores.heuristic` (gate flag object) from N6 output if available; null otherwise | Finally fills the placeholder fields in `/api/webhook/n8n` |

### 3.5 Error handling

- **N5 (Gemini call) failure**: HTTP node configured with `retry: 3, retryWait: 1000ms` (exponential). On final failure, output an error object with `decision: review`, `rejection_reasons: []`, `summary: "Classifier unavailable — manual review"`. Card lands in `Todo` with `needs_review=true`.
- **N6 schema validation failure**: One in-place retry with the same input (Gemini sometimes recovers on retry due to streaming hiccups). Second failure → fall through to review.
- **N1 profile-context fetch failure**: Cached profile JSON in n8n static data with 1h TTL is the fallback. If both fail → review.
- **`neverError: true` is forbidden on the new HTTP nodes** (N1, N10) — we want errors to surface, not silent drops.

---

## 4. Relevancy Scoring Model

### 4.1 Two-layer model

The PRD wants binary gates with verbatim labels. The v1 plan wants continuous score for ranking. We do **both**:

- **Layer 1 — Hard Gates (binary)**: 11 gates from PRD §7. Any single fail → `decision: reject`. The exact label from §6.2 goes into `rejection_reasons[]`.
- **Layer 2 — Rubric Score (0–100, only when Layer 1 fully passes)**: The 7 v1 components, kept but re-anchored to PRD evidence. Used to assign tier and rank queued proceed-cards.

### 4.2 Hard gates (Layer 1) — gate ID ↔ check ↔ label

Gate IDs match PRD §7 row order. Each gate is checked by the **cheapest path that can answer correctly**.

| Gate ID | Check (deterministic where possible) | Threshold (v1) | Reason label on fail | Checker |
|---|---|---|---|---|
| `1_stack_match` | Token overlap of `job.skills_required` ∪ `job.title` keywords with `profile.stack_bucket` (with alias map) | At least 1 strong-match keyword | `"Out of stack"` | LLM (semantic) — too noisy for pure regex |
| `2_freshness` | `now() - job.posted_at` | ≤ 24h | `"Old job"` | **Deterministic** ([N2]) |
| `3_proposal_saturation` | `job.proposals_count` (or Vollna bucket) | < 30 | `"Too many invites"` | **Deterministic** ([N2]) |
| `4_hourly_floor` | `job.budget_min` (when budget_type='hourly') | ≥ $25/hr | `"Low Higher rate"` *(typo per PRD)* | **Deterministic** ([N2]); LLM if budget text needs parsing |
| `5_client_spend_floor` | `job.client_total_spent` | ≥ $1,000 | `"Client Low spending"` | **Deterministic** ([N2]) |
| `6_client_rating_floor` | `job.client_rating` | ≥ 4.0 (or null with 0 hires) | `"Bad rating client"` | **Deterministic** ([N2]) |
| `7_job_availability` | `job.status` from Vollna; text scan for "filled"/"closed" | Open | `"Job unavailable"` / `"Already hired"` | LLM (text scan) |
| `8_no_location_lockin` | Description text scan for residency requirements | No lock | `"Location loc"` *(shorthand per PRD)* | LLM (semantic) |
| `9_no_video_proposal` | Description text scan for "video" / "loom" / "record yourself" | No requirement | `"Video Proposal"` | LLM (text scan) |
| `10_portfolio_match` | Cross-reference job stack against `profile_portfolios.tech_stack` | At least 1 mappable item | `"Portfolio unavailable"` | LLM (semantic) |
| `11_no_duplicate` | `job.job_id` lookup against last 30d of board | Not seen | `"Duplicate"` | **Deterministic** ([N2]) — already enforced by webhook intake; we re-confirm |

**Split**: gates 2, 3, 4 (when budget is structured), 5, 6, 11 are checked deterministically in [N2]. Gates 1, 4 (when budget is text), 7, 8, 9, 10 are checked by the LLM in [N5].

Multiple hard gates can fail simultaneously → `rejection_reasons[]` is multi-valued.

### 4.3 Rubric (Layer 2) — only fires when all hard gates pass

| Component | Max | Anchored to | Penalty cues |
|---|---|---|---|
| `skill_match` | 30 | Depth of evidence in `profile.work_history` + `profile.portfolios` for job's required skills | "Listed but never used" → -15 |
| `portfolio_evidence` | 20 | Concrete portfolio item that mirrors the job's needs (gate 10 already passed; this is depth) | Generic match → cap at 10 |
| `client_quality` | 15 | Combined `client_total_spent` + `client_hires` + `client_rating` (gates already passed; this is gradient) | Low end of passing range → cap at 8 |
| `competition_position` | 10 | `proposals_count` × `freshness` × niche depth | 20+ proposals → -5 |
| `domain_match` | 10 | Industry alignment with prior work history | Generic SaaS for ML-only profile → -5 |
| `experience_level_fit` | 10 | Job seniority vs profile JSS, hourly rate, history | Mismatch in either direction → -5 |
| `red_flags` | 5 | Vague description, scope creep cues, budget-vs-scope mismatch | Each cue → -1 |

`total_score = sum(components)` — the LLM also returns `total_score` and we cross-check in [N6]. If they differ → second retry; if still differ → log warning, trust component sum.

### 4.4 Tier mapping

| Tier | Score range | Behavior |
|---|---|---|
| `apply_now` | 80–100 | Proceed; optional Telegram alert with top 3 angles |
| `strong` | 60–79 | Proceed |
| `marginal` | 40–59 | Proceed but flagged; optional second-pass review |
| `skip` | 0–39 | **Hard gates passed but score is too low → review queue** (do not auto-reject; agent decides) |

**Important:** A `skip` tier does NOT cause rejection — only failed gates do. A `skip` job goes to the review queue because it's borderline-not-worth-it but no specific gate said no.

### 4.5 Soft signals (PRD §8)

The 7 PRD soft signals are embedded as `evidence` in the rubric components — they don't have their own score lines. E.g., "Client spent > $5,000" inflates `client_quality.value`; "Connect cost > 8" decrements `competition_position.value`.

Soft signals are NOT used for rejection. The PRD is explicit: only hard gates reject.

---

## 5. Gemini Flash 2.5 Prompt Design

### 5.1 API integration

- **Model**: `gemini-2.5-flash`
- **API**: Google AI Studio (`generativelanguage.googleapis.com`) via n8n's `lmChatGoogleGemini` node
- **Auth**: API key in n8n credential `Google Gemini API`
- **Temperature**: `0.15` (lower than v1's 0.2 — classification, not creative)
- **Context caching**: Use Gemini 2.5 implicit caching by keeping the system instruction byte-stable (don't interpolate per-job vars into the system prompt). Per-job content goes into the user message only.

### 5.2 Prompt anatomy (3 parts)

```
┌─ systemInstruction (cached, ~7k tokens after first call)
│   1. Role & operating context
│   2. The 11 hard gates (verbatim from PRD §7)
│   3. The 13 reason labels (verbatim from PRD §6.2 — typos intentional)
│   4. The rubric (Layer 2)
│   5. The §16 Appendix C example library (40 reject + 18 proceed)
│   6. Output rules
│
├─ user message (per-job, ~600 tokens)
│   - Profile summary (name, stack bucket, portfolio TL;DR — NOT full HTML)
│   - Normalized job
│   - Deterministic gate results (which gates already passed/failed)
│
└─ generationConfig
    - temperature: 0.15
    - responseMimeType: "application/json"
    - responseSchema: (see §5.4)
```

### 5.3 System instruction (production v1)

```
You are the Rising Lions Upwork Relevancy Classifier. Decide whether an incoming Upwork job is RELEVANT (worth a proposal) or NOT RELEVANT (move to N/A) for a specific freelancer profile.

You operate against PRD v0.2 of `job_relevancy_criteria_prd.md`. Your output MUST conform to the JSON schema provided in generationConfig.

## DECISION RULES

1. A job is RELEVANT only if it passes ALL 11 hard gates. Any single hard-gate failure → `decision: "reject"`.
2. If `decision: "proceed"`, also assign a 0–100 rubric score across the 7 components below. Tier = function of total_score.
3. If a gate result was already determined by the deterministic checker (you will see them in `input.deterministic`), TRUST those results. Only evaluate the gates marked `pending` for you in `input.deterministic.pending_for_llm`.
4. If `input.deterministic.failed` is non-empty, your decision MUST be "reject" with those reasons in `rejection_reasons` (and you may add more if the LLM-checked gates also fail). Skip rubric scoring (set components to null, total_score to null).

## HARD GATES (11)

| # | Gate ID | Condition | Reason label on fail |
| 1 | 1_stack_match | Job's primary skill is in profile's stack_bucket (allow alias map) | "Out of stack" |
| 2 | 2_freshness | Posted within 24h | "Old job" |
| 3 | 3_proposal_saturation | <30 proposals submitted | "Too many invites" |
| 4 | 4_hourly_floor | Hourly bottom ≥ $25/hr (skip if fixed budget) | "Low Higher rate" |
| 5 | 5_client_spend_floor | client_total_spent ≥ $1,000 | "Client Low spending" |
| 6 | 6_client_rating_floor | client_rating ≥ 4.0 (or null with 0 hires) | "Bad rating client" |
| 7 | 7_job_availability | Posting open, not "filled"/"closed"/"hired" | "Job unavailable" or "Already hired" |
| 8 | 8_no_location_lockin | No country-residency requirement | "Location loc" |
| 9 | 9_no_video_proposal | No required recorded video pitch | "Video Proposal" |
| 10 | 10_portfolio_match | Profile has portfolio item mappable to job stack | "Portfolio unavailable" |
| 11 | 11_no_duplicate | Job not seen in last 30 days | "Duplicate" |

## REASON LABEL ENUM (USE EXACTLY — typos and shorthand are intentional)

["Out of stack", "Old job", "Too many invites", "Low Higher rate", "Location loc",
 "Client Low spending", "Job unavailable", "Already hired", "Language barrier",
 "Bad rating client", "Video Proposal", "Duplicate", "Portfolio unavailable"]

## RUBRIC (only when all gates pass)

skill_match (max 30):       depth in past work, not keyword listing
portfolio_evidence (max 20): concrete portfolio item mirroring job needs
client_quality (max 15):    spend × hires × rating gradient
competition_position (max 10): proposals × freshness × niche depth
domain_match (max 10):      industry alignment with prior work
experience_level_fit (max 10): job seniority vs profile JSS/rate
red_flags (max 5):           higher = fewer flags

TIERS: 80-100 apply_now, 60-79 strong, 40-59 marginal, 0-39 skip

## EVIDENCE LIBRARY (anchored — calibrate against these)

{{ pasted contents of PRD §16 Appendix C `reject_examples` and `proceed_examples` arrays }}

## RULES

- Be skeptical. Save the freelancer's time.
- Cite specific evidence from the input in every gate's `evidence` field.
- Generic proposal angles are useless. Reference specific portfolio items or prior projects from the profile.
- Output ONLY JSON matching the schema. No markdown, no commentary.
- If multiple gates fail, list ALL their labels in rejection_reasons.
```

**Token budget for systemInstruction**: ~7,000 tokens (5,500 example library + 1,500 rules). Cached after first call.

### 5.4 Output schema (`responseSchema`)

```json
{
  "type": "object",
  "required": ["decision", "gates", "rejection_reasons", "confidence", "criteria_version", "prompt_version"],
  "properties": {
    "decision": { "type": "string", "enum": ["proceed", "reject", "review"] },
    "rejection_reasons": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "Out of stack","Old job","Too many invites","Low Higher rate","Location loc",
          "Client Low spending","Job unavailable","Already hired","Language barrier",
          "Bad rating client","Video Proposal","Duplicate","Portfolio unavailable"
        ]
      }
    },
    "gates": {
      "type": "object",
      "properties": {
        "1_stack_match":           { "$ref": "#/$defs/gate" },
        "2_freshness":             { "$ref": "#/$defs/gate" },
        "3_proposal_saturation":   { "$ref": "#/$defs/gate" },
        "4_hourly_floor":          { "$ref": "#/$defs/gate" },
        "5_client_spend_floor":    { "$ref": "#/$defs/gate" },
        "6_client_rating_floor":   { "$ref": "#/$defs/gate" },
        "7_job_availability":      { "$ref": "#/$defs/gate" },
        "8_no_location_lockin":    { "$ref": "#/$defs/gate" },
        "9_no_video_proposal":     { "$ref": "#/$defs/gate" },
        "10_portfolio_match":      { "$ref": "#/$defs/gate" },
        "11_no_duplicate":         { "$ref": "#/$defs/gate" }
      }
    },
    "components": {
      "type": ["object","null"],
      "properties": {
        "skill_match":           { "$ref": "#/$defs/component", "max": 30 },
        "portfolio_evidence":    { "$ref": "#/$defs/component", "max": 20 },
        "client_quality":        { "$ref": "#/$defs/component", "max": 15 },
        "competition_position":  { "$ref": "#/$defs/component", "max": 10 },
        "domain_match":          { "$ref": "#/$defs/component", "max": 10 },
        "experience_level_fit":  { "$ref": "#/$defs/component", "max": 10 },
        "red_flags":             { "$ref": "#/$defs/component", "max": 5 }
      }
    },
    "total_score":      { "type": ["integer","null"], "minimum": 0, "maximum": 100 },
    "tier":             { "type": ["string","null"], "enum": ["apply_now","strong","marginal","skip","reject"] },
    "confidence":       { "type": "number", "minimum": 0, "maximum": 1 },
    "proposal_angles":  { "type": "array", "items": {"type":"string"}, "minItems": 0, "maxItems": 3 },
    "summary":          { "type": "string", "maxLength": 600 },
    "missing_signals":  { "type": "array", "items": {"type":"string"} },
    "criteria_version": { "type": "string" },
    "prompt_version":   { "type": "string" }
  },
  "$defs": {
    "gate": {
      "type": "object",
      "required": ["status", "evidence"],
      "properties": {
        "status":       { "type": "string", "enum": ["pass","fail","skipped_deterministic"] },
        "evidence":     { "type": "string", "maxLength": 200 }
      }
    },
    "component": {
      "type": "object",
      "required": ["value","max","reason"],
      "properties": {
        "value":  { "type": "integer" },
        "max":    { "type": "integer" },
        "reason": { "type": "string", "maxLength": 200 }
      }
    }
  }
}
```

### 5.5 Concrete example — input + output

**Input** (the per-job user message):

```json
{
  "profile": {
    "name": "Sana",
    "stack_bucket": ["Laravel","PHP","Node.js","React.js","Vue.js","SaaS","NestJS","WordPress","Next.js","TypeScript"],
    "portfolio_tldr": [
      "Stripe + Laravel subscription billing",
      "Multi-tenant SaaS auth in NestJS",
      "Headless WordPress + Next.js storefront"
    ],
    "headline": "Senior Full-Stack Engineer — Laravel, NestJS, AI integrations",
    "hourly_rate": 65,
    "jss_score": 98,
    "top_rated": true
  },
  "job": {
    "job_id": "~01abc123",
    "title": "Build Laravel Stripe integration for SaaS billing",
    "description": "We need a senior dev to integrate Stripe subscriptions into our existing Laravel app...",
    "skills_required": ["Laravel","Stripe","PHP","API"],
    "budget_type": "hourly",
    "budget_min": 35, "budget_max": 60,
    "client_country": "United States",
    "client_total_spent": 18355,
    "client_hires": 26,
    "client_rating": 4.97,
    "proposals_count": 12,
    "posted_at": "2026-05-06T08:14:00Z",
    "url": "https://upwork.com/jobs/..."
  },
  "deterministic": {
    "passed": ["2_freshness","3_proposal_saturation","4_hourly_floor","5_client_spend_floor","6_client_rating_floor","11_no_duplicate"],
    "failed": [],
    "pending_for_llm": ["1_stack_match","7_job_availability","8_no_location_lockin","9_no_video_proposal","10_portfolio_match"]
  }
}
```

**Output** (Gemini Flash 2.5 verdict):

```json
{
  "decision": "proceed",
  "rejection_reasons": [],
  "gates": {
    "1_stack_match":         { "status": "pass", "evidence": "job needs Laravel + Stripe + API; profile lists Laravel and has Stripe billing portfolio" },
    "2_freshness":           { "status": "skipped_deterministic", "evidence": "checked by N2" },
    "3_proposal_saturation": { "status": "skipped_deterministic", "evidence": "checked by N2" },
    "4_hourly_floor":        { "status": "skipped_deterministic", "evidence": "checked by N2" },
    "5_client_spend_floor":  { "status": "skipped_deterministic", "evidence": "checked by N2" },
    "6_client_rating_floor": { "status": "skipped_deterministic", "evidence": "checked by N2" },
    "7_job_availability":    { "status": "pass", "evidence": "no 'filled' or 'closed' indicators in description" },
    "8_no_location_lockin":  { "status": "pass", "evidence": "no US-only or residency requirement in description" },
    "9_no_video_proposal":   { "status": "pass", "evidence": "no video/loom mention" },
    "10_portfolio_match":    { "status": "pass", "evidence": "Stripe + Laravel subscription billing portfolio item is direct match" },
    "11_no_duplicate":       { "status": "skipped_deterministic", "evidence": "checked by N2" }
  },
  "components": {
    "skill_match":          { "value": 28, "max": 30, "reason": "Laravel + Stripe both in stack and demonstrated in past work" },
    "portfolio_evidence":   { "value": 20, "max": 20, "reason": "Stripe + Laravel subscription billing portfolio is exact mirror" },
    "client_quality":       { "value": 14, "max": 15, "reason": "client_spent $18k, 26 hires, rating 4.97 — strong" },
    "competition_position": { "value": 8,  "max": 10, "reason": "12 proposals at <2h fresh — manageable" },
    "domain_match":         { "value": 9,  "max": 10, "reason": "SaaS billing aligns with prior multi-tenant SaaS work" },
    "experience_level_fit": { "value": 9,  "max": 10, "reason": "Senior dev request matches JSS 98 and $65/hr rate" },
    "red_flags":            { "value": 5,  "max": 5,  "reason": "specific scope, clear stack, no template feel" }
  },
  "total_score": 93,
  "tier": "apply_now",
  "confidence": 0.91,
  "proposal_angles": [
    "Lead with the Stripe + Laravel subscription billing portfolio piece — direct match",
    "Reference multi-tenant SaaS auth experience to signal you understand billing scoping",
    "Quote a 2-week MVP timeline with webhook + retry handling already implemented"
  ],
  "summary": "Strong direct match on Stripe + Laravel with portfolio evidence and a high-quality client. Apply with the Stripe billing piece as the lead.",
  "missing_signals": ["client_payment_verified"],
  "criteria_version": "0.2",
  "prompt_version": "v1"
}
```

### 5.6 Token optimization

| Lever | Saving |
|---|---|
| Cache system instruction (~7k tokens) via Gemini implicit caching | -75% input cost on calls 2..N |
| Send profile_tldr (~300 tokens) instead of full profile JSON (~2000) | -25% input |
| Truncate job description to first 1500 chars before sending | -15% input |
| Skip rubric components in output when `decision: reject` | -200 tokens output |
| Hard-fail short-circuit by N2 (no LLM call at all) | -100% on ~60% of rejected jobs |

Combined effect: ~80% input cost reduction vs naive implementation.

---

## 6. New n8n Nodes

### 6.1 Why no custom-code n8n nodes are needed

All 10 new nodes (N1–N10) compose from stock n8n building blocks: `httpRequest`, `code`, `if`, `switch`, `set`, `langchain.agent` + `langchain.lmChatGoogleGemini` + `langchain.outputParserStructured`. **No `.n8n-nodes-*` package needs to be authored.**

### 6.2 Node config snippets (production-ready JSON for n8n MCP `n8n_update_partial_workflow`)

#### N1 — Load Profile Context

```json
{
  "name": "Load Profile Context",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "GET",
    "url": "=http://157.173.110.62/api/profiles/{{ $json.profile_id }}/context",
    "authentication": "headerAuth",
    "options": {
      "timeout": 3000,
      "retry": { "maxRetries": 2, "retryWait": 500 }
    }
  },
  "credentials": {
    "httpHeaderAuth": { "id": "BOARD_API_BEARER", "name": "Board API Bearer" }
  }
}
```

#### N2 — Deterministic Pre-check (Code, JS)

```javascript
// Inputs: $json.job, $json.profile (from N1)
const job = $json.job;
const profile = $json.profile;
const now = Date.now();

const result = { passed: [], failed: [], pending_for_llm: [], reasons: [] };

// Gate 2: freshness
const postedMs = Date.parse(job.posted_at);
if (!postedMs || (now - postedMs) > 24 * 3600 * 1000) {
  result.failed.push("2_freshness");
  result.reasons.push("Old job");
} else {
  result.passed.push("2_freshness");
}

// Gate 3: proposal saturation
if (typeof job.proposals_count === "number" && job.proposals_count >= 30) {
  result.failed.push("3_proposal_saturation");
  result.reasons.push("Too many invites");
} else {
  result.passed.push("3_proposal_saturation");
}

// Gate 4: hourly floor (only when budget is structured hourly)
if (job.budget_type === "hourly" && typeof job.budget_min === "number") {
  if (job.budget_min < 25) {
    result.failed.push("4_hourly_floor");
    result.reasons.push("Low Higher rate");
  } else {
    result.passed.push("4_hourly_floor");
  }
} else {
  result.pending_for_llm.push("4_hourly_floor"); // budget needs LLM parse
}

// Gate 5: client spend floor
if (typeof job.client_total_spent === "number" && job.client_total_spent < 1000) {
  result.failed.push("5_client_spend_floor");
  result.reasons.push("Client Low spending");
} else {
  result.passed.push("5_client_spend_floor");
}

// Gate 6: client rating floor
const rating = job.client_rating;
const hires = job.client_hires ?? 0;
if (rating !== null && rating !== undefined && rating < 4.0 && hires > 0) {
  result.failed.push("6_client_rating_floor");
  result.reasons.push("Bad rating client");
} else {
  result.passed.push("6_client_rating_floor");
}

// Gate 11: duplicate (already enforced by webhook intake; trust upstream)
result.passed.push("11_no_duplicate");

// LLM-only gates
result.pending_for_llm.push("1_stack_match", "7_job_availability", "8_no_location_lockin", "9_no_video_proposal", "10_portfolio_match");

return [{ json: { ...$json, deterministic: result } }];
```

#### N5 — AI Agent — Relevancy Classifier (langchain.agent v3.1)

```json
{
  "name": "AI Agent — Relevancy Classifier",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 3.1,
  "parameters": {
    "promptType": "define",
    "text": "={{ $json.input_text }}",
    "hasOutputParser": true,
    "options": {
      "systemMessage": "{{ $vars.RELEVANCY_SYSTEM_PROMPT }}",
      "maxIterations": 1
    }
  }
}
```

Sub-nodes:

```json
// Gemini Flash 2.5
{
  "name": "Gemini Flash 2.5 Model",
  "type": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
  "typeVersion": 1,
  "parameters": {
    "modelName": "models/gemini-2.5-flash",
    "options": {
      "temperature": 0.15,
      "maxOutputTokens": 1500,
      "topP": 0.9,
      "responseMimeType": "application/json"
    }
  },
  "credentials": { "googleAiApi": { "id": "GEMINI_API_KEY", "name": "Gemini API" } }
}

// Structured Output Parser
{
  "name": "Relevancy Output Parser",
  "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
  "typeVersion": 1.2,
  "parameters": {
    "schemaType": "manual",
    "inputSchema": "{{ $vars.RELEVANCY_OUTPUT_SCHEMA }}"
  }
}
```

#### N8 — Decision Switch

```json
{
  "name": "Decision Switch",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "parameters": {
    "rules": {
      "values": [
        { "outputKey": "reject",  "conditions": { "string": [{ "value1": "={{ $json.decision }}", "operation": "equals", "value2": "reject" }] } },
        { "outputKey": "review",  "conditions": { "string": [{ "value1": "={{ $json.decision }}", "operation": "equals", "value2": "review" }] } },
        { "outputKey": "proceed", "conditions": { "string": [{ "value1": "={{ $json.decision }}", "operation": "equals", "value2": "proceed" }] } }
      ],
      "fallbackOutput": "review"
    }
  }
}
```

---

## 7. Data Schema

### 7.1 New Postgres tables (Migration 017)

```sql
-- New: per-profile stack bucket (PRD §10.1 Option B)
CREATE TABLE profile_stacks (
  id           SERIAL PRIMARY KEY,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  keyword      TEXT NOT NULL,
  alias_for    TEXT,
  added_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, keyword)
);
CREATE INDEX idx_profile_stacks_keyword ON profile_stacks (LOWER(keyword));

-- New: per-profile portfolio (gate 10 + rubric portfolio_evidence)
CREATE TABLE profile_portfolios (
  id           SERIAL PRIMARY KEY,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  tech_stack   TEXT[],
  url          TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profile_portfolios_profile ON profile_portfolios (profile_id);

-- New: relevancy classification audit log
CREATE TABLE relevancy_scores (
  id                BIGSERIAL PRIMARY KEY,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  job_external_id   TEXT,
  profile_id        UUID REFERENCES profiles(id),
  decision          TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),
  rejection_reasons TEXT[],
  gates_passed      INTEGER[],
  gates_failed      INTEGER[],
  components        JSONB,
  total_score       INTEGER,
  tier              TEXT,
  confidence        NUMERIC(4,3),
  proposal_angles   TEXT[],
  ai_relevant       BOOLEAN,
  ai_score          NUMERIC(4,3),
  heuristic         JSONB,
  summary           TEXT,
  missing_signals   TEXT[],
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  criteria_version  TEXT NOT NULL,
  evaluation_path   TEXT NOT NULL CHECK (evaluation_path IN ('deterministic','llm','llm_after_deterministic')),
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  evaluated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_relevancy_scores_task        ON relevancy_scores (task_id);
CREATE INDEX idx_relevancy_scores_profile     ON relevancy_scores (profile_id, evaluated_at DESC);
CREATE INDEX idx_relevancy_scores_decision    ON relevancy_scores (decision);
CREATE INDEX idx_relevancy_scores_evaluated   ON relevancy_scores (evaluated_at DESC);
```

### 7.2 `tasks.custom_fields` extensions (no schema change)

```jsonc
{
  "_relevancy_decision":  "proceed | reject | review",
  "_relevancy_score":     78,
  "_relevancy_tier":      "strong",
  "_relevancy_reasons":   ["Out of stack"],
  "_relevancy_confidence":0.91,
  "_proposal_angles":     ["...","...","..."],
  "_relevancy_summary":   "...",
  "_criteria_version":    "0.2",
  "_prompt_version":      "v1",
  "_evaluation_path":     "llm_after_deterministic"
}
```

These are written by the existing `Format ClickUp Task` node when `_column ∈ {N/A, Todo, Proposal Submitted}` — the same node sinks all three paths.

### 7.3 New API endpoints

```
GET  /api/profiles/:id/context
     Returns: { profile: { stack_bucket[], portfolio_tldr[], headline, hourly_rate, jss_score, top_rated },
                criteria_version: "0.2",
                thresholds_overrides: { ... }  // per-profile, for PRD §11 Q1
              }
     Auth: Bearer 'n8n-board-sync'

POST /api/relevancy-scores
     Body: full classifier output + path metadata + token counts + latency
     Action: insert into relevancy_scores
     Auth: Bearer 'n8n-board-sync'

GET  /api/relevancy-scores/accuracy
     Query: ?from=2026-05-06&to=2026-05-13&profile_id=...
     Returns: { classifier_reject_count, agent_n_a_count, agreement_rate, by_gate: {...} }
     Auth: admin session
```

### 7.4 Dashboard payload changes

The existing `Format Dashboard Event` node populates `scores.aiRelevant`, `scores.aiScore`, `scores.heuristic` (currently null) with classifier output:

```json
{
  ...
  "scores": {
    "aiRelevant": true,
    "aiScore": 0.91,
    "heuristic": {
      "gates_passed": [1,2,3,4,5,6,7,8,9,10,11],
      "gates_failed": [],
      "tier": "apply_now",
      "evaluation_path": "llm_after_deterministic"
    }
  }
}
```

---

## 8. Performance + Cost Considerations

### 8.1 Volume baseline

Per CLAUDE.md and PRD §6.1: 1612 total tasks lifetime; ~40 jobs/day pipeline-wide today, with capacity for ~400/day. We size for 400/day = 12,000/month.

### 8.2 Cost math (Gemini 2.5 Flash, 2026 pricing)

| Path | % of jobs | LLM call? | Cost/call (cached) | Cost/day @ 400 |
|---|---|---|---|---|
| Deterministic reject (N2 fails) | ~35% | No | $0 | $0 |
| LLM reject (N5 finds gate fail) | ~25% | Yes | $0.0006 | $0.060 |
| LLM proceed | ~35% | Yes | $0.0008 (longer output) | $0.112 |
| LLM review | ~5% | Yes | $0.0007 | $0.014 |
| **Total** | **100%** | — | — | **$0.186/day → ~$5.6/month** |

Without caching: ~$0.0025/call avg → $1.00/day → $30/month.
Without deterministic pre-filter: +50% calls → $0.28/day → $8.4/month.

### 8.3 Latency budget

| Stage | Target p95 | Budget | Notes |
|---|---|---|---|
| N1 Load Profile Context | 200ms | OK if cached in n8n static data | 1h TTL |
| N2 Deterministic Pre-check | 50ms | Pure JS | — |
| N5 Gemini Flash 2.5 call | 800ms | Sub-1s typical | Streaming disabled, JSON mode |
| N6 Validate | 30ms | Pure JS | — |
| N7-N10 Build/persist | 200ms each | HTTP to Contabo | — |
| **End-to-end (proceed path)** | **~1.3s** | **<2s budget per PRD §10.4** | Adds ~1s to existing flow |

This pushes the existing 5–20s end-to-end from §10.4 to ~6–21s — within budget. The actual p95 is Vollna-bound (memory: `latency_vollna_bound.md` shows p50=2min, p95=10min).

### 8.4 Throughput

Gemini Flash 2.5 default rate limit on AI Studio: 1000 RPM, 1M tokens/min. We're nowhere near this. n8n cloud workflow can handle ~10 RPS — also fine.

### 8.5 Observability hooks

| Signal | Source | Surface |
|---|---|---|
| Per-call token count | N6 → relevancy_scores.input_tokens/output_tokens | Daily cost dashboard tile |
| Per-call latency | N6 → relevancy_scores.latency_ms | Latency p95 chart |
| Gate fail rate per profile per week | `SELECT profile_id, gates_failed, COUNT(*) FROM relevancy_scores GROUP BY ...` | Admin view |
| Classifier accuracy | Compare `relevancy_scores.decision='reject'` vs subsequent task column = N/A | `/api/relevancy-scores/accuracy` |
| Manual override rate | tasks where classifier proceed → agent moved to N/A within 24h | Same endpoint |
| Gemini error rate | n8n execution-log filter on N5 failures | n8n-mcp `n8n_executions` |

### 8.6 Failure modes & blast radius

| Failure | Blast | Mitigation |
|---|---|---|
| Gemini API down | All proceed-path jobs queue up | N5 retries 3×; on final failure → review queue (no silent loss) |
| N1 profile fetch 503 | Classifier has stale profile data | n8n static data cache, 1h TTL |
| Gemini returns malformed JSON | Schema validation fails | N6 retries once; second fail → review queue |
| Schema drift after Gemini model update | Wrong field types | Pin `modelName` to exact version `gemini-2.5-flash`; alert on schema mismatch in N6 |
| PRD changes (new gate added) | Classifier doesn't know new gate | `criteria_version` mismatch → automatic alert; rerun calibration |
| Per-profile threshold override missing | Default thresholds applied | Soft fallback; logged in `relevancy_scores.evaluation_path` |

---

## 9. Future Enhancements

### 9.1 Phase-2 (post-launch)

| # | Enhancement | Trigger | Dependency |
|---|---|---|---|
| 1 | **Per-profile threshold tuning** | After 4 weeks of `relevancy_scores` data per profile | PRD §11 Q1, Q3 |
| 2 | **Active calibration loop** | Continuous | New `outcomes` table from v1 §schema; needs PRD §9.3 fix (proceed flow keeps n8n metadata) |
| 3 | **Vollna feed auto-tightening** | When gate 1 fail rate > 30% for a profile-week | PRD §10.6 |
| 4 | **Profile portfolio extraction from HTML** | When team wants automated portfolio updates | v1 §Phase 1 (deferred) |
| 5 | **Manager override path** | Open Q in PRD §11 Q2 | UI + audit log columns |
| 6 | **Hot-reload PRD without redeploy** | After 6+ months of frequent threshold edits | Move criteria + few-shot to DB rows; N1 fetches them |
| 7 | **A/B prompt versions in production** | When tuning rubric weights | Random 10% to v_next; compare outcomes |
| 8 | **Wire dead Switch branches** (`inactive`, `duplicate`, `weekend`) | If business adds business-hours / dedup logic | Currently dead; classifier could populate them |

### 9.2 Out of v2 scope

- Replacing the Proposal Writer (still Claude Haiku 4.5)
- Cross-platform support (Freelancer, Fiverr) — PRD is Upwork-only
- Live Upwork scraping (Cloudflare-protected; v1 §Phase 1 already flagged as fragile)
- Multi-LLM ensemble (Gemini Flash 2.5 alone is enough at this volume)
- Embedding-based similarity (gate 10 portfolio match could use embeddings, but lexical + LLM works at this scale)

---

## Appendix A — Open Questions Inherited from PRD

These are decisions the team needs to make BEFORE running migration 017:

1. **Per-profile threshold storage**: One row in `profiles.thresholds JSONB` vs new `profile_thresholds` table? (PRD §11 Q1)
2. **Manager override flow**: Should a low-confidence proceed get a "manager approve" button before reaching Proposal Writer? (PRD §11 Q2)
3. **Freshness window**: 24h is killing Saim and Rebekah's pipelines (90%+ "Old job" rejects). Per-profile override or a Vollna feed-cadence fix? (PRD §11 Q3)
4. **`Bad rating client` + `Client Low spending` merge**: Combine into a single "Risk" gate? (PRD §11 Q4)
5. **Reason label typos**: Migrate `"Low Higher rate"` → `"Low Hourly Rate"` and `"Location loc"` → `"Location restriction"` BEFORE shipping classifier (so the enum is clean), or AFTER (so historical data stays unified)? (PRD §9.2)
6. **Idle profile (Nawal)**: Skip classifier for inactive profiles, or always run? (PRD §9.6)
7. **API key**: Google AI Studio (simpler) vs Vertex AI (enterprise IAM, regional pinning)?

---

## Appendix B — Build Order

Follows the PRD §12 rollout phases, with v2 additions:

| Phase | Scope | Owner | Effort | Done when |
|---|---|---|---|---|
| **0. PRD freeze** | Lock PRD v0.2 thresholds; resolve Appendix A questions | Waqas + leads | — | Sign-off |
| **1. Migration 017** | `profile_stacks`, `profile_portfolios`, `relevancy_scores` tables | Dashboard team | 2h | Migration runs idempotently on Contabo |
| **2. Profile context endpoint** | `GET /api/profiles/:id/context` | Dashboard team | 3h | Returns valid JSON for all 8 profiles |
| **3. Stack bucket seeding** | Backfill `profile_stacks` from Vollna configs (current source-of-truth lives off-DB) | Waqas + dashboard | 2h | All 8 profiles have keywords loaded |
| **4. Portfolio seeding** | Manual entry of 5-10 portfolio items per profile | Profile owners | 4h | Each profile has portfolio rows |
| **5. Static prompt + few-shot file** | Generate the system instruction + paste PRD §16 → save as n8n env var `RELEVANCY_SYSTEM_PROMPT` | n8n-workflow-keeper | 2h | Variable set in n8n cloud |
| **6. n8n nodes N1-N10 added** | `n8n_update_partial_workflow` per blueprint in §6.2 | n8n-workflow-keeper | 4h | Validation green; test with mock job |
| **7. Manual scoring smoke test** | Replay 20 existing N/A tasks through classifier in test mode | Waqas | 2h | ≥85% agreement with agent reasons |
| **8. Shadow mode rollout** | Live traffic, classifier writes to log only — does NOT reroute cards | n8n-workflow-keeper | 1 week | 7 days × 8 profiles of `relevancy_scores` rows |
| **9. Calibration review** | Audit shadow data; tune per-profile thresholds | Waqas | 1 day | Threshold doc updated |
| **10. Active mode rollout** | Connect N3/N8 outputs to `Format ClickUp Task`; classifier reroutes cards | n8n-workflow-keeper | 1h | First N/A card auto-created with reason |
| **11. Dashboard accuracy tile** | `/api/relevancy-scores/accuracy` + UI | Dashboard team | 4h | Tile live on admin dashboard |

**Total**: ~3 working days for engineering effort, gated by PRD freeze and ~1 week of shadow-mode observation.

---

## Document conventions

- **Gate IDs** match PRD §7 row order verbatim. Never renumber.
- **Reason labels** are quoted verbatim from PRD §6.2 (typos preserved). Migrating them is a separate workstream (§9.2).
- **Versions**: `criteria_version` tracks PRD revision; `prompt_version` tracks system-instruction revision; both must be stored on every `relevancy_scores` row.
- **Profile IDs** are UUIDs from the `profiles` table — not display names. Names like "Sana" appear only in human-readable fields.
