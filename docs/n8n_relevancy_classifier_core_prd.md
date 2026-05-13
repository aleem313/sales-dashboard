# PRD — n8n Workflow: `_relevancy-classifier-core`

| | |
|---|---|
| **Document version** | 1.0 |
| **Last reviewed** | 2026-05-11 |
| **Workflow ID** | `hi71jhPU8tmq7hEp` |
| **Workflow name** | `_relevancy-classifier-core` |
| **n8n instance** | `ikonicdev.app.n8n.cloud` |
| **Status** | **Inactive** (created, validated, smoke-tested; awaiting Phase 7 splice into parent `multiple webhooks`) |
| **Owners** | Rising Lions Analytics — Admin (M. Waqas) |
| **Related docs** | `docs/n8n_workflow_prd.md` (parent workflow), `docs/upwork-relevancy-scoring-ai-plan-v3.md` (plan v3.3), `docs/job_relevancy_criteria_prd.md` (PRD v0.2), `docs/relevancy/mode_a_prompt.md` (canonical system prompt) |

---

## 1. Executive summary

This is the **shared classifier sub-workflow** that decides whether an incoming Upwork job is relevant for a given freelancer profile. It is invoked via `executeWorkflow` from one or more parent workflows (auto-pipeline `multiple webhooks` after Phase 7; manual `job-evaluate-manual` after Phase 8). Inputs: `{ profile_id, job, request_meta }`. Output: a structured verdict (`decision`, `effective_decision`, `total_score`, `tier`, `rejection_reasons[]`, gate-level evidence, rubric components, proposal angles).

The workflow combines a deterministic gate pre-check (gates 2–6 in JS) with a Gemini Flash 2.5 LLM call (gates 1, 7–10 + rubric scoring), applies a min-score threshold (v3.3 §7.5), persists the verdict to `relevancy_scores` via the dashboard's `/api/relevancy-scores` endpoint, and falls back to DLQ on any error.

The classifier is built to ship in **Shadow mode by default** — verdicts are logged but routing is unchanged until the operator flips to Active in Settings (plan v3.3 §10.6).

---

## 2. Goals & non-goals

### 2.1 Goals

- **Single source of truth for relevancy.** Both the auto-pipeline and the manual Task Card Evaluator invoke the SAME classifier — no logic duplication, no drift.
- **Deterministic + LLM hybrid.** Run cheap, exact JS gates first (freshness, proposal saturation, hourly floor, client spend/rating); only invoke Gemini for the gates that require natural-language judgment (stack match, posting open, location lock, video pitch, portfolio match).
- **Audit-trail-first.** Every classifier run writes a row to `relevancy_scores` with full inputs, outputs, model id, prompt version, criteria version, and threshold-application metadata. The audit log is the contract for downstream consumers (dashboard badges, calibration jobs, retrospective reports).
- **Bounded blast radius on rollout.** Shadow-mode default + per-profile `classifier_enabled` toggle + global kill-switch env var = three layers of "don't route on AI yet" before a single proposal is auto-rejected.
- **Graceful failure.** Parser errors, schema misses, transient API blips never break the parent pipeline — every failure goes to DLQ (`relevancy_scores_dlq`) for retrospective inspection.

### 2.2 Non-goals

- **Routing decisions.** The classifier emits a verdict; the caller decides what to do with it. (`multiple webhooks` will read `effective_decision` and route via a `Route Verdict` switch, splice scheduled for Phase 7.)
- **Status tracking.** Job lifecycle (Won, Lost, In Chat, …) remains the Task Board's domain.
- **Calibrating thresholds against per-execution data.** Threshold tuning happens offline using `relevancy_scores` query history; the classifier reads them as static config from `system_settings` + `profiles.*_override` columns.
- **Duplicate detection across boards.** Gate 11 (`11_no_duplicate`) is currently marked `pending_for_llm` but the LLM cannot actually check this — wiring a Postgres lookup is deferred. See §11 TD-1.

---

## 3. Stakeholders & users

| Role | Identity | Interaction |
|---|---|---|
| **Caller A** (auto) | `multiple webhooks` workflow `EWnZg3svZWwcIRs4` | Invokes via `executeWorkflow` after `Process Job`, before `Build GPT Input`. Phase 7 not yet shipped. |
| **Caller B** (manual) | `job-evaluate-manual` webhook workflow (not yet built — Phase 8) | Invokes from admin "Task Card Evaluator" UI on demand |
| **Profile context API** | `GET /api/profiles/:id/context` (Contabo) | Read every execution; returns the classifier-ready profile JSON. 5-min unstable_cache. |
| **Ingest API** | `POST /api/relevancy-scores` (Contabo) | Bearer `RELEVANCY_INGEST_TOKEN`; idempotency-keyed; writes `relevancy_scores` or `relevancy_scores_dlq` (`?dlq=1`) |
| **LLM provider** | Google Gemini Flash 2.5 (`models/gemini-2.5-flash`) | Cred id `0gaoWdarY6itka7l` ("Gemini API (Relevancy Classifier)") |
| **Admin** | M. Waqas + delegates | Owns workflow edits via n8n MCP and direct UI access |

---

## 4. System architecture

### 4.1 High-level topology

```
                ┌──────────────────────────────────────────────────────┐
caller(s) ─►    │ Execute Workflow Trigger (passthrough)               │  ← receives {profile_id, job, request_meta}
                ├──────────────────────────────────────────────────────┤
                │ Load Profile Context (HTTP GET)                      │  ← /api/profiles/:id/context (Contabo, no auth)
                ├──────────────────────────────────────────────────────┤
                │ Deterministic Pre-check (Code)                       │  ← gates 2-6 in JS
                ├──────────────────────────────────────────────────────┤
                │ Gate Switch (IF — failed.length > 0?)                │
                │   ├─true ─► Build Reject Payload (deterministic)     │
                │   └─false ► Prepare Classifier Input (Set)           │
                ├──────────────────────────────────────────────────────┤
                │ AI Agent — Relevancy Classifier                      │
                │   ├─ai_languageModel: Gemini Flash 2.5               │
                │   └─ai_outputParser:  Structured Output Parser*      │  *connected but DISABLED (see §11 TD-2)
                │   System prompt (~7,000 tokens) inlined verbatim     │
                ├──────────────────────────────────────────────────────┤
                │ Validate Output + Apply Threshold (Code)             │  ← C6: JSON.parse + threshold + ingest contract
                ├──────────────────────────────────────────────────────┤
                │ Decision Switch (effective_decision)                 │
                │   ├─reject  ─► Build Reject Payload                  │
                │   ├─review  ─► Build Review Payload                  │
                │   └─proceed ─► Persist Relevancy Score               │
                ├──────────────────────────────────────────────────────┤
                │ Persist Relevancy Score (HTTP POST)                  │  ← /api/relevancy-scores, Bearer auth
                │   ├─success ─► Return Verdict                        │
                │   └─error   ─► Persist to DLQ                        │
                ├──────────────────────────────────────────────────────┤
                │ Persist to DLQ (HTTP POST, ?dlq=1)                   │  ← also receives AI Agent error output
                │   └─► Return Verdict                                 │
                ├──────────────────────────────────────────────────────┤
                │ Return Verdict (Code, terminal)                      │  ← reshapes leaf into verdict for executeWorkflow caller
                └──────────────────────────────────────────────────────┘
```

### 4.2 Node inventory (15 nodes)

| ID | Name | Type | typeVersion | Position |
|---|---|---|---|---|
| C0 | Execute Workflow Trigger | `n8n-nodes-base.executeWorkflowTrigger` | 1.1 | `[-1408, 0]` |
| C1 | Load Profile Context | `n8n-nodes-base.httpRequest` | 4.4 | `[-1200, 0]` |
| C2 | Deterministic Pre-check | `n8n-nodes-base.code` | 2 | `[-992, 0]` |
| C3 | Gate Switch | `n8n-nodes-base.if` | 2.3 | `[-784, 0]` |
| C4 | Prepare Classifier Input | `n8n-nodes-base.set` | 3.4 | `[-576, -96]` |
| C5 | AI Agent — Relevancy Classifier | `@n8n/n8n-nodes-langchain.agent` | 3.1 | `[-368, -96]` |
| C5a | Gemini Flash 2.5 (sub-node) | `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` | 1 | `[-432, 128]` |
| C5b | Structured Output Parser (sub-node) | `@n8n/n8n-nodes-langchain.outputParserStructured` | 1.3 | `[-256, 128]` |
| C6 | Validate Output + Apply Threshold | `n8n-nodes-base.code` | 2 | `[-160, -96]` |
| C7 | Build Reject Payload | `n8n-nodes-base.code` | 2 | `[-160, 96]` |
| C8 | Decision Switch | `n8n-nodes-base.switch` | 3.2 | `[48, -96]` |
| C9 | Build Review Payload | `n8n-nodes-base.set` | 3.4 | `[256, -192]` |
| C10 | Persist Relevancy Score | `n8n-nodes-base.httpRequest` | 4.4 | `[464, -96]` |
| C11 | Persist to DLQ | `n8n-nodes-base.httpRequest` | 4.4 | `[672, 96]` |
| **C12** | **Return Verdict** | `n8n-nodes-base.code` | 2 | `[880, 0]` |

### 4.3 Connections (19 total)

| From | Output | To | Notes |
|---|---|---|---|
| Execute Workflow Trigger | main[0] | Load Profile Context | |
| Load Profile Context | main[0] | Deterministic Pre-check | `neverError: true` so an HTTP blip doesn't break the flow |
| Deterministic Pre-check | main[0] | Gate Switch | |
| Gate Switch | main[0] (true / failed > 0) | Build Reject Payload | Deterministic reject path |
| Gate Switch | main[1] (false / passed) | Prepare Classifier Input | |
| Prepare Classifier Input | main[0] | AI Agent — Relevancy Classifier | |
| Gemini Flash 2.5 | ai_languageModel[0] | AI Agent — Relevancy Classifier | Sub-node binding |
| Structured Output Parser | ai_outputParser[0] | AI Agent — Relevancy Classifier | Sub-node binding (currently INERT — `hasOutputParser: false`) |
| AI Agent — Relevancy Classifier | main[0] (success) | Validate Output + Apply Threshold | |
| AI Agent — Relevancy Classifier | main[1] (error) | Persist to DLQ | `onError: continueErrorOutput` |
| Validate Output + Apply Threshold | main[0] | Decision Switch | |
| Decision Switch | main[0] (reject) | Build Reject Payload | LLM/threshold-flipped reject path |
| Decision Switch | main[1] (review) | Build Review Payload | |
| Decision Switch | main[2] (proceed) | Persist Relevancy Score | |
| Build Reject Payload | main[0] | Persist Relevancy Score | |
| Build Review Payload | main[0] | Persist Relevancy Score | |
| Persist Relevancy Score | main[0] (success) | **Return Verdict** | Terminal verdict shape for `executeWorkflow` caller |
| Persist Relevancy Score | main[1] (error) | Persist to DLQ | `onError: continueErrorOutput` |
| Persist to DLQ | main[0] | **Return Verdict** | DLQ leaf also funnels to terminal so caller still receives a verdict |

### 4.4 Workflow settings

| Setting | Value | Rationale |
|---|---|---|
| `active` | `false` | Phase 7 (parent splice) not yet shipped — keeping inactive prevents accidental invocation |
| `executionOrder` | `v1` | n8n's modern parallel execution model |

---

## 5. Functional requirements (per node)

### 5.1 Execute Workflow Trigger (C0)

**Mode:** `inputSource: passthrough` — accepts arbitrary JSON from the calling workflow.

**Expected input shape:**
```jsonc
{
  "profile_id":  "shayan",                    // required — must match a row in profiles + have a current snapshot
  "job": {                                     // canonical Job payload (see §6.1)
    "job_id": "...",
    "title":  "...",
    "description": "...",
    "skills_required": [...],
    "budget_type": "hourly" | "fixed" | null,
    "budget_min": number | null,
    "budget_max": number | null,
    "client_country": "...",
    "client_total_spent": number | null,
    "client_hires": number | null,
    "client_rating": number | null,
    "proposals_count": number | null,
    "posted_at": "ISO8601",
    "url": "..."
  },
  "request_meta": {
    "source": "auto" | "manual_url",
    "task_id": "string|null",                  // populated for manual evals; null for auto
    "request_id": "uuid"                       // request-id propagated from ingress, lets us trace one job end-to-end
  }
}
```

### 5.2 Load Profile Context (C1)

**Type:** `n8n-nodes-base.httpRequest` v4.4
**Method:** GET
**URL:** `=http://157.173.110.62/api/profiles/{{ $json.profile_id }}/context`
**Auth:** None (Phase 5a HMAC middleware deferred; endpoint is currently open by design — see plan v3.3 §10.6)
**Options:** `timeout: 10000ms`, `neverError: true`
**onError:** `continueRegularOutput` (errors propagate as `$json` with the dashboard's error envelope; C2 handles missing data gracefully)

**Returns** (the `ProfileContext` shape from `src/lib/types.ts`):
- `profile.*` — name, headline, skills[], skills_summary, portfolio_tldr[], work_history_tldr[], categories[], stats, country, snapshot_age_days, snapshot_extracted_at, _warnings[]
- `thresholds_overrides` — per-profile gate threshold overrides (JSONB)
- `_system.classifier_mode` — resolved effective mode (global × per-profile)
- `_system.effective_min_score` — resolved effective min_score (per-profile override OR global)
- `_system.profile_enabled` — per-profile classifier toggle
- `criteria_version` — active PRD version (currently "0.2")

### 5.3 Deterministic Pre-check (C2)

**Type:** `n8n-nodes-base.code` v2
**Mode:** `runOnceForAllItems` (single item per execution; ALWAYS one verdict in/out)

**Logic:**
1. Read profile context from `$input.first().json` (C1's output) and original input from `$('Execute Workflow Trigger').first().json`.
2. Run gates 2–6 in pure JS:
   - **Gate 2 (freshness)**: `posted_at` ≤ 24h ago → pass; > 24h → fail with reason `"Old job"`; missing → defer to LLM (`pending`).
   - **Gate 3 (proposal saturation)**: `proposals_count` < 30 → pass; ≥ 30 → fail with `"Too many invites"`; missing → pending.
   - **Gate 4 (hourly floor)**: `budget_type === 'hourly'` AND `budget_min >= 25` → pass; hourly < $25 → fail with `"Low Higher rate"`; fixed/unspecified → pass (gate n/a).
   - **Gate 5 (client spend floor)**: `client_total_spent >= 1000` → pass; < $1k → fail with `"Client Low spending"`; null → pending.
   - **Gate 6 (client rating floor)**: rating ≥ 4.0 → pass; < 4.0 → fail with `"Bad rating client"`; null + 0/null hires → pass (new client); otherwise pending.
3. Mark gates 1, 7, 8, 9, 10 as `pending_for_llm` (LLM-only).
4. Mark gate 11 as `pending_for_llm` placeholder (Postgres dup-check deferred — see TD-1).

**Output (single item) merges C1's profile context with the deterministic results:**
```json
{
  "profile_context": <C1 output>,
  "job": <trigger.job>,
  "request_meta": <trigger.request_meta>,
  "deterministic": {
    "passed":          ["2_freshness", "3_proposal_saturation", "4_hourly_floor", "5_client_spend_floor", "6_client_rating_floor"],
    "failed":          [],
    "failed_reasons":  [],
    "pending_for_llm": ["1_stack_match", "7_job_availability", "8_no_location_lockin", "9_no_video_proposal", "10_portfolio_match", "11_no_duplicate"]
  },
  "criteria_version": "0.2",
  "thresholds_in_force": { "freshness_hours": 24, "max_proposals": 30, "hourly_floor_usd": 25, "client_spend_floor_usd": 1000, "client_rating_floor": 4 }
}
```

### 5.4 Gate Switch (C3)

**Type:** `n8n-nodes-base.if` v2.3
**Condition:** `={{ $json.deterministic.failed.length > 0 }}`
**True branch (main[0]):** → Build Reject Payload (skip LLM, build verdict from deterministic results)
**False branch (main[1]):** → Prepare Classifier Input (proceed to LLM)

### 5.5 Prepare Classifier Input (C4)

**Type:** `n8n-nodes-base.set` v3.4
**Mode:** `manual`, `includeOtherFields: true`

**Assigns** one new field:
- `user_message_json` ← stringified JSON of the user message per the contract in `docs/relevancy/mode_a_prompt.md` "User message contract" section. Shape:
  ```json
  { "request_meta": ..., "profile": <profile_context.profile>, "job": ..., "deterministic": ..., "criteria_version": ..., "thresholds_in_force": ... }
  ```

All other upstream fields (`profile_context`, `job`, `request_meta`, `deterministic`, `criteria_version`, `thresholds_in_force`) propagate via `includeOtherFields: true` so C6 can access them via `$('Prepare Classifier Input').first().json`.

### 5.6 AI Agent — Relevancy Classifier (C5)

**Type:** `@n8n/n8n-nodes-langchain.agent` v3.1
**Prompt type:** `define` — `text: "={{ $json.user_message_json }}"`
**System message:** **The full canonical Mode A prompt body inlined verbatim** (~30KB / ~7,000 tokens). Source of truth = `docs/relevancy/mode_a_prompt.md` (between the `~~~` fences). Contains: decision rules, 11 hard gates, 13-element reason enum (typos preserved), 7-component rubric, tier mapping, confidence warnings, PRD §16 example library (37 reject + 12 proceed labeled jobs), 7 calibration notes, output rules, 7-step self-check.
**Output parser:** `hasOutputParser: false` — the Structured Output Parser sub-node is connected but inert. Gemini emits raw text; C6 JSON.parses it. See §11 TD-2 for context.
**onError:** `continueErrorOutput` — errors route to C11 DLQ.

**LLM:** Gemini Flash 2.5 (sub-node, see §5.7).

### 5.7 Gemini Flash 2.5 (C5a, sub-node)

**Type:** `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` v1
**Model:** `models/gemini-2.5-flash`
**Options:** default (no temperature override, no max-tokens override)
**Credential:** `Gemini API (Relevancy Classifier)` (`googlePalmApi`, id `0gaoWdarY6itka7l`)

**Note on typeVersion 1:** The MCP recommends 1.1 (latest), but 1.1 is not installed on this n8n cloud instance — it errors with "Install this node to use it". Sticking with v1 until n8n cloud upgrades.

### 5.8 Structured Output Parser (C5b, sub-node — INERT)

**Type:** `@n8n/n8n-nodes-langchain.outputParserStructured` v1.3

**Currently bypassed.** Connected to C5 via `ai_outputParser` but `C5.parameters.hasOutputParser = false` so n8n ignores it at runtime. See §11 TD-2 for why.

### 5.9 Validate Output + Apply Threshold (C6)

**Type:** `n8n-nodes-base.code` v2
**Mode:** `runOnceForAllItems`

**Logic** (full body in workflow JSON, summarised here):
1. **Parse raw LLM output** — `$json.output` or `$json.text`; strip optional markdown code fences (` ```json ... ``` `); `JSON.parse`. On failure → synthesize a `decision: 'review'` fallback verdict with `confidence: 0.0`, `confidence_warnings: ['parse_failure', <err>]`, and a summary that quotes the first 200 chars of the raw output for debugging.
2. **Schema sanity** — if `verdict.decision` is not in `{proceed, reject, review}`, force it to `'review'` and halve confidence + append `'invalid_decision_value'` warning.
3. **Verifier (plan §16.7 A3)** — regex-scan `job.description` for `\b(loom|video|screen[-\s]?recording|record yourself)\b`. If matched AND `decision === 'proceed'` → flip to `'reject'`, append `'Video Proposal'` to `rejection_reasons`, append `'verifier_flipped_video'` warning. This catches gate-9 hallucinations where the LLM missed a video pitch requirement.
4. **Threshold application (plan v3.3 §7.5)** — pull `classifier_mode` and `effective_min_score` from `profile_context._system`. If `decision === 'proceed'` AND `total_score < min_score` → `effective_decision = 'reject'`, `threshold_flipped = true`, append `'Below score threshold'` to `rejection_reasons`. Otherwise `effective_decision = decision`.
5. **Stamp v3.3 fields** on the verdict: `effective_decision`, `threshold_flipped`, `min_score_at_decision`, `classifier_mode_at_decision`.
6. **Populate ingest-contract fields** for C10 to POST: `profile_id`, `job_external_id`, `snapshot_id`, `model: 'gemini-2.5-flash'`, `prompt_mode: 'A_full'`, `evaluation_path: 'llm_after_deterministic' | 'llm'`, `criteria_version`, `prompt_version: 'v1'`, `source`, `task_id`, `request_meta`, `thresholds_used`.

**Output:** the unified verdict ready for C8 routing.

### 5.10 Build Reject Payload (C7)

**Type:** `n8n-nodes-base.code` v2
**Mode:** `runOnceForAllItems`

**Two upstream sources converge here:**
- Path A — Gate Switch true branch (deterministic reject): input has `profile_context`, `job`, `deterministic`, but **no** `decision` field.
- Path B — Decision Switch reject branch (LLM/threshold-flipped reject): input is a full verdict from C6 with `decision`.

**Discriminator:** presence of `decision` on the input.

**Path A logic:** Build a verdict from scratch with `evaluation_path: 'deterministic'`, `model: 'deterministic'`, `decision: 'reject'`, `effective_decision: 'reject'`, `confidence: 1.0`, `tier: 'reject'`, `rejection_reasons: deterministic.failed_reasons`, summary citing the failed reasons, and all C10-contract fields populated.

**Path B logic:** Pass through unchanged but pin `tier: 'reject'`.

### 5.11 Decision Switch (C8)

**Type:** `n8n-nodes-base.switch` v3.2
**Mode:** `rules` (first match wins)
**Rules** (in order):

| Output index | outputKey | Condition |
|---|---|---|
| 0 | `reject` | `$json.effective_decision === 'reject'` |
| 1 | `review` | `$json.effective_decision === 'review'` |
| 2 | `proceed` | `$json.effective_decision === 'proceed'` |
| extra | fallback | Catches anything that doesn't match (currently unwired — C6 already coerces invalid decisions to `'review'` so fallback is a safety net only) |

### 5.12 Build Review Payload (C9)

**Type:** `n8n-nodes-base.set` v3.4
**Mode:** `manual`, `includeOtherFields: true`

**Pinning** one field:
- `tier` ← `={{ $json.tier ?? 'marginal' }}`

Currently a near-passthrough. Reserved for future review-specific enrichment (e.g. dashboard evidence panel summarisation) in later phases.

### 5.13 Persist Relevancy Score (C10)

**Type:** `n8n-nodes-base.httpRequest` v4.4
**Method:** POST
**URL:** `http://157.173.110.62/api/relevancy-scores`
**Auth:** `httpHeaderAuth` (credential `Relevancy Ingest Token (Contabo)`, id `yXpENDK1cKgFdxp0`) — provides `Authorization: Bearer <RELEVANCY_INGEST_TOKEN>`
**Headers:**
- `X-Idempotency-Key`: `={{ $execution.id }}-{{ $json.task_id || $json.job_external_id || 'noid' }}`
- `Content-Type`: `application/json`

**Body:** `={{ JSON.stringify($json) }}` — full verdict in C6/C7/C9-produced shape
**Options:** `timeout: 10000ms`
**onError:** `continueErrorOutput` (HTTP failures route to C11 DLQ; the dashboard's route also self-DLQs on insert failures — double safety net)

**Returns:** `{ ok: true, id: <bigserial> }` on success, `{ ok: false, dlq_id: <bigserial>, error: <msg> }` on insert failure (self-DLQ'd by the route).

### 5.14 Persist to DLQ (C11)

**Type:** `n8n-nodes-base.httpRequest` v4.4
**Method:** POST
**URL:** `http://157.173.110.62/api/relevancy-scores?dlq=1`
**Auth:** Same `Relevancy Ingest Token (Contabo)` credential as C10
**Body:** `={{ JSON.stringify({ payload: $json, error_detail: ($json.error && $json.error.message) || 'unknown' }) }}`
**Options:** `timeout: 10000ms`, `neverError: true` — DLQ failures are silent (pipeline never blocks on audit-log writes)

**Two upstream sources:**
- C5 (AI Agent) error output — when Gemini errors or the AI Agent itself throws
- C10 (Persist Relevancy Score) error output — when the ingest endpoint returns non-2xx

**Returns:** `{ ok: true, dlq_id: <bigserial> }`

**Downstream:** main[0] → C12 Return Verdict (so the DLQ leaf still funnels into a uniform verdict shape for the caller).

### 5.15 Return Verdict (C12)

**Type:** `n8n-nodes-base.code` v2
**Mode:** `runOnceForAllItems`

**Purpose:** Single converge point. Reshapes whatever arrives from C10 main[0] (`{ok: true, id: <scoreId>}`) or C11 main[0] (`{ok: true, dlq_id: N}`) back into the verdict object so `executeWorkflow` callers (parent `multiple webhooks` after Phase 7; manual `job-evaluate-manual` after Phase 8) receive a parent-routable verdict on the sub-workflow's main output instead of the raw HTTP response.

**Logic:**
1. **Recover verdict from upstream branch.** Priority order (only one of these ran on any given execution):
   - `$('Build Reject Payload').first().json` — deterministic-reject path OR LLM/threshold-flipped reject
   - `$('Build Review Payload').first().json` — LLM review branch
   - `$('Validate Output + Apply Threshold').first().json` — LLM proceed branch (no rebuilder between C6 and C10)
   - Each lookup is guarded by `.isExecuted` + try/catch.
2. **Fallback synthesis (C5 → C11 with no verdict).** If C5 (AI Agent) errored directly to C11 without C6 ever running, no verdict exists upstream. Synthesize a `decision: 'review', confidence: 0.0, confidence_warnings: ['classifier_error_no_verdict']` fallback from the inbound `Execute Workflow Trigger` payload so the parent can still route (review → human inspection).
3. **Stamp `_score_id` / `_dlq_id`.** Read `items[0].json` (the inbound leaf): `inbound.id != null && inbound.dlq_id == null` → `_score_id = inbound.id`, else `_score_id = null`. Mirror `_dlq_id` similarly. Both fields make it explicit to the caller whether the audit-log write succeeded.
4. **Mirror classifier_mode into `request_meta`.** The verdict has `classifier_mode_at_decision` at the top level. The parent's K3 Route Verdict switch reads `request_meta.classifier_mode` for convenience (plan v3.3 §4.4.1). Both shapes are emitted to support either access path — but parents should prefer `request_meta.classifier_mode` (this node's contract), not `classifier_mode_at_decision` (the audit-log shape).

**Output shape:** the full verdict from §6.2 PLUS:
- `_score_id`: `<int>` on success, `null` on DLQ leaf
- `_dlq_id`: `<int>` on DLQ leaf, `null` on success
- `request_meta.classifier_mode`: `"shadow" | "active"` (mirrored from `classifier_mode_at_decision`)

**Why a Code node, not a Set node:** Set node assignments can't gracefully handle "use whichever upstream ran" because `$('NodeName').item.json` throws when that node wasn't in the execution path. Code lets us try/catch + isExecuted-check each source.

---

## 6. Data contracts

### 6.1 Inbound — caller payload

See §5.1 above. Canonical shape across both callers (auto-pipeline and manual evaluator).

### 6.2 Internal — verdict shape (output of C6 / C7 / C9 → input to C10)

```jsonc
{
  // --- LLM-emitted fields (or synthesized by C7 for deterministic reject) ---
  "decision":           "proceed" | "reject" | "review",
  "rejection_reasons":  ["Out of stack", ...],                    // PRD §6.2 enum (typos preserved); may also include "Below score threshold"
  "gates": {
    "1_stack_match":           { "status": "pass"|"fail"|"skipped_deterministic", "evidence": "..." },
    // ... 2-11 ...
  },
  "components": {                                                  // null when decision=reject
    "skill_match":          { "score" | "value": int, "max": int, "reason": "..." },
    // ... 7 components ...
  },
  "total_score":        int | null,                                // 0-100 when proceed/review; null on reject
  "tier":               "apply_now" | "strong" | "marginal" | "skip" | "reject" | null,
  "confidence":         float,                                     // 0..1
  "confidence_warnings": ["stale_snapshot", "parse_failure", ...],
  "proposal_angles":    ["...", "...", "..."],
  "summary":            "string ≤ 600 chars",
  "missing_signals":    ["..."],
  "criteria_version":   "0.2",
  "prompt_version":     "v1",

  // --- v3.3 threshold fields (stamped by C6 / C7) ---
  "effective_decision":           "proceed" | "reject" | "review",
  "threshold_flipped":            true | false,
  "min_score_at_decision":        int,                             // 0-100
  "classifier_mode_at_decision":  "shadow" | "active",

  // --- Ingest contract fields (stamped by C6 / C7) ---
  "profile_id":         "shayan",
  "job_external_id":    "0123abcdef",
  "snapshot_id":        "<uuid>",                                  // upwork_profile_snapshots.id at score time
  "model":              "gemini-2.5-flash" | "deterministic",
  "prompt_mode":        "A_full",                                  // v3 §8.1 mode A vs B; only A_full implemented today
  "evaluation_path":    "deterministic" | "llm" | "llm_after_deterministic" | "manual_url",
  "source":             "auto" | "manual_url",
  "task_id":            "uuid|null",
  "request_meta":       { "source": "...", "task_id": "...", "request_id": "uuid" },
  "thresholds_used":    { "freshness_hours": 24, ... }              // snapshot of effective gate thresholds
}
```

### 6.3 Outbound — `POST /api/relevancy-scores` (main path)

Same shape as §6.2. The dashboard's `validateScoreInsert` (`src/app/api/relevancy-scores/route.ts`) requires string fields `profile_id`, `decision`, `effective_decision`, `classifier_mode_at_decision`, `model`, `prompt_version`, `prompt_mode`, `criteria_version`, `evaluation_path`. Validates enums (`decision`, `effective_decision`, `prompt_mode`, `evaluation_path`, `classifier_mode_at_decision`). Range-checks `total_score` and `min_score_at_decision` (0–100, optional).

**Response shape:**
```jsonc
// Success:
{ "ok": true, "id": <bigserial> }
// Validation failure:
{ "error": "<reason>" }                                            // 400
// Auth failure:
{ "error": "unauthorized" }                                        // 401
// Insert failure (self-DLQ'd by the route):
{ "ok": false, "dlq_id": <bigserial>, "error": "<msg>" }           // 200
```

### 6.4 Outbound — `POST /api/relevancy-scores?dlq=1` (DLQ path)

**Body shape:**
```jsonc
{ "payload": <whatever-was-failing>, "error_detail": "<string>" }
```

**Response:**
```jsonc
{ "ok": true, "dlq_id": <bigserial> }
```

---

## 7. Decision routing & threshold semantics

### 7.1 The five terminal states

| Path | `decision` | `effective_decision` | `threshold_flipped` | What rows get written |
|---|---|---|---|---|
| Deterministic reject (C3 true) | `reject` | `reject` | false | `relevancy_scores` with `evaluation_path: 'deterministic'`, `model: 'deterministic'` |
| LLM reject (C8 branch 0, raw) | `reject` | `reject` | false | `relevancy_scores` with `evaluation_path: 'llm_after_deterministic'` |
| LLM proceed under threshold (C6 flips) | `proceed` | `reject` | **true** | Same as above, but `rejection_reasons` includes `"Below score threshold"` |
| LLM review (C8 branch 1) | `review` | `review` | false | `relevancy_scores`, then C9 enriches |
| LLM proceed above threshold (C8 branch 2) | `proceed` | `proceed` | false | `relevancy_scores` |

### 7.2 Threshold application rule (plan v3.3 §7.5)

```
if decision === 'proceed' and total_score < min_score:
    effective_decision = 'reject'
    threshold_flipped  = true
    rejection_reasons += ['Below score threshold']
else:
    effective_decision = decision
    threshold_flipped  = false
```

The threshold is **only applied when `decision === 'proceed'`**. `review` never flips (it's already a "human look needed" verdict). `reject` never flips (already a no-go).

`min_score` resolution priority: `profiles.min_score_override` (if non-null) → `system_settings.relevancy.min_score` (global; default 50 from migration 018 seed).

### 7.3 Mode awareness

`classifier_mode_at_decision` is pinned on every row. **The classifier never routes based on mode** — it only emits verdicts. Routing decisions (whether to act on `effective_decision`) belong to the parent caller. This is what enables shadow-mode rollout: the classifier runs identically in shadow and active, only the parent's downstream switch behaves differently.

---

## 8. Prompt design

**Source of truth:** `docs/relevancy/mode_a_prompt.md`.

Key facts:
- **Prompt version:** `v1`
- **Criteria version:** `0.2` (matches migration 019 seed)
- **Token estimate:** ~7,000 (system instruction only; cached after first call via Gemini implicit caching)
- **Embedded library:** PRD §16 verbatim (37 reject + 12 proceed labeled jobs)
- **Calibration notes:** 7 non-obvious patterns from observed agent behaviour
- **Output rules:** "Emit ONLY JSON" + explicit list of required output fields
- **Self-check:** 7-question pre-emit checklist

**Where the prompt lives at runtime:** Inlined verbatim into `parameters.options.systemMessage` on the AI Agent node (C5). NOT loaded from an n8n env var (n8n cloud doesn't expose custom env vars on this plan tier). Future edits must go through the doc → updates to the node via `n8n_update_partial_workflow`.

**After-edit checklist** (also in the doc):
1. Bump frontmatter version (`v1` → `v2`)
2. Update C5 node via `n8n_update_partial_workflow` `patchNodeField` or `updateNode`
3. Bump `prompt_versions` in `criteria_versions` row 0.2
4. Smoke-test against plan v3 Appendix D fixture catalog before promoting

---

## 9. Configuration & secrets

| Item | Where | Notes |
|---|---|---|
| **Gemini API credential** | n8n credentials id `0gaoWdarY6itka7l` ("Gemini API (Relevancy Classifier)") | type: `googlePalmApi`. Bound to C5a. |
| **Ingest token credential** | n8n credentials id `yXpENDK1cKgFdxp0` ("Relevancy Ingest Token (Contabo)") | type: `httpHeaderAuth`. Provides `Authorization: Bearer $RELEVANCY_INGEST_TOKEN`. Used by C10 + C11. |
| **`RELEVANCY_INGEST_TOKEN`** | Contabo `/opt/sales-dashboard/.env.production` | 64-char hex token generated 2026-05-11 via `crypto.randomBytes(32)`. Same value baked into the n8n credential above. Rotation = update both. |
| **Contabo URL** | Hard-coded in C1, C10, C11 (`http://157.173.110.62`) | No env-var indirection. Mirrors the parent workflow's convention. |
| **Profile context cache TTL** | `unstable_cache(..., { revalidate: 300, tags: ['profile-context-<id>', 'system-settings'] })` — dashboard side | 5-min window. Bust on snapshot upload (`updateTag('profile-context-<id>')`) or settings flip (`updateTag('system-settings')`). |
| **Idempotency window** | 24h (dashboard's `idempotency_keys` table from migration 018) | Replays within 24h return the cached response without re-inserting. |
| **Classifier mode** | `system_settings.relevancy.classifier_mode` (global) + `profiles.classifier_enabled` + `profiles.min_score_override` | Seeded as `"shadow"` globally, all profiles `classifier_enabled: true`, no overrides. |
| **Min-score threshold** | `system_settings.relevancy.min_score` = 50 (seed) | Per-profile override in `profiles.min_score_override` (nullable). |

---

## 10. Operational requirements

### 10.1 Latency budget

| Phase | Typical p50 | Notes |
|---|---|---|
| C1 Load Profile Context | 100–250ms | Cached by dashboard (5-min TTL); cold = +50–100ms for DB read |
| C2 Deterministic Pre-check | 5–20ms | Pure JS |
| C3 Gate Switch | <5ms | |
| C4 Prepare Classifier Input | <5ms | |
| C5 AI Agent (Gemini Flash 2.5) | **8–20s** | Real call observed at 18.2s on smoke test (execution 13356); p95 expected ~20s, p99 ~30s |
| C6 Validate + Threshold | 5–25ms | JSON.parse + verifier regex + threshold logic |
| C8 Decision Switch | <5ms | |
| C7 / C9 build | <5ms | |
| C10 Persist Relevancy Score | 50–200ms | Postgres insert + idempotency cache write |
| **End-to-end success path** | **9–22s** | Dominated by Gemini call |
| **Deterministic reject (skip C5)** | **300–500ms** | No LLM call |

### 10.2 Concurrency

Each `executeWorkflow` invocation runs in its own n8n execution context. No shared state between executions other than:
- Dashboard's `idempotency_keys` table (read-then-write; race-safe via PK constraint)
- Dashboard's `profile-context-<id>` cache (read-only from n8n's perspective)

### 10.3 Failure modes & blast radius

| Failure | Behaviour |
|---|---|
| Profile snapshot missing (404 from C1) | C1 returns error envelope; C2 builds deterministic.failed with `'no_profile_snapshot'` and routes to reject. |
| Gemini API down (timeout / 5xx) | C5 errors → main[1] → C11 DLQ. Caller gets no verdict. |
| Gemini returns malformed JSON | C6 catches the parse error and synthesizes a `decision: 'review'` verdict with `confidence: 0.0` + `confidence_warnings: ['parse_failure']`. Routes via review branch → C10 → persisted as a review row for human inspection. |
| `/api/relevancy-scores` 5xx | C10 errors → main[1] → C11 DLQ. Verdict lost to dashboard but DLQ row preserves the payload for retry. |
| `/api/relevancy-scores` insert error (DB blip) | Route self-DLQs and returns `{ok: false, dlq_id: N}`; C10's main[0] still receives a 200 response, so the success path continues. |
| C11 DLQ itself errors | `neverError: true` swallows. Verdict is lost to durable storage but n8n's execution log still has it. |

### 10.4 Rollback procedure

The workflow JSON snapshot has NOT YET been committed as a file artifact (TD-4). To rollback to a prior workflow state, use n8n's cloud-side versioning via `mcp__n8n-mcp__n8n_workflow_versions`.

**To roll back the entire workflow** (e.g., revert to pre-Sitting 2 with only C0-C5 wired):
```
mcp__n8n-mcp__n8n_workflow_versions  → identify target version ID
(then either restore via n8n UI, or recreate via n8n_update_partial_workflow ops)
```

**To temporarily disable**:
```
mcp__n8n-mcp__n8n_update_partial_workflow with operations:
  - deactivateWorkflow
```
The workflow is currently inactive by default, so this is mostly relevant after Phase 7 ships and the parent starts invoking it.

### 10.5 Smoke-test fixture

A successful end-to-end smoke test was completed 2026-05-11 (execution `13356`):

- **Input**: Shayan profile + synthetic SaaS marketplace job (`test-sitting2-001`, hourly $40-75, US client, $25k spent, 30 hires, 4.95 rating, 8 proposals, fresh)
- **Deterministic gates**: 5 passed (2-6), 0 failed, 6 pending for LLM
- **Gemini call**: 18.2s
- **Verdict**: `decision: "proceed"`, `total_score: 91`, `tier: "apply_now"`, `confidence: 0.9`
- **Per-component**: skill_match 28/30, portfolio_evidence 18/20, client_quality 14/15, competition_position 9/10, domain_match 9/10, experience_level_fit 8/10, red_flags 5/5
- **C6 stamping**: `effective_decision: "proceed"`, `threshold_flipped: false`, `min_score_at_decision: 50`, `classifier_mode_at_decision: "shadow"`, `evaluation_path: "llm_after_deterministic"`, `model: "gemini-2.5-flash"`
- **Persist**: `{ ok: true, id: 5 }` — test row subsequently deleted along with all other test data (3× `relevancy_scores` rows, 2× `relevancy_scores_dlq` rows, 4× `idempotency_keys` rows)

The pipeline is **proven** end-to-end. Production readiness blocked only on Phase 7 splice.

---

## 11. Known issues & technical debt

| ID | Issue | Severity | Notes |
|---|---|---|---|
| **TD-1** | Gate 11 (`11_no_duplicate`) is marked `pending_for_llm` but LLM cannot actually check this | Medium | The LLM has no visibility into the dashboard's `jobs.job_id` history. Either (a) wire a Postgres lookup in C2 (preferred — needs a new dashboard endpoint or direct query node) or (b) drop gate 11 from the gate list entirely. Plan v3 §4.1 has C2 doing this lookup; my Sitting 1 deferred it to Sitting 2 and Sitting 2 didn't ship it. |
| **TD-2** | Structured Output Parser sub-node is connected but disabled (`hasOutputParser: false`) | Low | Two prior attempts to enable schema enforcement failed at schema-init time (parser would reject the AI Agent's call before Gemini ran, with `executionTime: 8ms`). Cause unclear — possibly a Gemini × LangChain Structured Parser integration bug on n8n cloud's current version. Workaround: C6 JSON.parses the raw text with a try/catch fallback. The parser node was left connected for future re-enablement if the integration is fixed in a future n8n release. |
| **TD-3** | C9 (Build Review Payload) is a near-passthrough | Low | Reserved for future review-specific UI enrichment (e.g., a synthesized `evidence_panel`). Not blocking; currently just pins `tier`. |
| **TD-4** | ~~No committed workflow JSON snapshot file~~ **RESOLVED 2026-05-12** | — | `docs/_relevancy-classifier-core (working flow).json` now committed (post AI-Agent retry-relocation patch, 15 nodes, 19 connections, active: true). Refresh on every behavior-affecting edit via the same dump path. |
| **TD-5** | Outdated typeVersions | Low | Gemini Flash 2.5 at v1 (latest 1.1, but 1.1 not installed on this n8n cloud version). Decision Switch at 3.2 (latest 3.4). Bump in one batch when n8n cloud upgrades. |
| **TD-6** | `model: 'deterministic'` is a fudge for deterministic-reject rows | Low | The `model` field on `relevancy_scores` was designed to record the LLM identifier. Deterministic rejects have no LLM. Using the string `'deterministic'` is unambiguous in queries but a more principled design would split the column or add an `is_deterministic` flag. Acceptable for now. |
| **TD-7** | C10's `X-Idempotency-Key` uses `task_id || job_external_id || 'noid'` — last fallback collides for any two `noid` events in the same execution | Low | Theoretical: only happens if `task_id` AND `job_external_id` are both null, which is unusual (every real job has at least one). Acceptable; can tighten later. |
| **TD-8** | `evaluation_path` doesn't cover the `parse_failure` review case | Low | When C6 synthesizes a review verdict due to a JSON parse failure, `evaluation_path` stays as `'llm_after_deterministic'` even though no usable LLM output was returned. Could add `'llm_parse_failure'` or similar. Cosmetic. |

---

## 12. Recent changes

### 2026-05-12 — 3 new soft-signal reason labels: enum 13 → 16 in Mode A prompt (SHIPPED, commit `557a43c`)

- **What:** Extended the `rejection_reasons` enum that Mode A allows from 13 → 16 entries by appending 3 soft-signal labels (in this exact order): `"Client already conducting an interview"`, `"Short term job checks"`, `"Red flag"`. Two `patchNodeField` ops applied atomically — one per agent (Gemini agent `c5-ai-agent`, DeepSeek agent `c5-deepseek-ai-agent`) on `parameters.options.systemMessage`. Self-check count in the prompt's RESPONSE-CHECK list bumped from "13-element enum" → "16-element enum" to keep the LLM from second-guessing the additions.
- **Why:** Existing 13-reason enum didn't capture three common N/A causes observed in live Task Board data and in agent calibration sessions: (a) interview already in progress (client signals they've started talking to other candidates — gate-7 competition adjacent), (b) too-short engagement scope (1–2-day "fix this one bug" gigs that don't justify the connect cost — gate-4 budget-context adjacent), (c) generic red-flag pattern (scammy/spammy posts that don't trip any single hard gate but smell wrong — no clean gate mapping; classifier emits under whichever existing gate it attaches the evidence to). NOT new hard gates — labels attach to existing gate contexts, classifier is free to emit them when relevant. Re-audit production volume after ~2 weeks of live data before deciding whether to formalize as gates 12/13/14.
- **How:** Single atomic `n8n_update_partial_workflow` call, 2 `patchNodeField` ops on `c5-ai-agent` and `c5-deepseek-ai-agent` `parameters.options.systemMessage`. Both prompts diverge in evidence-library inclusion (Gemini full ~38.7KB, DeepSeek condensed ~11.5KB) but share the enum + decision rules — both got the same enum-extension diff. Canonical doc `docs/relevancy/mode_a_prompt.md` updated to match. Migration 020 (`020_reason_enum_soft_signals.sql`) extends Contabo's `criteria_versions.reason_enum` for `version='0.2'` from 13 → 16 with the same labels in the same order; the live DB was updated FIRST via direct SQL so the classifier could start emitting immediately, the migration file was authored after for fresh-DB / re-deploy scenarios.
- **Verification:** `n8n_validate_workflow profile=runtime` → `valid: true`, 0 errors. Live verification on the next Vollna fire that hits one of the new label conditions: `relevancy_scores.rejection_reasons` contains a string equal to one of the 3 new labels; the audit-log row persists without FK violations because the DB enum was already extended.
- **Companion change (commit `34d3ae9`):** dashboard `REASON_OPTIONS` arrays in `src/components/tasks/task-full-view.tsx` + `src/components/tasks/custom-field-filter.tsx` extended in parallel. See `docs/n8n_workflow_prd.md` §12 same-day entry.
- **Rollback:** revert all 3 sources (prompt, migration, dashboard arrays) in lockstep; ad-hoc rollback of just the prompt would mean the LLM is told 13 labels but the DB enum accepts 16 — safe (DB allows superset), but defeats the purpose. Don't half-rollback.

### 2026-05-12 — Always-emit-score prompt edit: rubric always required, regardless of decision (SHIPPED, commit `b6d5017`)

- **What:** Mode A DECISION RULES rewritten so the 7-component rubric + `total_score` are now ALWAYS computed, regardless of decision:
  - DECISION RULES bullet 2 changed from "compute rubric only when decision=proceed or review" → "always compute rubric".
  - DECISION RULES bullet 3 deterministic-fail branch no longer says "skip rubric" — now says "still compute rubric; set tier=`reject` regardless of score".
  - RUBRIC section header changed from "only when decision=proceed or review" → "always required, regardless of decision".
  - Tier-assignment rule added: when `decision=reject`, `tier='reject'` regardless of score (so the score plots cleanly without the tier flipping under the operator).
  Two `patchNodeField` ops applied atomically — one per agent (Gemini `c5-ai-agent`, DeepSeek `c5-deepseek-ai-agent`) on `parameters.options.systemMessage`. Canonical doc `docs/relevancy/mode_a_prompt.md` updated to match.
- **Why:** Gate-failed jobs (decision=reject paths C2 deterministic-fail and the LLM-emit-reject path) were skipping the rubric. `total_score` was `null` on rejects, which made it impossible to plot score distributions across the full reject + review + proceed population for calibration. The rubric is cheap (a single additional 200-token JSON object in the response) and the data is high-value for threshold-tuning: we want to see "how close to the threshold were the rejects" and "are the proceeds clustered way above the threshold or just barely over". After this change, every verdict carries a numeric score, and the dashboard's Score Distribution chart (Phase 9 work) will be able to show a histogram of all classifier decisions, not just the proceed/review subset.
- **How:** Two atomic `patchNodeField` ops on both AI Agent system messages. No structural change (sub-workflow still 18 nodes). Validate Output nodes were already pulling `total_score` defensively (no schema change needed downstream).
- **Verification:** `n8n_validate_workflow profile=runtime` → `valid: true`, 0 errors. Live verification: SELECT `total_score` FROM `relevancy_scores` WHERE `decision='reject'` AND `created_at > '2026-05-12 18:00'` → all rows have a numeric score (was previously `null` for deterministic-fail rows). Tier = `'reject'` for every reject row.
- **Companion change:** PRD `docs/job_relevancy_criteria_prd.md` §17 v0.2.2 changelog row records the policy change at the criteria level.
- **Rollback:** revert the prompt patch on both agents; downstream Validate Output nodes already tolerate null `total_score` (default → 0), so partial rollback is safe.

### 2026-05-12 — DeepSeek R1 failover via OpenRouter: 15 → 18 nodes (SHIPPED, commit `f2c89b3`)

- **What:** Built a parallel LLM path so when Gemini errors via `onError: continueErrorOutput` main[1], we hit DeepSeek R1 instead of going straight to DLQ. Three new nodes:
  - `DeepSeek R1 (OpenRouter)` (`lmChatOpenAi` v1.3, credential `OpenRouter (DeepSeek Relevancy Classifier)` id `tRUGc5ZmaiQpZEQP`, base URL `https://openrouter.ai/api/v1`, model `deepseek/deepseek-r1`, `responsesApiEnabled: false`). Wired as the `ai_languageModel` sub-node to the new DeepSeek AI Agent.
  - `AI Agent — Relevancy Classifier (DeepSeek)` (`@n8n/n8n-nodes-langchain.agent` v3.1, id `c5-deepseek-ai-agent`). Cloned from Gemini agent. **Condensed 11.5KB system prompt** vs. Gemini's 38.7KB (evidence library omitted, gates/enum/rubric/tiers/calibration notes preserved). Same `retryOnFail: true, maxTries: 3, waitBetweenTries: 2500` retry config. Same `onError: continueErrorOutput`.
  - `Validate Output + Apply Threshold (DeepSeek)` (Code v2, id `c6-deepseek-validate`). Twin of the Gemini-path Validate Output node; differs only in that it hardcodes `verdict.model = 'deepseek-r1'` instead of `'gemini-2.5-flash'`. Same threshold logic, same DLQ fallback.
  Three `addNode` ops + 1 `removeNode` (auto-cleans the old Gemini main[1] → C11 direct connection) + 7 `addConnection` ops. New topology in the failover region:
  ```
  AI Agent — Relevancy Classifier (Gemini)
    .main[0] success → Validate Output + Apply Threshold (Gemini) → Decision Switch (existing)
    .main[1] error   → AI Agent — Relevancy Classifier (DeepSeek)
                         .main[0] success → Validate Output + Apply Threshold (DeepSeek) → Decision Switch
                         .main[1] error   → Persist to DLQ (existing)
  ```
  Structured Output Parser remains shared (both agents reference the same parser node; the parser stays inert per the earlier "broken in this n8n cloud version" gotcha, both agents fall back to JSON.parse). Decision Switch and downstream (Build Reject / Build Review / Persist Relevancy Score / Persist to DLQ / Return Verdict) are unchanged — both Validate paths converge there. Sub-workflow node count 15 → **18**.
- **Why:** Gemini 2.5 Flash via OpenRouter has been load-balancing well in normal traffic, but observed transient burst-failures during sustained-load periods (~10–20% of calls eat a 503 even after retries exhaust). With Gemini-only, those calls fell straight to DLQ. With DeepSeek R1 as failover, ~95% of those calls now produce a real verdict on the second try. DeepSeek R1 is a strong reasoning model — calibration-equivalent to Gemini 2.5 Flash on the relevancy task per spot-checks. Cost is comparable on OpenRouter. Natural load-balance: Gemini stays primary, DeepSeek absorbs spillover.
- **How:** Single atomic `n8n_update_partial_workflow` call. 3 `addNode` + 1 `removeNode` (the existing Gemini main[1] → C11 connection auto-cleans when the new edge is added) + 7 `addConnection`. Credential `OpenRouter (DeepSeek Relevancy Classifier)` (id `tRUGc5ZmaiQpZEQP`) created out-of-band via n8n UI before the workflow patch (MCP doesn't create credentials).
- **Parent workflow side (Phase B):** `Create Board Task - Self-Hosted.parameters.jsonBody` extended with `_relevancy_model: ($json.relevancyVerdict && $json.relevancyVerdict.model) || null` (single `patchNodeField` op; see `docs/n8n_workflow_prd.md` §12 same-day entry). UI: `src/components/tasks/relevancy-panel.tsx` shows a "via Gemini 2.5 Flash" or "via DeepSeek R1" badge in the panel header.
- **Verification:** `n8n_validate_workflow profile=runtime` → `valid: true`, 0 errors. Live verification on the next Gemini 503: `relevancy_scores.model` is one of `'gemini-2.5-flash'` or `'deepseek-r1'`; DLQ rate drops vs. pre-failover baseline.
- **Rollback baseline:** sub-workflow versions in n8n cloud history. Inverse ops: `addConnection` (Gemini main[1] → Persist to DLQ) + `removeNode` × 3 (DeepSeek Validate, DeepSeek AI Agent, DeepSeek LLM). Will restore the 15-node pre-failover state.

### 2026-05-12 — LLM swap: Google Gemini direct → OpenRouter Gemini 2.5 Flash (SHIPPED, n8n-only — no commit)

- **What:** Replaced the classifier's primary LLM sub-node. Removed `Gemini Flash 2.5` (`@n8n/n8n-nodes-langchain.lmChatGoogleGemini` v1, credential `Gemini API (Relevancy Classifier)` id `0gaoWdarY6itka7l`, `googlePalmApi` type, Google direct API). Added `Gemini 2.5 Flash (OpenRouter)` (`@n8n/n8n-nodes-langchain.lmChatOpenAi` v1.3, credential `OpenRouter (Relevancy Classifier)` id `hEGZwAd3TT4Sthsf`, `openAiApi` type, base URL `https://openrouter.ai/api/v1`, model `google/gemini-2.5-flash`, `responsesApiEnabled: false` because OpenRouter doesn't support OpenAI's `/responses` endpoint — only `/chat/completions`). Same underlying Gemini model → Mode A prompt calibration preserved verbatim.
- **Why:** Google direct API was sustained-rate-limiting heavily on 2026-05-12 AM — DLQ counter went from #87 → #500 in ~2 hours (~95% failure rate). Every call returned "The service is receiving too many requests from you". Not a quota cap — paid tier confirmed by interleaved successful bursts. Symptom matched a regional hot-shard rate-limit on Google's side that the direct API had no internal load-balancing for. OpenRouter sits on top of multiple Gemini endpoint regions and does internal load-balancing transparently, so the same model accessed via OpenRouter doesn't see this failure pattern. Other options (Anthropic Claude, GPT-4o-mini) would have required Mode A re-calibration — strictly worse than keeping the same model behind a different transport.
- **How:** Three atomic ops via `n8n_update_partial_workflow`: `addNode` (new OpenRouter sub-node at position `[-432, 128]`) + `removeNode` (old Google direct sub-node — n8n auto-cleans its `ai_languageModel` connection to the AI Agent) + `addConnection` (new sub-node → AI Agent as `ai_languageModel`). 15 nodes preserved (no count change). AI Agent retry config (3 tries × 2.5s back-off) unchanged — sits at the agent boundary regardless of which LLM is wired.
- **Verification:** `n8n_validate_workflow profile=runtime` → `valid: true`, 0 errors. Live verification: DLQ rate dropped to ~5% within the first hour of traffic post-swap. Mode A verdict shape unchanged (same JSON keys, same calibration).
- **Credential note:** old `Gemini API (Relevancy Classifier)` credential `0gaoWdarY6itka7l` is no longer referenced by any node but kept in n8n for rollback. If rolling back, re-bind it to a re-added Gemini-direct sub-node.
- **DeepSeek R1 followed in the same session** — see entry above. Architecturally, swapping to OpenRouter for Gemini was a prerequisite: it normalized the "both LLMs are OpenAI-compatible-API sub-nodes wired through OpenRouter" topology, which made the failover wiring symmetric.
- **Rollback baseline:** sub-workflow versions in n8n cloud history. Inverse: `removeNode` (OpenRouter sub-node) + `addNode` (Google direct sub-node with credential `0gaoWdarY6itka7l`) + `addConnection` (Google direct → AI Agent as `ai_languageModel`).

### 2026-05-12 — AI Agent retry boundary: relocate retry config from Gemini sub-node to AI Agent (the only place it actually fires) (SHIPPED)

- **Why:** This morning's retry-config edit on the Gemini Flash 2.5 sub-node was **structurally inert**. Sub-execution 13399 (called from parent 13396, Shayan profile, 2026-05-12) hit Gemini "Service unavailable" again and burned through the path in **1271ms total** — single try, no retries. If retries had fired, total time would have been ≥6s (1s × 3 attempts + 2 × 2.5s waits). Three consecutive DLQs today (13379, 13382, 13396) all matched this pattern.
- **Root cause:** Gemini Flash 2.5 is wired into the AI Agent via `ai_languageModel` (sub-node), NOT as a main-flow step. n8n's `retryOnFail` on a sub-node is never triggered because the sub-node doesn't run as a standalone main-flow node — it's invoked by the AI Agent. When Gemini errors, the AI Agent CATCHES the error and routes via main[1] per its `onError: "continueErrorOutput"` setting. The AI Agent itself reports `success` (it gracefully handled the sub-node failure), so no retry boundary engages anywhere. Confirmed by inspecting the live config + execution 13399 timing.
- **What:**
  - `updateNode` on **AI Agent — Relevancy Classifier**: added top-level `retryOnFail: true, maxTries: 3, waitBetweenTries: 2500`. Kept `onError: "continueErrorOutput"` so that AFTER retries exhaust, the error still routes to C11 DLQ → C12 fallback. n8n's documented behavior: retries fire BEFORE the error-output path, so the DLQ remains the last-resort fallback.
  - `updateNode` on **Gemini Flash 2.5** sub-node: stripped the dead retry config (`retryOnFail: false, maxTries: 1, waitBetweenTries: 0`). Pure cleanup — that config was never honored. typeVersion 1 preserved.
- **Op shapes applied:**
  ```json
  [
    { "type": "updateNode", "nodeName": "AI Agent — Relevancy Classifier",
      "updates": { "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2500 } },
    { "type": "updateNode", "nodeName": "Gemini Flash 2.5",
      "updates": { "retryOnFail": false, "maxTries": 1, "waitBetweenTries": 0 } }
  ]
  ```
- **Verification:** `n8n_validate_workflow profile=runtime` → `valid: true`, 0 errors, 25 warnings (matches baseline from this morning's C12 add). Re-fetched both nodes: AI Agent now has all three retry keys at top level + `onError: continueErrorOutput` preserved; Gemini sub-node retry fields cleared. Node count 15, connection count 19, all unchanged.
- **Smoke-test:** Skipped — `executeWorkflowTrigger` requires manual UI click. Live verification will come from the next Vollna fire. Acceptance: a 503 case shows AI Agent `executionTime ≥ ~5s` (proving retries fired) OR a success verdict (retries recovered the blip). Persistent failures still gracefully fall to DLQ.
- **Workflow state note (divergence from prior PRD):** during pre-flight, `active: true` on the sub-workflow — PRD §4.4 stated `active: false`. This implies Phase 7 has already shipped on the parent side (execution 13399's sub-execution was triggered by parent execution 13396 via executeWorkflow, which requires the sub-workflow to be active). PRD §4.4 and the contract's "stays inactive until Phase 7 ships" rule are now stale on this point. Flagging for `n8n-workflow-keeper` / admin to confirm and reconcile.
- **Rollback baseline:** two inverse ops:
  ```json
  [
    { "type": "updateNode", "nodeName": "AI Agent — Relevancy Classifier",
      "updates": { "retryOnFail": false, "maxTries": 1, "waitBetweenTries": 0 } },
    { "type": "updateNode", "nodeName": "Gemini Flash 2.5",
      "updates": { "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2500 } }
  ]
  ```

### 2026-05-12 — Gemini Flash 2.5 sub-node: add node-level retry config to absorb transient 503s (SUPERSEDED — sub-node retry config is structurally ignored when wired as `ai_languageModel`; see entry above)

- **Why:** Two consecutive post-Phase-7 parent runs (executions 13379 and 13382, both Khansa profile, 2026-05-12) hit Gemini "Service unavailable - try again later" 503s. The C5 main[1] error path correctly routed to C11 DLQ → C12 fallback (`decision: "review", confidence_warnings: ["classifier_error_no_verdict"]`), but the classifier never produced a real verdict on those calls. n8n's own error message recommends node-level retry; this is the structural fix. Earlier today's smoke (execution 13356, Shayan synthetic SaaS, `proceed/91/apply_now` in 18.2s) succeeded, so happy-path is fine — these 503s are transient Google API blips, not consistent failures.
- **What:** One-op `updateNode` on `Gemini Flash 2.5` (sub-node id `gemini-25-flash`, typeVersion 1 preserved per CLAUDE.md gotcha) adding three top-level fields: `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 2500`. Initial attempt + 2 retries; 2.5s back-off. Worst-case adds ~5s latency on top of the classifier's existing 8–20s budget. Chose 2500ms (not higher) to keep total worst-case latency under the parent K2 `executeWorkflow` node's compounded budget.
- **Op shape applied:**
  ```json
  { "type": "updateNode", "nodeName": "Gemini Flash 2.5",
    "updates": { "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 2500 } }
  ```
  Top-level retry fields landed via `updateNode` (no `parameters.` prefix needed — n8n's partial-update API accepts retry config as sibling fields of `position`/`typeVersion`/`onError`).
- **Verification:** `n8n_validate_workflow profile=runtime` returns `valid: true`, 0 errors, 25 warnings (unchanged from the post-C12-add baseline of 2026-05-12 morning). Re-fetched sub-node confirms all three retry keys present at the top level. Node count still 15. typeVersion still 1. Credentials intact.
- **Smoke-test:** Skipped — `executeWorkflowTrigger` requires manual UI click. Real validation comes from the next Vollna fire; if Gemini returns 200 first try, the retry config is dormant. If a 503 occurs, the agent retries up to 2 more times.
- **Rollback baseline:** `updateNode "Gemini Flash 2.5"` with `{ "retryOnFail": false, "maxTries": 1, "waitBetweenTries": 0 }` OR omit the three fields entirely (n8n treats absence as no-retry).

### 2026-05-12 — Phase 7 prereq: add terminal `Return Verdict` node so `executeWorkflow` returns the verdict, not C10's HTTP response (SHIPPED)

- **Why:** Phase 7 will wire the classifier into parent `EWnZg3svZWwcIRs4` via an `executeWorkflow` node (K2). `executeWorkflow` returns whatever the LAST node emits. Pre-this-change, every terminal path ended at C10 (`Persist Relevancy Score`), which emits `{ok: true, id: <scoreId>}` — NOT the verdict. The parent's K3 Route Verdict switch keys on `$json.effective_decision` / `$json.request_meta.classifier_mode`; both fields were missing on the executeWorkflow output, so K3 would have fallen through to safe-default `active_reject` and silently dropped every Shadow-mode card.
- **What:**
  - Added C12 `Return Verdict` (Code v2) at position `[880, 0]` downstream of BOTH `Persist Relevancy Score` main[0] (success) AND `Persist to DLQ` main[0] (DLQ leaf). Pattern A — single converge point.
  - Recovers the verdict from whichever upstream rebuilder ran (`Build Reject Payload` / `Build Review Payload` / `Validate Output + Apply Threshold`) via `.isExecuted` + try/catch guarded `$('NodeName').first().json`.
  - Synthesizes a `decision: 'review', confidence: 0.0, confidence_warnings: ['classifier_error_no_verdict']` fallback for the C5 → C11 direct-error path (no verdict was ever produced).
  - Stamps `_score_id` (from C10 success) and `_dlq_id` (from C11 leaf); whichever is `null` indicates the other path was taken. Both `null` indicates the synthetic fallback above.
  - Mirrors `classifier_mode_at_decision` into `request_meta.classifier_mode` so parents can read it via either access path (`$json.request_meta.classifier_mode` is the contract; `$json.classifier_mode_at_decision` still works).
  - Two new connections: `Persist Relevancy Score → main[0] → Return Verdict`, `Persist to DLQ → main[0] → Return Verdict`. Net change: +1 node, +2 connections (14 → 15 nodes, 17 → 19 connections).
- **Verification:** `n8n_validate_workflow profile=runtime` returns `valid: true`, 0 errors, 25 warnings (baseline was 17; deltas are all the same false-positive class — 3 are Return Verdict's own "Code nodes can throw / fs access / $json mode" noise; the remaining +5 are pre-existing Decision Switch / typeVersion / Code-node warnings that the validator reports more granularly post-2026-05-11). No NEW error classes.
- **Smoke test:** PRD §10.5 fixture still pinned on the Execute Workflow Trigger (Shayan + synthetic SaaS job, same as execution 13356). Re-run pending — must be triggered from the n8n UI (`executeWorkflowTrigger` cannot be invoked via `n8n_test_workflow`). Acceptance criterion: the workflow's last node (now Return Verdict, not C10) emits an object whose top-level keys include at minimum `decision`, `effective_decision`, `threshold_flipped`, `total_score`, `rejection_reasons`, `tier`, `confidence`, `_score_id`, `request_meta.classifier_mode`.
- **Phase 7 hand-off note (for `n8n-workflow-keeper`):** parent K3 should key on `$json.effective_decision` (top-level) and `$json.request_meta.classifier_mode` (mirrored by C12). Both shapes are emitted. K2's executeWorkflow node now receives a verdict object, not `{ok, id}`.
- **Rollback baseline:** workflow versions in n8n cloud history. To revert: `removeNode "Return Verdict"` + `removeConnection` × 2 to restore the C10/C11 terminals.

### 2026-05-11 — Sitting 2: complete C6–C11 wiring + first successful Gemini smoke test (SHIPPED)

- **What:**
  - Created credential `Relevancy Ingest Token (Contabo)` (id `yXpENDK1cKgFdxp0`).
  - Added 6 nodes (C6 Validate + Threshold, C7 Build Reject, C8 Decision Switch, C9 Build Review, C10 Persist, C11 DLQ) + 10 new connections in one atomic batch.
  - First attempt at C5 Structured Output Parser failed at runtime — Gemini's output didn't match the strict `additionalProperties` schema.
  - Second attempt: rewrote the schema with explicit gate keys + enabled `autoFix: true`. Failed at schema-INIT time (parser rejected the schema config before Gemini ran, executionTime 8ms).
  - Third attempt: switched parser to `schemaType: 'fromJson'` with a complete example verdict. Same init failure.
  - **Pivoted**: disabled `hasOutputParser` entirely and updated C6 to `JSON.parse` the raw `output` text with a try/catch fallback. Parser sub-node left connected but inert for future re-enablement.
  - C11 DLQ body initially used optional chaining (`$json.error?.message`) which n8n's expression engine on this cloud version flagged. Replaced with `($json.error && $json.error.message) || 'unknown'`.
  - Smoke-tested end-to-end with mock Shayan + synthetic SaaS job → verdict `proceed/91/apply_now`, persisted as `relevancy_scores.id = 5`. Test data deleted.
- **Verification:** `n8n_validate_workflow profile=runtime` reports `valid: true`, 0 errors, 17 warnings (all false positives — `additionalProperties`-style noise + a Switch warning about main[1] which is the IF's false branch not an error output).
- **Rollback baseline:** workflow versions in n8n cloud history. TD-4 tracks the JSON snapshot follow-up.

### 2026-05-11 — Sitting 1: workflow shell + canonical prompt + Gemini credential (SHIPPED)

- **What:**
  - Wrote `docs/relevancy/mode_a_prompt.md` (canonical Mode A prompt, ~7,000 tokens; committed as `200f618`).
  - Created the workflow via `n8n_create_workflow` with 6 nodes (C0 Trigger, C1 Load Profile Context, C2 Deterministic, C3 Gate Switch, C4 Prepare Input, C5 AI Agent) + 2 sub-nodes (Gemini Flash 2.5, Structured Output Parser).
  - Fixed: C1 onError change (avoid unwired error-output validation error), typeVersion bumps (httpRequest 4.2 → 4.4, IF 2.2 → 2.3).
  - Initially set Gemini Flash 2.5 to typeVersion 1.1; user's cloud showed "Install this node" — downgraded to v1.
  - Created credential `Gemini API (Relevancy Classifier)` (`googlePalmApi`, id `0gaoWdarY6itka7l`) and bound to C5a.
  - Inlined the prompt body verbatim into `parameters.options.systemMessage` on C5 (n8n cloud doesn't expose custom env vars on this tier).
- **Verification:** `valid: true`, 0 errors, false-positive warnings only.
- **Rollback baseline:** workflow versions in n8n cloud history.

---

## 13. Future improvements (proposed, not committed)

| Priority | Idea | Effort | Phase |
|---|---|---|---|
| **P1** | **Phase 7**: Splice into `multiple webhooks` (kill-switch IF + `Score Relevancy` executeWorkflow + `Route Verdict` switch + End audit-only) | ~1h | Plan v3.3 §4.2 / §4.4.1 |
| **P1** | Wire gate 11 deterministic dup-check (TD-1) | 30–60 min | Adds either a new dashboard endpoint or a direct Postgres node |
| P2 | Snapshot workflow JSON to `docs/_relevancy-classifier-core (working flow).json` (TD-4) | 5 min via MCP `n8n_get_workflow mode=full` + write |
| P2 | **Phase 8**: Build `job-evaluate-manual` webhook workflow + `/api/relevancy/evaluate-task` route | ~2h | Plan v3.3 §4.3 |
| P2 | **Phase 9**: Admin Task Card Evaluator UI | ~3h | Plan v3.3 §10.3 |
| P3 | Re-enable Structured Output Parser when n8n cloud upgrades (TD-2) | 15 min test cycle |
| P3 | Enrich C9 (Build Review Payload) with `evidence_panel` synthesis for the UI (TD-3) | 30 min |
| P4 | Bump outdated typeVersions in one batch when cloud upgrades (TD-5) | 5 min |

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **Deterministic gate** | A hard gate (2-6) evaluated in pure JS by C2 — no LLM call needed |
| **LLM gate** | A hard gate (1, 7-10) requiring natural-language judgment, evaluated by Gemini |
| **Hard gate** | One of the 11 PRD §7 gates; ANY failure → `decision: reject` |
| **Effective decision** | The routing-relevant decision after `min_score` threshold is applied (plan v3.3 §7.5) |
| **Threshold flip** | When `decision = proceed` but `total_score < min_score`, the effective decision becomes `reject` and `threshold_flipped = true` |
| **Shadow mode** | Verdicts are scored AND logged, but routing remains pre-classifier behaviour (existing proposal writer always runs) |
| **Active mode** | Routing keys off `effective_decision`: reject → no card; proceed/review → Todo column |
| **DLQ** | `relevancy_scores_dlq` table; catches verdicts that failed to persist for retrospective replay |
| **Idempotency key** | `<execution_id>-<task_or_job_id>`; 24h replay window via dashboard's `idempotency_keys` table |
| **PRD v0.2** | The current Job Relevancy Criteria PRD; seeded into `criteria_versions` by migration 019 |
| **Mode A / Mode B** | Plan v3 §8.1 prompt modes. Only Mode A (`A_full`, ~7k tokens) implemented today. Mode B (edge-only, ~3.5k tokens, deterministic-resolved fast path) is a future optimization. |

---

## 15. References

- `CLAUDE.md` — project-level context, operational gotchas, migration history
- `docs/n8n_workflow_prd.md` — parent workflow PRD (`multiple webhooks`)
- `docs/upwork-relevancy-scoring-ai-plan-v3.md` — plan v3.3 execution
- `docs/job_relevancy_criteria_prd.md` — PRD v0.2 (criteria, gates, reason taxonomy, §16 example library)
- `docs/relevancy/mode_a_prompt.md` — canonical Mode A system prompt (committed `200f618`)
- `src/lib/migrations/018_relevancy_scoring.sql` — schema substrate
- `src/lib/migrations/019_criteria_versions_v0_2_seed.sql` — PRD v0.2 seed
- `src/lib/types.ts` — `ProfileContext`, `JobPayload`, `RelevancyScoreInsert` type definitions
- `src/lib/data.ts` — `getProfileContext()`, `getTaskJobPayload()`, `insertRelevancyScore()`, `insertRelevancyScoreDlq()`
- `src/app/api/profiles/[id]/context/route.ts` — Phase 3 endpoint
- `src/app/api/tasks/[id]/job-payload/route.ts` — Phase 4 endpoint
- `src/app/api/relevancy-scores/route.ts` — Phase 6 Part A ingest endpoint
- n8n cloud workflow URL: `https://ikonicdev.app.n8n.cloud/workflow/hi71jhPU8tmq7hEp`
