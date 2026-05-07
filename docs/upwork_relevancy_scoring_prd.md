# PRD — Upwork Relevancy Scoring (AI Layer)

> **Document version:** 0.1
> **Author:** Drafted by Claude in collaboration with M Waqas
> **Date:** 2026-05-05
> **Status:** Draft for stakeholder review
> **Companion to:** `docs/job_relevancy_criteria_prd.md` (Job Relevancy Criteria PRD v0.2 — the rule set this scoring layer operationalizes)
> **Source material:** `docs/upwork-relevancy-scoring-ai-plan.md` (untracked plan doc — adapted to the Rising Lions system in this PRD)

---

## 1. TL;DR

Add an **AI relevancy scorer** to the n8n ingest pipeline that returns a 0–100 score, a tier (`apply_now / strong / marginal / skip`), three proposal angles, and a one-line summary for every incoming Upwork job — *before* it hits an agent's Todo column.

The score is **advisory**, not gating. No automatic rejection. The Todo column auto-sorts by score so agents triage high-conviction work first. Score, tier, components, angles, and summary persist on `tasks.custom_fields` for calibration analysis.

**Decision model** is the scored rubric from the source plan doc — *not* the binary 11 hard gates from the companion PRD. The 11 gates live as **prompt context** inside the LLM call (so the model can reference them) and remain the agents' explicit triage checklist post-scoring. A future "cheap pre-filter" Code node that enforces the deterministic gates upstream of the LLM is out of scope for v1 (deferred per stakeholder, 2026-05-05).

This PRD is **operational, not descriptive** — its deliverable is a running n8n node + dashboard surface, not a written rule set.

---

## 2. Background

### 2.1 Relationship to the Job Relevancy Criteria PRD

| | Job Relevancy Criteria PRD (v0.2) | This PRD (Upwork Relevancy Scoring v0.1) |
|---|---|---|
| **Scope** | Defines *what makes a job relevant* | Defines *how to compute relevance at intake* |
| **Output** | 11 binary hard gates + 7 soft signals | 0–100 score + 4-tier label + components + angles |
| **Audience** | Bidding agents (manual application) | n8n workflow (automated) + agents (consume score on card) |
| **Status** | Descriptive — ratifies existing agent behavior | Operational — adds new automation |
| **Relationship** | Source of truth for the **content** of the rubric | Source of truth for the **runtime** that applies it |

Both documents are owned by their respective `relevancy-criteria-keeper` and `n8n-workflow-keeper` agents. This PRD lives next to the criteria PRD and references it but does not own its content. Threshold changes happen in the criteria PRD; this PRD picks them up by reference.

### 2.2 The pipeline today (recap)

```
Upwork → Vollna (per-profile feeds, stack-filtered)
       → n8n (8 per-agent webhooks, EWnZg3svZWwcIRs4)
       → Process Job (normalize + profile lookup + dedup)
       → Route Job (proceed | no_profile | rejected)
       → Build GPT Input → AI Agent (Claude Haiku 4.5 — proposal writer)
       → Format ClickUp Task → Create Board Task (Contabo) + Format Dashboard Event → Send to Self-Hosted Dashboard
       → Task Board (column "Todo")
       → Agent triages: keep & bid, or move to N/A with a reason
```

Today the agent's first read of every job is when it appears in Todo. There is **no upstream signal** of how relevant the job actually is — agents triage 1284 incoming jobs (681 N/A + 603 Proposal Submitted) without prioritization. This PRD adds an LLM-derived score *between* `Process Job` and `Build GPT Input`, so the score is on the card the moment it lands in Todo.

### 2.3 Why a score, not gates (v1)

The companion PRD's 11 gates are descriptive — they ratify what agents already do. They are also **brittle for v1 automation**: gate 1 (stack match) requires a `profiles.stack_keywords` column that does not exist yet (§9.4 process gap), and gate 10 (portfolio match) is fundamentally human-eyeball. Building gates first means shipping a half-coverage filter that hides work from agents without recourse.

A **scored advisory layer** instead lets us:
- Ship now without a schema migration or `_reason` taxonomy expansion.
- Calibrate against real outcomes (column moves to Won / Lost / N/A) before we trust automation.
- Generate proposal angles as a side effect, which the existing Claude proposal writer can consume.

When calibration data justifies it (Phase 6, §16), we add the cheap pre-filter as a hard pre-stage. The scored layer remains downstream.

---

## 3. Goals & Non-goals

### Goals
1. Compute a 0–100 relevancy score, a 4-tier label, and three proposal angles for **every n8n-sourced job** before the agent sees it.
2. Persist the score and its components on `tasks.custom_fields` so calibration analysis is queryable in SQL.
3. Surface the score on the Todo card and auto-sort the column by `total_score DESC`.
4. Pipe the proposal angles into the existing Claude proposal-writer prompt as hooks so generated proposals lead with concrete evidence.
5. Versioned prompt — `prompt_version` is stored per task so calibration is apples-to-apples after weight changes.

### Non-goals (v1)
- **No deterministic pre-filter.** The cheap-rules Code node from the source plan doc is deferred. Every job goes through the LLM.
- **No automatic rejection.** Tier `skip` does NOT route to N/A. The score is advisory; agents remain the only writers of `_reason` to N/A.
- **No new tables.** All score data lives in `tasks.custom_fields` JSONB. No `scores`, `outcomes`, or `profile` tables (the plan doc proposed these — they collide with existing patterns and duplicate data we already have on `tasks` lifecycle).
- **No new column on the board.** No "Low Priority" column. Todo carries every tier.
- **No HTML profile upload pipeline.** The plan doc assumed one freelancer with a saved profile HTML; we have 8 named profiles with structured data already in `profiles` and Vollna configs. We use what we have.
- **No notifications (Telegram / Slack).** The dashboard auto-refresh and the existing Task Board are the agent's primary UI. Notifications can be added in v2 if score-to-action latency is a measured problem.
- **No new model vendor.** We stay on Claude Haiku 4.5 via the existing `Aleem Anthropic account` credential — same as the proposal writer.
- **No retroactive scoring of historical tasks.** Scoring is intake-time only.

---

## 4. Stakeholders

| Role | Stake |
|---|---|
| Bidding agents | Consume the score on the Todo card; calibration feedback (which scores were right) |
| Agent leads / admins | Tune prompt weights based on score-to-outcome correlation |
| n8n / Vollna ops (M Waqas) | Owns the splice in workflow `EWnZg3svZWwcIRs4`; bumps prompt versions |
| Dashboard / data team | Renders score + tier on the card; writes calibration queries |
| relevancy-criteria-keeper agent | Owns the criteria PRD; this scoring PRD references those criteria |
| n8n-workflow-keeper agent | Owns the n8n splice once the design lands |

---

## 5. Definitions & glossary

| Term | Meaning |
|---|---|
| **Score** | Integer 0–100 returned by the LLM, sum of 7 component sub-scores |
| **Tier** | One of `apply_now (80–100) / strong (60–79) / marginal (40–59) / skip (0–39)` — derived from score |
| **Components** | The 7 sub-scores: `skill_match (30) / domain_match (15) / portfolio_evidence (20) / experience_level_fit (10) / client_quality (10) / competition_position (10) / red_flags (5)`. Each has `score`, `max`, `reason` |
| **Proposal angles** | Three short hooks the AI suggests the agent lead with — written to `_proposal_angles` and re-injected into the proposal writer prompt |
| **Prompt version** | A string like `"v1"`, `"v2"` stored alongside the score so calibration analysis can stratify by prompt revision |
| **In-context examples** | The §6.7 reject + §6.8 proceed example library from the criteria PRD, embedded in the LLM system prompt as labeled training data |

---

## 6. System overview

### 6.1 Where the scorer sits in the n8n flow

```
Merge All Webhooks
  → Process Job
    → Route Job (switch)
       │
       ├─ proceed    → ★ Score Job Relevancy (NEW)        ← THIS PRD
       │              └─ writes score/tier/angles onto item
       │              → Build GPT Input (consumes angles)
       │              → AI Agent - Proposal Writer
       │              → Merge Proposal with Job Data
       │              → Proposal OK?
       │                ├─ true  → Format ClickUp Task → Create Board Task (Contabo)
       │                │         → Format Dashboard Event → Send to Self-Hosted Dashboard
       │                └─ false → Extract Error → Format Dashboard Event → Send to Self-Hosted Dashboard
       ├─ no_profile → Format Dashboard Event
       ├─ rejected   → Format Dashboard Event
       └─ inactive/duplicate/weekend → (dead branches; orthogonal to this PRD)
```

The scorer is a **single new logical step** spliced onto the `proceed` branch of `Route Job`, before `Build GPT Input`. It runs on every job that Process Job blesses as `proceed` — typically all 8 agent feeds, post-dedup.

### 6.2 The contract

**Inputs** — the existing n8n item shape after `Process Job`:
- `job` — `{ id, title, description, url, budget, budgetType, skills, duration, postedDate, clientCountry, clientRating, clientSpent, clientHires, paymentVerified, applicants }`
- `profile_name`, `assigned_agent`, `stack`, `filterName`
- `_result: "proceed"`

**Outputs** — appended to the n8n item, consumed by `Build GPT Input` and `Format ClickUp Task`:
- `relevancyScore` — integer 0–100
- `relevancyTier` — `"apply_now" | "strong" | "marginal" | "skip"`
- `relevancyComponents` — object with the 7 sub-scores (`{ skill_match: { score, max, reason }, ... }`)
- `proposalAngles` — array of 3 strings
- `relevancySummary` — string (one or two sentences)
- `relevancyMissingSignals` — array of strings (fields the LLM wished it had)
- `relevancyModel` — string, e.g. `"claude-haiku-4-5-20251001"`
- `relevancyPromptVersion` — string, e.g. `"v1"`

**Side effects** — none. The scorer never writes to N/A, never short-circuits, never throws. On error it returns a `tier: "marginal"` placeholder with `relevancySummary: "scoring failed: <reason>"` so the agent still sees the card with a clear "this was unscored" signal.

---

## 7. The scoring rubric (LLM contract)

Inherited verbatim from the source plan doc. **Total score = sum of component scores. Maxes sum to 100.**

| Component | Max | What it measures |
|---|---|---|
| `skill_match` | 30 | Overlap between job's required skills and skills demonstrated by the assigned profile (n8n `_profile_name`) AND its agent's win history |
| `domain_match` | 15 | Industry/domain alignment with the profile's prior wins (e.g. SaaS, fintech, e-commerce) |
| `portfolio_evidence` | 20 | Concrete past project mirroring this job's needs — direct evidence beats keyword overlap |
| `experience_level_fit` | 10 | Job seniority signals vs. profile's rate range, JSS, hire history |
| `client_quality` | 10 | Payment verified, client lifetime spent, hire count, rating |
| `competition_position` | 10 | Proposal count at triage, post freshness, niche depth |
| `red_flags` | 5 | Vague description, suspicious budget, scope creep signals, template-feeling posts. **Higher score = fewer red flags** |

**Tiers** (boundaries inclusive on the lower end):

| Score | Tier | Meaning |
|---|---|---|
| 80–100 | `apply_now` | High conviction; bid quickly |
| 60–79  | `strong` | Solid fit; bid with care |
| 40–59  | `marginal` | Borderline; agent eyeball decides |
| 0–39   | `skip` | Likely waste of connects; agent confirms before sending to N/A |

**Tier semantics in our system** are *advisory only* (see §8). `skip` does not route automatically.

---

## 8. Tier action mapping

The scorer's outputs influence the board in two ways:

### 8.1 Todo column ordering
The `Todo` column auto-sorts by `relevancyScore DESC`. `apply_now` cards float to the top; `skip` cards sink to the bottom. Manual drag still wins (a position override on a card persists; new cards inserted by n8n re-flow around it).

**Implementation note.** Board rendering already supports per-column ordering (see `src/components/tasks/board-column.tsx` and the `position` field on `tasks`). v1 adds a server-side sort fallback in `getTasksByProject` for the `Todo` column when no manual position has been set: `ORDER BY (custom_fields->>'_relevancy_score')::int DESC NULLS LAST, position ASC, created_at ASC`. Tasks with no score (manual cards, legacy n8n cards from before this PRD ships) fall to the bottom of the score-sorted set, above the manual-position section.

### 8.2 Tier badge on the card
Each card renders a small tier badge in the top-right of the title area:

| Tier | Badge color | Tooltip |
|---|---|---|
| `apply_now` | green | "AI relevancy: 92 — apply now" |
| `strong` | blue | "AI relevancy: 71 — strong fit" |
| `marginal` | amber | "AI relevancy: 48 — marginal" |
| `skip` | gray (dimmed) | "AI relevancy: 23 — skip suggested" |

Click the badge → opens the existing task detail modal scrolled to a new "Relevancy" section that renders the 7 components, each with its `score / max` and the LLM's `reason`. Also shows the three proposal angles, the missing-signals list, the prompt version, and the model name.

### 8.3 Explicitly NOT happening
- **No auto-route to N/A.** Even `skip = 0` lands in Todo.
- **No auto-route to Won / Negotiation / etc.** Score does not influence anything but Todo ordering and the badge.
- **No new `_reason` label** like "Low relevance". Agents keep using the existing 13 from §6.2 of the criteria PRD.

---

## 9. Storage model

### 9.1 `tasks.custom_fields` extensions

All new keys are added to the existing JSONB `custom_fields` on `tasks`. **No schema migration**.

| Key | Type | Source | Example |
|---|---|---|---|
| `_relevancy_score` | integer (0–100) | Scorer | `82` |
| `_relevancy_tier` | string | Scorer | `"apply_now"` |
| `_relevancy_components` | object | Scorer | `{ "skill_match": { "score": 26, "max": 30, "reason": "..." }, ... }` |
| `_proposal_angles` | array of strings | Scorer | `["Lead with the n8n + Claude case study", "...", "..."]` |
| `_relevancy_summary` | string | Scorer | `"Strong stack alignment + verified client at $45k spend; main risk is 30+ proposals already submitted."` |
| `_relevancy_missing_signals` | array of strings | Scorer | `["client_total_spent unknown", "post_age unknown"]` |
| `_relevancy_model` | string | Scorer | `"claude-haiku-4-5-20251001"` |
| `_relevancy_prompt_version` | string | Scorer | `"v1"` |
| `_relevancy_scored_at` | ISO 8601 | Scorer | `"2026-05-05T14:23:11Z"` |

### 9.2 Custom field definitions
For dashboard rendering and filter UX, register **one** custom field definition that exposes the score as a sortable/filterable number. The other keys remain unregistered — they're consumed only by the detail modal and SQL.

```sql
INSERT INTO custom_field_definitions (project_id, name, slug, type, position, options)
VALUES (
  '<default-project-id>',
  'AI Relevancy Score',
  '_relevancy_score',
  'number',
  <next-position>,
  '{"min": 0, "max": 100, "showOnCard": true, "displayFormat": "score"}'::jsonb
)
ON CONFLICT (project_id, slug) DO NOTHING;
```

A second registration may be added in v2 for `_relevancy_tier` if the saved-views feature gets a tier filter. v1 leaves it as ad-hoc JSONB read.

### 9.3 What's deliberately NOT created

The source plan doc proposes four new tables (`profile`, `jobs`, `scores`, `outcomes`). All four are rejected for v1:

| Plan-doc table | Why we don't need it |
|---|---|
| `profile` | We have `profiles` table + Vollna feed configs. No HTML upload pipeline in v1. |
| `jobs` (plan-doc's) | We already have `jobs` table — different schema, but its `tasks.custom_fields._job_id` link covers the relationship. The plan-doc's `jobs` would shadow ours. |
| `scores` | All score fields live on `tasks.custom_fields` (one row, one task, one score — no need for a separate audit table). Calibration queries do `SELECT custom_fields->>'_relevancy_score', column_id, ...` directly. |
| `outcomes` | We already have lifecycle on `tasks` — column moves are the outcome record. Joining `tasks.custom_fields->>'_relevancy_score'` to the current column name gives us "score → final stage" for free. |

---

## 10. n8n integration

### 10.1 Splice

**Location:** Workflow `EWnZg3svZWwcIRs4` ("multiple webhooks"), after `Route Job` on the `proceed` branch, before `Build GPT Input`.

**Three new nodes** (one Code node + one LLM node + one parser node):

```
Route Job (proceed) → Build Score Input (Code v2)
                    → AI Agent - Relevancy Scorer (langchain.agent v3.1, w/ Anthropic LM + Structured Output Parser)
                    → Merge Score with Job Data (set/code v2)
                    → Build GPT Input (existing — modified to consume relevancyAngles)
```

| Node | Type | Purpose |
|---|---|---|
| `Build Score Input` | `n8n-nodes-base.code` v2 | Pure JS. Constructs the LLM input string from `item.job + item.profile_name + item.assigned_agent + item.stack`. Embeds in-context examples (see §11.3). Emits `scoreInput` field. |
| `AI Agent - Relevancy Scorer` | `@n8n/n8n-nodes-langchain.agent` v3.1 | Single-shot agent. Sub-nodes: `Claude Chat Model - Scorer` (Anthropic, Haiku 4.5, temp 0.2) + `Structured Output Parser - Score` (autoFix true, see §11.4 for schema). Output: parsed JSON. |
| `Merge Score with Job Data` | `n8n-nodes-base.set` (or code v2) | Maps the parsed JSON back onto `item`. Adds `relevancyScore`, `relevancyTier`, `relevancyComponents`, `proposalAngles`, `relevancySummary`, `relevancyMissingSignals`, `relevancyModel`, `relevancyPromptVersion`, `relevancyScoredAt`. |

**Existing nodes touched (modified):**
- `Build GPT Input` — read `item.proposalAngles`, append to the proposal-writer prompt as a "ANGLES TO LEAD WITH" hint section.
- `Format ClickUp Task` — write the new fields into `custom_fields._relevancy_*` keys on the outbound POST body to `/api/v1/webhooks/tasks`.
- `Format Dashboard Event` — pass-through, fields already flow via the same `taskName + custom_fields` shape (no change needed unless we want to expose the score in the dashboard webhook payload too — out of scope for v1).

### 10.2 Error handling

- **`onError: continueRegularOutput`** on the `AI Agent - Relevancy Scorer` node.
- If the parser fails or the LLM 5xx's: `Merge Score with Job Data` falls back to a placeholder — `score: 50`, `tier: "marginal"`, `components: {}`, `proposalAngles: []`, `summary: "scoring failed: <error class>"`, `model: "fallback"`, `promptVersion: "v1"`. The job continues to `Build GPT Input` and the proposal writer; the agent sees a marginal-tier card with the failure note in the detail modal.
- **Retry policy** on the LLM HTTP layer: 3 attempts, exponential backoff (1s / 4s / 16s). Standard for the langchain Anthropic node (already used by the proposal writer).

### 10.3 No-op for non-`proceed` jobs

`Route Job`'s `no_profile` and `rejected` branches do NOT go through the scorer. They flow directly to `Format Dashboard Event` as today. A rejected-by-`Process Job` job has no profile context to score against and no card on the board, so a score would be wasted.

### 10.4 Latency budget

The proposal writer call today is ~7–10 seconds end-to-end (per n8n executions snapshot). Adding a second LLM call to the same `proceed` branch adds approximately the same latency at most. Our latency-is-Vollna-bound memory note (p50 = 2 min, p95 = 10 min end-to-end) confirms LLM time is not the bottleneck — Vollna pause/resume is. The score node is safe to add without breaching SLAs.

---

## 11. The LLM call

### 11.1 Model

**Claude Haiku 4.5** — model ID `claude-haiku-4-5-20251001`, accessed via the existing `Aleem Anthropic account` credential (id `fVtEWZhGXzEBZDoS`). Same model the proposal writer uses; same credential; same usage pattern. **No new vendor onboarding.**

Why not Gemini Flash (the plan doc's choice)? Three reasons:
1. We already have the Anthropic credential wired and rate-limited; adding Gemini means a second API key, a second cost line, and a second failure surface.
2. Claude's structured-output via the langchain Anthropic node + Structured Output Parser is the proven pattern in our flow. Gemini's `responseSchema` works but is a new pattern to maintain.
3. Cost parity is good enough — Haiku 4.5 input/output is competitive with Flash at the prompt sizes we're dealing with (a few thousand input tokens, a few hundred output).

If post-launch cost or latency analysis ever justifies it, the model node is swap-out-able without touching the rest of the splice. Tracked under §16 Open Questions.

### 11.2 Temperature

`0.2` — same as the proposal writer. Low enough to keep scores stable across retries of the same input; high enough that the model can synthesize subjective component reasons.

### 11.3 Prompt structure

**System prompt** (versioned `v1`; embedded in the `Claude Chat Model - Scorer` node's system message field):

```
You are a senior Upwork strategist scoring fit between a freelancer profile and a
specific job posting. Be strict, evidence-based, and skeptical — your goal is to
save the agent's time, not encourage every application. Always cite specific
evidence from the profile or job in each component's reason field.

SCORING RUBRIC (max 100):
- skill_match (30): Overlap between job's required skills and skills demonstrated
  by the assigned profile and its agent's past wins. Penalize skills merely listed
  but never used in completed jobs.
- domain_match (15): Industry/domain alignment with prior work history.
- portfolio_evidence (20): Concrete past project mirroring this job's needs.
  Direct evidence beats keywords.
- experience_level_fit (10): Job seniority signals vs. the profile's rate range
  and history.
- client_quality (10): Payment verified, lifetime spent, hire count, rating.
- competition_position (10): Proposal count at triage, post freshness, niche depth.
- red_flags (5): Vague description, suspicious budget, scope creep signals,
  template-feeling posts. HIGHER score = FEWER red flags.

TIERS by total_score:
- 80–100: apply_now
- 60–79:  strong
- 40–59:  marginal
- 0–39:   skip

PROPOSAL ANGLES: provide 3 specific hooks the agent should lead with, referencing
actual past projects or skills from the assigned profile. Generic angles are useless.

CONTEXT — gates the agent applies:
The agent's hard rejection criteria (these inform your scoring; do not auto-reject
on them — leave the decision to the agent):
1. Stack match (job's primary skill ∈ profile's stack bucket)
2. Job freshness (≤ 24h)
3. Proposal saturation (< 30 proposals at triage)
4. Hourly floor (bottom of range ≥ $25/hr)
5. Client lifetime spend ≥ $1,000
6. Client rating ≥ 4.0
7. Job availability (open, not "filled")
8. No country residency lock-in
9. No video-proposal requirement
10. Portfolio match available
11. No duplicate _job_id in last 30 days

If a job clearly fails one of these gates, reflect it in the relevant component
score and call it out in the component's reason field. Never invent gates not
listed above.

LABELED EXAMPLES (calibration data — these are real triage decisions from the
production board, snapshot 2026-05-05):

REJECT EXAMPLES (each shows the input the AI saw + why agents rejected):
{{embedded JSON snippet from criteria PRD §16 reject_examples}}

PROCEED EXAMPLES (each shows the input the AI saw + outcome stage reached):
{{embedded JSON snippet from criteria PRD §16 proceed_examples}}

Return ONLY JSON matching the schema. No prose outside the JSON.
```

**User message** (templated by `Build Score Input`):

```
PROFILE:
- Name: {{profile_name}}
- Assigned agent: {{assigned_agent}}
- Stack bucket (Vollna): {{stack}}

JOB:
- Title: {{job.title}}
- Description: {{job.description}}
- URL: {{job.url}}
- Budget: {{job.budget}} ({{job.budgetType}})
- Skills: {{job.skills}}
- Duration: {{job.duration}}
- Posted at: {{job.postedDate}}
- Client country: {{job.clientCountry}}
- Client rating: {{job.clientRating}}
- Client lifetime spent: {{job.clientSpent}}
- Client hires: {{job.clientHires}}
- Payment verified: {{job.paymentVerified}}
- Proposals so far: {{job.applicants}}

Score this job.
```

### 11.4 Output schema (Structured Output Parser)

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["components", "total_score", "tier", "top_3_proposal_angles", "summary"],
  "properties": {
    "components": {
      "type": "object",
      "additionalProperties": false,
      "required": ["skill_match", "domain_match", "portfolio_evidence", "experience_level_fit", "client_quality", "competition_position", "red_flags"],
      "properties": {
        "skill_match":          { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":30}, "max": {"type":"integer","const":30}, "reason": {"type":"string"} } },
        "domain_match":         { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":15}, "max": {"type":"integer","const":15}, "reason": {"type":"string"} } },
        "portfolio_evidence":   { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":20}, "max": {"type":"integer","const":20}, "reason": {"type":"string"} } },
        "experience_level_fit": { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":10}, "max": {"type":"integer","const":10}, "reason": {"type":"string"} } },
        "client_quality":       { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":10}, "max": {"type":"integer","const":10}, "reason": {"type":"string"} } },
        "competition_position": { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":10}, "max": {"type":"integer","const":10}, "reason": {"type":"string"} } },
        "red_flags":            { "type": "object", "required": ["score","max","reason"], "properties": { "score": {"type":"integer","minimum":0,"maximum":5},  "max": {"type":"integer","const":5},  "reason": {"type":"string"} } }
      }
    },
    "total_score": { "type": "integer", "minimum": 0, "maximum": 100 },
    "tier": { "type": "string", "enum": ["apply_now","strong","marginal","skip"] },
    "top_3_proposal_angles": { "type": "array", "items": {"type":"string"}, "minItems": 3, "maxItems": 3 },
    "missing_signals": { "type": "array", "items": {"type":"string"} },
    "summary": { "type": "string", "maxLength": 280 }
  }
}
```

A `Build Score Input` post-processing assertion validates `total_score == sum(components[*].score)` — on mismatch, log a warning and trust the component sum (override `total_score`). Same pattern as the proposal writer's `_proposalOk` check.

### 11.5 In-context examples (the §6.7 / §6.8 / §16 lockstep payload)

The criteria PRD's §16 Appendix C is exactly what the LLM needs as labeled training data. The prompt embeds it verbatim — `reject_examples[]` and `proceed_examples[]` arrays. **The relevancy-criteria-keeper agent is the source of truth for that payload.** When examples are added/removed/edited there, the prompt re-embeds the new payload on next n8n redeploy. No duplication.

A **profile-aware filter** at runtime (in `Build Score Input`) preferentially shows examples whose `profile` field matches the current job's `profile_name`, falling back to all examples if fewer than 3 profile matches exist. This gives the model the most relevant calibration data without bloating context.

---

## 12. Profile representation

### 12.1 What the LLM sees as "the profile"

For v1 — a **lean tuple**:

```
profile_name      string   (e.g. "Sana", "Khansa", "Shayan")
assigned_agent    string   (e.g. "Sana", "Aleem", "Khansa")
stack             string   (the Vollna stack bucket as a comma-separated string, e.g. "Laravel, PHP, Node.js, React.js, Vue.js, ...")
```

That's it. **No HTML upload, no Upwork JSS extraction, no rich `work_history` or `portfolio` arrays.** Reasons:

- Our system has 8 profiles, not 1. Building the plan doc's profile-extraction pipeline 8 times is high effort for marginal LLM benefit at v1.
- The Vollna stack bucket already encodes the profile's competence area — it's the same input agents use to triage today.
- The §16 example library *is* the profile's history-on-tap. Each labeled example carries its own `profile` tag, so the model sees concrete examples of "what Sana wins" / "what Shayan rejects" without us having to model it explicitly.

### 12.2 Source of `stack`

**Today.** The Vollna stack bucket lives in the Vollna feed config — not in our DB. n8n's `Process Job` doesn't currently propagate it to the item.

**v1 fix.** Adopt the criteria PRD §10.1 Option A — add `profiles.stack_keywords TEXT[]` (single Postgres array column). Backfill manually from each profile's Vollna feed config (one-time admin task, ~30 min total). Serve via a new field on `GET /api/profiles/mapping` so n8n's `Process Job` can fetch it alongside the existing profile lookup. Add `stack` to the item shape downstream.

This is a **small targeted schema change** — one column, one backfill, one API field. It's required for v1 because without it, gate 1 (stack match) is invisible to the LLM and `skill_match` scoring loses its anchor. It is NOT a full v2 build — keyword overlap analytics, history, cross-profile rollups all stay deferred.

### 12.3 What's deferred to v2
- HTML profile upload + Gemini extraction (per plan doc Phase 1)
- Per-profile JSS, total_earnings, hourly_rate, work_history, portfolio embeddings
- A `profile_stacks` lookup table (criteria PRD §10.1 Option B) — the array column suffices for now

---

## 13. UI surfacing

### 13.1 Files to touch (smallest viable surface)

| File | Change |
|---|---|
| `src/components/tasks/task-card.tsx` | Render tier badge (top-right) + tooltip showing score; only when `_relevancy_score IS NOT NULL` |
| `src/components/tasks/task-detail-modal.tsx` | New "Relevancy" section below "Job Snapshot" — renders 7 components (`name / score / max / reason`), proposal angles (3 bullets), missing signals, summary, model name, prompt version, scored_at |
| `src/components/tasks/board-column.tsx` | When column name = "Todo", apply the score-sort fallback ordering described in §8.1 |
| `src/lib/task-data.ts` | `getTasksByProject` — add the score-sort SQL clause (only for the Todo column; gated on column name) |
| `src/components/tasks/custom-field-renderer.tsx` | Number type already handled — but add `displayFormat: "score"` rendering hint that shows tier color + score (e.g. green "82") instead of raw integer |
| `src/components/tasks/task-create-full.tsx`, `task-full-view.tsx` | **Read-only display** of the `_relevancy_*` fields if present — no edit UI in v1 (the LLM owns these fields) |

### 13.2 Filter UX (saved views)

Once `_relevancy_score` is registered as a custom field (§9.2), it shows up in the existing custom-field filter (`src/components/tasks/custom-field-filter.tsx`) with number-comparison ops (`> 70`, `≥ 80`, etc.). No new component. Saved views can pin "Score ≥ 70" as a default for an agent.

### 13.3 What's deliberately NOT shown in v1
- A separate "Relevancy" page or report — calibration is SQL-driven for the first phase. We don't pre-build dashboards before we have data.
- Edit UI for any `_relevancy_*` field. The LLM is the only writer.
- A "re-score this card" button. Out of scope for v1 — handled by deleting and re-ingesting if needed.

---

## 14. Calibration

### 14.1 The dataset

Calibration data is **already on `tasks`** — no new table. After 2–4 weeks of production scoring, run:

```sql
SELECT
  custom_fields->>'_relevancy_tier' AS tier,
  c.name AS final_column,
  COUNT(*) AS n
FROM tasks t
JOIN columns c ON c.id = t.column_id
WHERE custom_fields ? '_relevancy_score'
  AND custom_fields->>'_relevancy_prompt_version' = 'v1'
GROUP BY 1, 2
ORDER BY 1, 2;
```

This gives "tier × final column" — i.e. did `apply_now` cards reach Won / In Chat / Proposal Views at higher rates than `marginal`? If `60–79` (strong) cards convert *better* than `80+` (apply_now), the rubric is over-weighting something. Standard correlation analysis from there.

### 14.2 Component-level analysis

```sql
SELECT
  c.name AS final_column,
  ROUND(AVG((custom_fields->'_relevancy_components'->'skill_match'->>'score')::numeric), 1) AS avg_skill_match,
  ROUND(AVG((custom_fields->'_relevancy_components'->'client_quality'->>'score')::numeric), 1) AS avg_client_quality,
  -- ...
  COUNT(*) AS n
FROM tasks t
JOIN columns c ON c.id = t.column_id
WHERE custom_fields ? '_relevancy_score'
  AND custom_fields->>'_relevancy_prompt_version' = 'v1'
GROUP BY 1
ORDER BY n DESC;
```

Tells us which sub-scores discriminate winners from losers. Reweight in v2 prompt.

### 14.3 Versioning protocol

When the rubric weights or system prompt change:
1. Bump `prompt_version` to `v2` in the n8n `Build Score Input` Code node.
2. From that moment, new tasks carry `_relevancy_prompt_version = 'v2'`.
3. Old `v1` tasks stay tagged `v1` — they are stratified separately in calibration analysis.
4. Append a row to this PRD's §22 changelog describing the change and the rationale (data correlation finding, stakeholder decision, etc.).
5. The `relevancy-criteria-keeper` agent does NOT own the prompt version — that's owned here. But if the prompt change reflects a §6.2 / §7 / §8 change in the criteria PRD, the criteria PRD bumps first (its own changelog), and this PRD references the criteria-PRD version that was current at the time.

### 14.4 What we don't measure in v1
- Cost per scored job (tracked at the credential level, not per-task)
- Latency per scored job (n8n already records this in execution logs)
- Per-profile rubric drift (deferred to v2 once we have enough volume per profile)

---

## 15. Process gaps inherited from the criteria PRD

This PRD does NOT solve the §9 gaps in the criteria PRD. It either tolerates them or works around them:

| Criteria-PRD gap | This PRD's stance |
|---|---|
| §9.1 `_reason` blank in 19% of N/A | Tolerated. Score does not depend on `_reason`. Calibration analysis filters to scored-tasks-with-final-column only. |
| §9.2 Typo'd labels ("Low Higher rate", "Location loc") | Tolerated. The system prompt embeds them verbatim in the gate context (§11.3) and §16 examples preserve them. The LLM's reason fields may use proper spelling — that's a free-form output, not a label. |
| §9.3 Proceed flow drops n8n metadata (124/603) | **Critical to fix before calibration is reliable.** Calibration on Won data is severely undercounted today (1 n8n-sourced Won task). Until §9.3 ships, calibration relies primarily on Proposal Submitted + Proposal Views + In Chat outcomes. Flagged as a **risk**, not a blocker — we ship scoring even with poor end-stage signal, because the decision-stage signals are dense. |
| §9.4 `profiles.stack` unused | **Resolved by this PRD's §12.2.** New `profiles.stack_keywords TEXT[]` column + backfill is a v1 line item. |
| §9.5 Tag-case drift (`Shayan` vs `shayan`) | Tolerated. `Build Score Input` lowercases `profile_name` before passing to LLM. |
| §9.6 Nawal idle | Tolerated. Nawal scoring won't fire because Nawal has no traffic. Re-evaluate if/when Nawal's feed turns on. |

---

## 16. Open questions

Listed for resolution before this PRD becomes v1.0.

1. **Cheap pre-filter timing.** When do we add the deterministic gate Code node upstream of the LLM (the deferred plan-doc Phase 3)? Trigger: when LLM cost or latency becomes measurable; OR when calibration shows a stable subset of jobs always score `skip` for the same machine-checkable reason (e.g. proposal saturation > 30).
2. **Model swap.** Do we benchmark Gemini Flash vs Claude Haiku 4.5 on the same 100 scored jobs to compare cost / score stability / proposal-angle quality? Decision deferred to post-launch + 2 weeks of data.
3. **Per-profile rubric.** Should component weights vary by profile? E.g. Khansa's wins lean on `domain_match` more than Sana's. Premature without volume; revisit at v2.
4. **`skip` auto-route.** Should we ever auto-route `skip` tier to N/A with a new `_reason` label? Today: no. Threshold for revisiting: `skip` cards reach Proposal Submitted or beyond at < 5% rate after 4 weeks.
5. **Proposal-angle injection mechanics.** Today the angles flow into `Build GPT Input` as a "ANGLES TO LEAD WITH" hint. Do we want the proposal writer to *strictly* use one angle, or is the hint advisory? Calibrate against the proposal writer's existing hook A/B/C rotation.
6. **Re-score on edit.** If an agent updates a card's `_budget` or `_client_rating` via the UI, do we trigger a re-score? v1: no. v2: maybe a "Re-score" button.
7. **Score visibility for agents vs admins.** Agents see scores on their own profile's cards. Admins see all. Confirm this matches the existing role model — `(agent)/my-tasks/page.tsx` already filters to assigned cards only, so the score field is naturally scoped.

---

## 17. Rollout plan

| Phase | Scope | Owner | Done when |
|---|---|---|---|
| **0. PRD review** | Stakeholder review of this document | Waqas | Sign-off on §7 rubric + §8 tier mapping + §11 prompt |
| **1. Schema prep** | Add `profiles.stack_keywords TEXT[]`; backfill from Vollna feed configs (one row per active profile); register `_relevancy_score` custom field; add `stack_keywords` to `GET /api/profiles/mapping` response | Dashboard team | Migration applied, mapping API serves new field, n8n test execution sees `stack` on item |
| **2. n8n splice (dry-run)** | Add the 3 new nodes (`Build Score Input` / `AI Agent - Relevancy Scorer` / `Merge Score with Job Data`) on a **branch copy** of workflow `EWnZg3svZWwcIRs4`. Don't connect to `Build GPT Input` yet — just observe outputs in execution logs for 50 real jobs. | n8n-workflow-keeper | 50 dry-run executions complete with parsed-JSON outputs visible in logs |
| **3. n8n splice (live)** | Cut over the splice. `Build GPT Input` reads `proposalAngles`. `Format ClickUp Task` writes `_relevancy_*` fields. Monitor for 1 week. | n8n-workflow-keeper | All n8n-sourced Todo cards from cutover onward carry `_relevancy_score` |
| **4. UI surfacing** | Tier badge on card; Relevancy section in detail modal; Todo column score-sort | Dashboard team | Cards visibly show tier; `getTasksByProject` returns Todo sorted by score |
| **5. Calibration window** | 2–4 weeks of observation. Run §14 SQL queries. Compute tier-to-outcome correlation. | Waqas | Stratified report ready for v2 prompt revision |
| **6. v2 prompt** | Revise weights / wording based on Phase 5 data. Bump `prompt_version: "v2"`. | n8n-workflow-keeper + relevancy-criteria-keeper (if criteria change) | New prompt deployed; old `v1` tasks remain tagged for historical analysis |
| **7. Cheap pre-filter (deferred)** | Add the deterministic gate Code node upstream of the scorer. Auto-route hard-fail jobs to N/A with matching `_reason`. **Out of scope of v1; tracked here.** | n8n-workflow-keeper | LLM cost halves; gate-failed jobs no longer touch the model |

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| Calibration is noisy because §9.3 (proceed-flow metadata drop) is unfixed → only 21% of Proposal Submitted have full custom_fields | Calibrate on Proposal Views / In Chat / Won lifecycle moves of the 668 n8n-sourced N/A baseline + the n8n-sourced subset of Proposal Submitted. Flag the small Won sample (n=1) explicitly in any calibration report. Ship the §9.3 fix as a parallel track. |
| LLM hallucinates non-existent gates ("Failed gate 12: foo") in component reason fields | System prompt explicitly says "Never invent gates not listed above." Light grep on reason text in calibration; if seen > 5% of cards, tighten prompt. |
| Score-sort reorders Todo unexpectedly when an agent has manually arranged cards | The `position` field still wins for explicit drags. Score-sort is the *fallback* for cards with no manual position. Document this in agent-facing docs (`AGENT_USER_GUIDE.md` update). |
| LLM call latency adds material time to the proposal-writer pipeline | Existing measurement: per-job execution is ~7–14s end-to-end today (n8n executions snapshot). Adding a similar Haiku call doubles to ~14–28s worst case — still well inside Vollna's pause/resume tail (p95 ~10 min). Monitor; if any single job exceeds 60s, investigate. |
| Prompt embedding §16 examples grows large; context window pressure | §16 currently has 36 reject + 12 proceed = 48 examples. At ~150 tokens each = 7.2k tokens. Haiku 4.5 has 200k context. Comfortable for years. |
| Agents game the score by manually re-ordering low-score cards to the top | Not actually a risk — that's by design. The score is advisory. Agents who consistently override `apply_now` toward `skip` are signal for prompt recalibration, not policy enforcement. |
| `_relevancy_*` fields balloon `tasks.custom_fields` JSONB size | At ~2 KB per scored task × 1000 tasks/month = 2 MB/month. Postgres handles it without index pressure. |

---

## 19. Cost expectation

Per job at v1 prompt size (≈ 3k input tokens with §16 examples + ~600 output tokens):
- Claude Haiku 4.5 input ≈ $0.0024 per call
- Claude Haiku 4.5 output ≈ $0.0024 per call
- **Per-job cost ≈ $0.005**

At observed volume (~50 jobs/day across 8 profiles, per recent execution snapshot): **~$7.50/month**. The cheap pre-filter (deferred) would cut this further by skipping the LLM on hard-fail jobs (PRD-criteria suggests ~50% of intake hard-fails on machine-checkable gates) → ~$3.75/month at v2.

Profile extraction (plan doc Phase 1) is not in our v1 scope, so the one-time / weekly cost there is zero.

---

## 20. Appendix A — Example LLM call (round-trip)

**Input** (constructed by `Build Score Input`):

```
USER:
PROFILE:
- Name: Sana
- Assigned agent: Sana
- Stack bucket (Vollna): Laravel, PHP, Node.js, React.js, Vue.js, SaaS, NestJS, WordPress, jQuery, WooCommerce, CMS Dev, WordPress Plugin, Next.js, fullstack, Nuxt, TypeScript, plugin

JOB:
- Title: Senior Full Stack Architect / Technical Lead
- Description: We're building a fintech SaaS platform. Need a senior architect to lead the technical direction across NestJS backend, Python AI services, and React frontend. ~3-month engagement, possible extension.
- URL: https://www.upwork.com/jobs/...
- Budget: 25 - 35 USD (hourly)
- Skills: NestJS, Python, React, Node.js
- Duration: 3 to 6 months
- Posted at: 2026-05-05T10:00:00Z
- Client country: United States
- Client rating: 4.96
- Client lifetime spent: 8410
- Client hires: 103
- Payment verified: true
- Proposals so far: 8

Score this job.
```

**Output** (parsed by Structured Output Parser):

```json
{
  "components": {
    "skill_match":          { "score": 27, "max": 30, "reason": "NestJS + Node.js + React are core to Sana's stack bucket; Python AI services are an adjacent but reasonable fit (not in Sana's primary bucket)." },
    "domain_match":         { "score": 12, "max": 15, "reason": "Fintech SaaS aligns with Sana's prior SaaS work; specific fintech experience inferred via on-stack examples." },
    "portfolio_evidence":   { "score": 16, "max": 20, "reason": "Multiple Sana-tagged proceed examples involve NestJS + AI services (e.g. document pipeline maintenance). Direct architect-level evidence is partial." },
    "experience_level_fit": { "score": 8,  "max": 10, "reason": "$25–35/hr range fits Sana's typical billing; senior architect role aligns with profile seniority." },
    "client_quality":       { "score": 9,  "max": 10, "reason": "$8.4k spend, 103 hires, 4.96 rating, payment verified — strong client signal." },
    "competition_position": { "score": 8,  "max": 10, "reason": "8 proposals — well under saturation. Posted today (fresh)." },
    "red_flags":            { "score": 4,  "max": 5,  "reason": "Description is concrete; budget is hourly with a sane range; no scope creep signals. Minor: 'possible extension' is vague but normal for engineering work." }
  },
  "total_score": 84,
  "tier": "apply_now",
  "top_3_proposal_angles": [
    "Lead with Sana's NestJS + AI document pipeline case study — 'on-call maintenance for a $190k-spend client' shows architect-level NestJS in production.",
    "Position Sana as a polyglot architect: NestJS for the API layer, Python for AI services orchestration. Cite the prior Claude API integration work.",
    "Address fintech-specific risk (compliance, audit trails) directly: offer to start with a 1-week architecture spike before the 3-month commitment."
  ],
  "missing_signals": ["JSS score not provided", "Client country tax/compliance jurisdiction"],
  "summary": "Strong stack alignment + verified high-history client + fresh posting at 8 proposals. Architect role matches profile seniority; only minor noise on portfolio depth and Python adjacency."
}
```

**Stored on `tasks.custom_fields`:**

```json
{
  "_job_id": "~0123abc",
  "_assigned_agent": "Sana",
  "_profile_name": "Sana",
  "_source": "n8n",
  "_relevancy_score": 84,
  "_relevancy_tier": "apply_now",
  "_relevancy_components": { "skill_match": {...}, ... },
  "_proposal_angles": ["Lead with Sana's NestJS...", "...", "..."],
  "_relevancy_summary": "Strong stack alignment...",
  "_relevancy_missing_signals": ["JSS score not provided", "Client country tax/compliance jurisdiction"],
  "_relevancy_model": "claude-haiku-4-5-20251001",
  "_relevancy_prompt_version": "v1",
  "_relevancy_scored_at": "2026-05-05T10:00:14Z"
}
```

---

## 21. Appendix B — Files to be touched (and what owns them)

| File | Change | Owned by |
|---|---|---|
| `docs/job_relevancy_criteria_prd.md` | None (read-only reference for §16 examples + §6.2 / §7 content) | relevancy-criteria-keeper |
| `docs/upwork_relevancy_scoring_prd.md` (this file) | Source of truth | (no agent yet — see §22 changelog) |
| n8n workflow `EWnZg3svZWwcIRs4` | Add 3 nodes (Build Score Input / AI Agent - Relevancy Scorer / Merge Score with Job Data); modify Build GPT Input + Format ClickUp Task | n8n-workflow-keeper |
| `src/lib/migrations/017_profile_stack_keywords.sql` (new) | `ALTER TABLE profiles ADD COLUMN stack_keywords TEXT[] DEFAULT '{}'::text[];` + backfill | dashboard / data engineer |
| `src/lib/seed.ts`, `src/lib/schema.sql` | Mirror the migration | dashboard / data engineer |
| `src/app/api/profiles/mapping/route.ts` | Include `stack_keywords` in the response shape (read by `Process Job` in n8n) | dashboard team |
| `src/components/tasks/task-card.tsx` | Tier badge | dashboard team |
| `src/components/tasks/task-detail-modal.tsx` | Relevancy section | dashboard team |
| `src/components/tasks/board-column.tsx` | Score-sort fallback for Todo column | dashboard team |
| `src/lib/task-data.ts` | `getTasksByProject` ORDER BY clause for Todo | dashboard team |
| `docs/agent-guide/AGENT_USER_GUIDE.md` | New section explaining the score, the tier, and how Todo sort works | docs owner |
| `CLAUDE.md` | Append a row to "Migration Version History" for migration 017; brief note in "Code Patterns" about the splice + tier semantics | dashboard / Waqas |

---

## 22. Changelog

This section is **append-only**. Every edit to this PRD must add a row at the top with: date (YYYY-MM-DD), version bump, what changed (one line), why (one line), evidence (data query result or stakeholder name), reviewer.

| Date | Version | What changed | Why | Evidence | Reviewer |
|---|---|---|---|---|---|
| 2026-05-05 | v0.1 | Initial draft | Operationalize the AI scoring layer described in `docs/upwork-relevancy-scoring-ai-plan.md`, adapted to the Rising Lions multi-profile pipeline (Claude Haiku 4.5 not Gemini, `tasks.custom_fields` not new tables, splice between Process Job and Route Job per criteria PRD §10.5, advisory-not-gating per stakeholder decision 2026-05-05). | Source plan doc (`docs/upwork-relevancy-scoring-ai-plan.md`) + criteria PRD v0.2 (`docs/job_relevancy_criteria_prd.md`) + n8n workflow snapshot of `EWnZg3svZWwcIRs4` (2026-05-05 read via n8n-workflow-keeper) | Drafted by Claude in collaboration with Waqas |

---

*End of PRD.*
