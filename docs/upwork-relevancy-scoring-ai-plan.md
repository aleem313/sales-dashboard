# Upwork Relevancy Scoring AI — Build Plan

A detailed implementation plan for an AI-powered relevancy scoring system that evaluates Upwork jobs against your profile and returns a 0–100 score with a recommendation tier.

**Stack:** Vollna (job feed) → n8n (orchestrator) → Gemini Flash (LLM) → Next.js + Postgres (storage + UI)

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Phase 1 — Profile Ingestion](#phase-1--profile-ingestion-run-once-refresh-on-demand)
3. [Phase 2 — Job Ingestion](#phase-2--job-ingestion-vollna--n8n)
4. [Phase 3 — Pre-Filter](#phase-3--pre-filter-the-cheap-layer)
5. [Phase 4 — Scoring Engine](#phase-4--scoring-engine-the-llm-call)
6. [Phase 5 — Output & Action Layer](#phase-5--output-and-action-layer)
7. [Phase 6 — Calibration](#phase-6--calibration-dont-skip-this)
8. [Database Schema](#database-schema-extend-your-existing-postgres)
9. [Next.js API Endpoints](#nextjs-api-endpoints)
10. [Profile Extraction Prompt](#one-time-profile-extraction-prompt)
11. [n8n Workflow](#n8n-workflow--node-by-node)
12. [Scoring Prompt (Production)](#the-scoring-prompt-production-version-for-gemini-flash)
13. [Cost Expectation](#cost-expectation)
14. [Build Order](#build-order)

---

## High-Level Architecture

```
Vollna (job source) ──webhook──> n8n
                                  │
                                  ├─> [1] Job normalizer
                                  │
                                  ├─> [2] Profile loader (cached)
                                  │
                                  ├─> [3] Pre-filter (cheap heuristics)
                                  │       │
                                  │       └─> if obviously bad → skip LLM, score 0–20
                                  │
                                  ├─> [4] LLM scoring call (Gemini Flash)
                                  │
                                  ├─> [5] Score parser + threshold logic
                                  │
                                  └─> [6] Output: Next.js API → Postgres + Telegram
```

The trick is to treat the **profile as a stable asset** (extract once, refresh weekly) and the **job as the variable input**. You don't want to re-scrape your Upwork profile on every job — that's slow, expensive, and your profile barely changes.

---

## Phase 1 — Profile Ingestion (run once, refresh on demand)

The goal: convert your Upwork profile into a clean, structured JSON document that the LLM can reason over.

**Recommended approach: HTML upload, not live URL.** Upwork is heavily protected against scraping (Cloudflare, login walls, bot detection). Live scraping from n8n will break constantly. Better workflow: save the profile page as HTML manually (or via a logged-in browser extension), drop it into a folder/S3/Drive, and parse it via Gemini.

### Profile JSON shape

```json
{
  "profile_id": "your-handle",
  "headline": "...",
  "overview": "full text of your bio",
  "hourly_rate": 65,
  "total_earnings": 120000,
  "jss_score": 98,
  "top_rated": true,
  "skills_listed": ["Laravel", "PHP", "AI Integration"],
  "specialized_profiles": [
    { "name": "AI Developer", "description": "..." }
  ],
  "portfolio": [
    {
      "title": "...",
      "description": "...",
      "tags": [],
      "tech_stack": []
    }
  ],
  "work_history": [
    {
      "title": "...",
      "client_feedback": "...",
      "your_review": "...",
      "rate": 50,
      "duration": "3 months",
      "tech_stack_inferred": ["Laravel", "OpenAI"]
    }
  ],
  "certifications": [],
  "languages": [],
  "extracted_at": "2026-05-05"
}
```

Run the raw HTML through Gemini Flash once with a "convert this to structured JSON matching this schema" prompt. This is the most resilient method — you don't have to maintain CSS selectors when Upwork's DOM changes.

**Refresh trigger:** a manual button in your dashboard or a weekly cron.

---

## Phase 2 — Job Ingestion (Vollna → n8n)

Vollna sends a webhook payload per matching job. Normalize it into a consistent shape regardless of how Vollna sends it:

```json
{
  "job_id": "...",
  "title": "...",
  "description": "...",
  "skills_required": [],
  "category": "...",
  "budget_type": "fixed | hourly",
  "budget_min": 500,
  "budget_max": 2000,
  "experience_level": "entry | intermediate | expert",
  "client_country": "...",
  "client_payment_verified": true,
  "client_total_spent": 45000,
  "client_hires": 23,
  "client_rating": 4.8,
  "proposals_count": 5,
  "posted_at": "...",
  "url": "..."
}
```

The richer this object, the better the LLM scores. Vollna may not give you all of this — fill in what you can and pass `null` for missing fields. The LLM can be instructed to factor uncertainty when fields are missing.

---

## Phase 3 — Pre-Filter (the cheap layer)

Before you spend a Gemini call, kill obviously bad jobs with deterministic rules. This saves 60–80% of your token spend over time.

**Hard-fail conditions** (auto-score 0, skip LLM):

- Required skills have **zero overlap** with your skill list (case-insensitive, with aliases — e.g., "Laravel" ≈ "Laravel Framework")
- Budget below your floor (e.g., fixed under $200, hourly under $25)
- Client unverified AND total spent < $100
- Proposals count > 50 (already saturated)

Keep this as an n8n Function node. Tune over time as you learn what's noise.

---

## Phase 4 — Scoring Engine (the LLM call)

This is the core. See the [production prompt](#the-scoring-prompt-production-version-for-gemini-flash) below.

**Key design choices:**

- **Model:** Gemini Flash (cheap, fast, smart enough for a structured rubric task)
- **Output:** JSON mode with `responseSchema` — eliminates parsing errors
- **Temperature:** 0.1–0.3 for consistent scoring, not creativity
- **Single call** with strict rubric, sub-scores, and proposal angles

The **`top_3_proposal_angles`** field is gold — it makes the system not just a filter but a proposal-writing assistant. When the score is high, you immediately have hooks for the cover letter ("mention the Stripe + Laravel project", "lead with the AI integration angle").

---

## Phase 5 — Output and Action Layer

Two channels:

**1. Postgres log** (in your existing Next.js app's database) — one row per scored job with full component breakdown. This is your training data for Phase 6.

**2. Notification for high-tier jobs only (≥70).** Telegram bot, Slack DM, or push via Pushover. Keep marginal/skip jobs out of notifications or you'll start ignoring them. Include URL, score, tier, and the three proposal angles so you can read it on your phone and act in 30 seconds.

---

## Phase 6 — Calibration (don't skip this)

Your first version will be wrong. The rubric weights are a starting guess. Calibrate by:

**Tracking outcomes.** For every job you applied to, log whether you got a response, got hired, and what you earned.

**After 2–4 weeks**, look at score-to-outcome correlation. If jobs scored 60–80 are converting better than 80+, your rubric is over-weighting something. Common findings:

- `skill_match` is over-weighted because LLMs are too generous with keyword overlap
- `client_quality` matters more than people think — a great-fit job from a flaky client wastes your time
- `competition_position` (proposal count + freshness) ends up being the single best predictor of getting noticed

Adjust weights in the prompt and re-run. Optionally add a "lessons learned" section: *"In past evaluations, the freelancer found that jobs mentioning X tend to be lowballers — discount accordingly."*

---

## Database Schema (extend your existing Postgres)

Four tables. Put them in a dedicated schema like `upwork_scoring` if you want isolation.

```sql
CREATE TABLE profile (
  id           SERIAL PRIMARY KEY,
  handle       TEXT UNIQUE NOT NULL,
  data         JSONB NOT NULL,         -- structured profile JSON
  raw_html     TEXT,                   -- archive of source
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE jobs (
  id           SERIAL PRIMARY KEY,
  external_id  TEXT UNIQUE NOT NULL,   -- Vollna's job id or Upwork URL hash
  title        TEXT NOT NULL,
  description  TEXT,
  url          TEXT NOT NULL,
  raw_payload  JSONB NOT NULL,         -- whatever Vollna sent
  normalized   JSONB,                  -- your cleaned shape
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scores (
  id              SERIAL PRIMARY KEY,
  job_id          INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  total_score     INTEGER NOT NULL,
  tier            TEXT NOT NULL,       -- apply_now | strong | marginal | skip
  components      JSONB NOT NULL,
  proposal_angles TEXT[],
  summary         TEXT,
  model           TEXT,                -- e.g. 'gemini-2.5-flash'
  prompt_version  TEXT,                -- e.g. 'v1', 'v2' for calibration
  scored_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE outcomes (
  id           SERIAL PRIMARY KEY,
  job_id       INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  applied      BOOLEAN DEFAULT FALSE,
  got_response BOOLEAN DEFAULT FALSE,
  got_hired    BOOLEAN DEFAULT FALSE,
  earnings     NUMERIC,
  notes        TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scores_total   ON scores(total_score DESC);
CREATE INDEX idx_scores_tier    ON scores(tier);
CREATE INDEX idx_jobs_received  ON jobs(received_at DESC);
```

**The `prompt_version` field is critical** — when you tweak the rubric weights, you need to know which scores came from which version, or your calibration data becomes useless.

---

## Next.js API Endpoints

Three endpoints in your existing app. Use a shared API key in a header for n8n → Next.js auth.

```
POST /api/upwork/score-job
  Body: normalized job + score from n8n
  Auth: x-api-key header
  Action: insert into jobs + scores, return score_id

GET /api/upwork/profile
  Returns: latest profile JSON for n8n to use in scoring

POST /api/upwork/profile
  Body: raw HTML
  Action: pass to Gemini, parse to JSON, upsert to profile table
  Use: one-time / weekly refresh

PATCH /api/upwork/outcomes/:job_id
  Body: { applied, got_response, got_hired, earnings }
  Use: manual feedback loop for calibration
```

Build a small dashboard page in your Next.js app that lists scored jobs sorted by `total_score DESC`, with filters by tier and a "mark as applied / hired" button hitting the outcomes endpoint. This is your daily driver UI.

---

## One-Time Profile Extraction Prompt

Run your saved profile HTML through Gemini Flash with structured output mode.

**Request body** (POST to Gemini Flash `generateContent`):

```json
{
  "contents": [{
    "parts": [{
      "text": "Extract the freelancer profile data from this Upwork HTML. Return ONLY JSON matching the provided schema. Use null for missing fields. For 'tech_stack_inferred' on past jobs, infer from the job title and description even if not explicitly tagged. Preserve full overview/bio text — do not summarize.\n\n<HTML>\n{{paste your saved HTML here}}\n</HTML>"
    }]
  }],
  "generationConfig": {
    "temperature": 0.1,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "object",
      "properties": {
        "handle":         { "type": "string" },
        "headline":       { "type": "string" },
        "overview":       { "type": "string" },
        "hourly_rate":    { "type": "number" },
        "total_earnings": { "type": "number" },
        "jss_score":      { "type": "number" },
        "top_rated":      { "type": "boolean" },
        "skills_listed":  { "type": "array", "items": { "type": "string" } },
        "specialized_profiles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name":        { "type": "string" },
              "description": { "type": "string" }
            }
          }
        },
        "portfolio": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title":       { "type": "string" },
              "description": { "type": "string" },
              "tags":        { "type": "array", "items": { "type": "string" } },
              "tech_stack":  { "type": "array", "items": { "type": "string" } }
            }
          }
        },
        "work_history": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title":               { "type": "string" },
              "client_feedback":     { "type": "string" },
              "your_review":         { "type": "string" },
              "rate":                { "type": "number" },
              "duration":            { "type": "string" },
              "tech_stack_inferred": { "type": "array", "items": { "type": "string" } }
            }
          }
        },
        "certifications": { "type": "array", "items": { "type": "string" } },
        "languages":      { "type": "array", "items": { "type": "string" } }
      },
      "required": ["handle", "headline", "overview", "skills_listed"]
    }
  }
}
```

> **HTML pre-cleaning:** Upwork profile HTML can be 500KB+ with mostly junk (CSS, scripts, tracking). **Strip it first** — remove `<script>`, `<style>`, `<svg>`, `<noscript>` tags and HTML comments before sending. Cheerio in n8n's Code node does this in 5 lines. Keeps you well under context limits and reduces cost.

---

## n8n Workflow — Node by Node

```
[1] Webhook node (Vollna trigger)
        │
[2] Code node: normalize_job
        │   Input: Vollna payload
        │   Output: normalized job object matching your schema
        │
[3] HTTP Request: GET {your-app}/api/upwork/profile
        │   Cache in n8n static data with 1-hour TTL
        │   so you're not hitting your DB on every job
        │
[4] Code node: pre_filter
        │   Apply hard-fail rules:
        │   - skill overlap == 0  → fail
        │   - budget below floor   → fail
        │   - proposals > 50       → fail
        │   - client unverified AND spent < $100 → fail
        │   Output: { passes: bool, reason: string }
        │
[5] IF node: passes pre-filter?
        │
        ├─ NO  → [6a] HTTP POST score=10, tier=skip
        │             → /api/upwork/score-job → END
        │
        └─ YES → [6b] HTTP Request: Gemini Flash generateContent
                       │
                  [7] Code node: parse_validate
                       │   Verify JSON is well-formed and
                       │   total_score = sum(components)
                       │   If parse fails: retry once, then log + skip
                       │
                  [8] HTTP POST → /api/upwork/score-job
                       │
                  [9] IF: tier in (apply_now, strong)
                       │
                       └─ YES → [10] Telegram/Slack notification
                                      with score, title, URL, top 3 angles
```

**n8n-specific tips:**

- Use the HTTP Request node with **retry-on-failure** for the Gemini call (3 retries with exponential backoff — Flash is reliable but 503s happen)
- Route the workflow's **error workflow** to a separate "failed scorings" log so you don't lose jobs silently
- Test each node individually with a mocked Vollna payload before wiring end-to-end

---

## The Scoring Prompt (production version for Gemini Flash)

```json
{
  "contents": [{
    "parts": [{
      "text": "PROFILE:\n{{profile_json}}\n\nJOB:\n{{job_json}}\n\nScore this job per the system instructions."
    }]
  }],
  "systemInstruction": {
    "parts": [{
      "text": "You are a senior Upwork strategist scoring fit between a freelancer's profile and a specific job posting. Be strict, evidence-based, and skeptical — your goal is to save the freelancer's time, not encourage every application. Always cite specific evidence from the profile or job in each component's reason field.\n\nSCORING RUBRIC (max 100):\n- skill_match (30): Overlap between job's required skills and skills demonstrated in profile AND past work. Penalize skills merely listed but never used in completed jobs.\n- domain_match (15): Industry/domain alignment with prior work history.\n- portfolio_evidence (20): Concrete past project mirroring this job's needs. Direct evidence beats keywords.\n- experience_level_fit (10): Job seniority vs. freelancer's rate, JSS, history.\n- client_quality (10): Payment verified, total spent, hire count, rating.\n- competition_position (10): Proposal count, post freshness, niche depth.\n- red_flags (5): Vague description, suspicious budget, scope creep signals, template-feeling posts. Higher score = fewer red flags.\n\nTIERS by total_score:\n- 80-100: apply_now\n- 60-79:  strong\n- 40-59:  marginal\n- 0-39:   skip\n\nFor proposal_angles: provide 3 specific hooks the freelancer should lead with, referencing actual past projects or skills from the profile. Generic angles are useless.\n\nReturn ONLY JSON matching the schema."
    }]
  },
  "generationConfig": {
    "temperature": 0.2,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "object",
      "properties": {
        "components": {
          "type": "object",
          "properties": {
            "skill_match":          { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "domain_match":         { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "portfolio_evidence":   { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "experience_level_fit": { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "client_quality":       { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "competition_position": { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } },
            "red_flags":            { "type": "object", "properties": { "score": {"type":"integer"}, "max": {"type":"integer"}, "reason": {"type":"string"} } }
          }
        },
        "total_score":           { "type": "integer" },
        "tier":                  { "type": "string", "enum": ["apply_now","strong","marginal","skip"] },
        "top_3_proposal_angles": { "type": "array", "items": {"type":"string"}, "minItems": 3, "maxItems": 3 },
        "missing_signals":       { "type": "array", "items": {"type":"string"} },
        "summary":               { "type": "string" }
      },
      "required": ["components","total_score","tier","top_3_proposal_angles","summary"]
    }
  }
}
```

Set `prompt_version: "v1"` when saving the score. When you tune the rubric weights later, bump to `v2` so calibration analysis can compare apples to apples.

---

## Cost Expectation

Gemini Flash is roughly fractions of a cent per scoring call at this prompt size (a few thousand input tokens, a few hundred output). Even at 100 jobs/day, you're looking at single-digit dollars per month. The pre-filter step will probably cut that in half once tuned. Profile extraction is a one-time / weekly cost — negligible.

---

## Build Order

Don't build it all at once. Sequence:

1. **Postgres schema + Next.js endpoints** (1–2 hours). Get the data layer working first.
2. **Profile extraction** (1 hour). Save HTML → POST to your endpoint → see clean JSON in DB.
3. **Manual scoring test** (1 hour). Hardcode 5 jobs, hit Gemini directly via curl, validate the prompt produces sane scores. Tune rubric weights here before building the n8n flow.
4. **n8n workflow** (2–3 hours). Wire it up with one real Vollna job at a time.
5. **Dashboard page in Next.js** (2–3 hours). List scored jobs, show components breakdown, outcome buttons.
6. **Notifications** (30 min). Telegram is fastest to set up.
7. **Calibration** — ongoing. Review weekly, adjust weights, bump prompt version.

---

## Open Questions / Next Steps

- Write the Next.js route handlers (TypeScript)
- Write the n8n Code-node JS for normalizer + pre-filter
- Define skill alias mappings (e.g., "Laravel" ↔ "Laravel Framework" ↔ "PHP/Laravel")
- Decide notification channel (Telegram vs Slack vs Pushover)
- Set personal floors for budget pre-filter
