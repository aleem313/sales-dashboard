# PRD — Job Relevancy Criteria

> **Document version:** 0.1
> **Author:** Drafted by Claude (relevancy-criteria-keeper agent), in collaboration with M Waqas
> **Date:** 2026-05-05
> **Status:** Draft for stakeholder review
> **Owned by:** the `relevancy-criteria-keeper` agent (`.claude/agents/relevancy-criteria-keeper.md`). All edits to this document should be made by asking that agent.

---

## 1. TL;DR

Define and document the criteria that determine whether an incoming Upwork job (delivered to us via a Vollna feed) is *relevant* — i.e. worth an agent spending time on a proposal — or *not relevant* and should land in **N/A**.

This PRD is **descriptive first, operational second**: it is grounded in the actual rejection patterns visible in 681 N/A tasks and 603 Proposal Submitted tasks on the live task board (2026-05-05 snapshot). Each gate maps to an existing rejection reason agents already use, so the criteria are ratifications of internal practice, not inventions.

The deliverable of this PRD is a shared written rule set. **Automation is out of scope** for v1 (the rule set is applied manually by agents), but a path to it — including a future n8n filter node — is described in §10.

---

## 2. Background

### 2.1 The pipeline today

```
Upwork → Vollna (per-profile feeds, stack-filtered) → n8n (per-profile webhooks)
       → Claude AI proposal → Task Board card (column "Todo" or "Proposal Submitted")
       → Agent triages: keep & bid, or move to N/A with a reason
```

Each profile (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal) is one Vollna feed. Each feed is configured upstream with a **stack bucket** — a curated list of stack keywords (e.g. Sana's bucket = Laravel, PHP, Node.js, React.js, Vue.js, SaaS, NestJS, WordPress, jQuery, WooCommerce, CMS Dev, WordPress Plugin, Next.js, fullstack, Nuxt, TypeScript, plugin). Vollna does the first level of filtering; n8n routes the result to the right agent's webhook.

### 2.2 The problem

Vollna's filter is keyword-based and **noisy**. Agents are still rejecting **42% of incoming jobs** (681 N/A vs 603 Proposal Submitted, manual cards excluded). That's a large queue of triage work, and there is no shared written rule set for what gets accepted vs rejected — it lives implicitly in agent judgment plus the multi-select `_reason` field on N/A cards.

Two operational consequences:

- **Onboarding tax.** New agents (or replacement agents) have to re-derive the rule set from observation.
- **No measurable upstream improvement.** Without a written criteria, we can't tighten Vollna feeds, can't audit consistency between agents, and can't propose automation.

### 2.3 Method behind this PRD

Read-only analysis of the Contabo production DB (`sales_dashboard`, 2026-05-05) with focus on:

- The `_reason` custom field on N/A tasks (multi-select array of rejection labels)
- Numeric/categorical `custom_fields` on N/A tasks (`_budget`, `_client_spent`, `_client_hires`, `_client_rating`, `_client_country`, `_stack`)
- A comparative slice of the 124 n8n-sourced Proposal Submitted tasks (the "we proceeded" sample with full metadata)
- Per-profile rejection matrix (which agents reject which kinds of jobs)

The data **is biased toward N/A** — 668 of 681 N/A rows are n8n-sourced with full metadata, while only 124 of 603 Proposal Submitted rows are (the rest are manual cards agents create after sending a proposal directly on Upwork). This means our "what we reject" picture is sharp; our "what we win" picture is blurry. See §11 Open Questions.

---

## 3. Goals & Non-goals

### Goals
1. Give the team a **single written, versioned rule set** for what makes a job relevant.
2. Make every gate **traceable** to an existing rejection reason or a measurable threshold drawn from real data.
3. Surface and document the **process gaps** (typo'd labels, blank reasons, lost metadata) that a future implementation will need to fix.
4. Define **inputs, owners, and success metrics** for each gate, so the rule set is operational on day 1.

### Non-goals (v1)
- **No automation.** v1 is a written rule set agents apply manually. Automation (e.g. an upstream filter that rejects on the criteria before an agent sees it) is a v2 conversation.
- **No new dashboard view.** Reporting "rejection rate by gate" would be valuable but is not in this PRD's scope.
- **No retroactive cleanup of past N/A tasks.** Existing rows are kept as-is; this PRD only governs new incoming jobs.
- **No change to Vollna feed configs.** Tightening Vollna filters is downstream work informed by this PRD.

---

## 4. Stakeholders

| Role | Stake |
|---|---|
| Bidding agents (Sana team, Khansa team, Shayan team, etc.) | **Apply** the criteria; **fill** `_reason` on every N/A move |
| Agent leads / admins | Audit consistency across agents; calibrate thresholds |
| Dashboard / data team | Track rejection rate by gate; measure win-rate uplift |
| n8n / Vollna ops (M Waqas) | Tighten upstream feeds once recurring "Out of stack" / "Old job" patterns are quantified |

---

## 5. Definitions & glossary

| Term | Meaning |
|---|---|
| **Profile** | A Vollna feed (and the matching agent webhook in n8n). 8 active: Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal. |
| **Stack bucket** | The curated list of stack keywords configured in a profile's Vollna feed. Lives in Vollna; not in our DB. Example — Sana's bucket has 17 entries. |
| **Label** | The profile-name tag attached to every n8n-created task (`Sana`, `Khansa`, etc.). Carries the stack bucket identity into our DB. |
| **N/A** | The board column where rejected jobs land. 681 tasks today. Multi-select `_reason` field captures why. |
| **Proceed** | Move the card past Todo into Proposal Submitted (or further). |
| **Hard gate** | A criterion that, on its own, justifies rejection. |
| **Soft signal** | A weighted factor; doesn't auto-reject but informs the decision. |
| **n8n-sourced** | `tasks.custom_fields._source = 'n8n'` — full metadata. |
| **Manual card** | `_source` is null or absent. Created by an agent in the UI; rarely has structured fields. |

---

## 6. Current state (the data)

### 6.1 Board volumes (2026-05-05)

| Column | Tasks | n8n-sourced |
|---|---|---|
| **N/A** | **681** | 668 (98%) |
| Proposal Submitted | 603 | 124 (21%) |
| Proposal Views | 80 | 9 |
| In Chat | 41 | 2 |
| Lost | 40 | 0 |
| Meeting Done | 26 | 0 |
| Todo | 23 | 23 |
| Negotiation | 6 | 0 |
| On Hold | 4 | 0 |
| New Jobs | 4 | 4 |
| Meeting Scheduled | 2 | 0 |
| Won | 2 | 1 |
| Prototype × 3 | 0 | 0 |
| **Total** | **1612** | |

### 6.2 Rejection reason taxonomy (N/A column)

`_reason` is a multi-select array. **551/681 (81%) of N/A tasks have at least one reason; 130 (19%) are blank** — a process gap (§9).

| # | Reason label | Count | Avg client spent | Avg hires | Avg rating | Implied threshold |
|---|---|---|---|---|---|---|
| 1 | Out of stack | 154 | $93,744 | 50 | 4.91 | Job's primary skill is not in the assigned profile's stack bucket |
| 2 | Old job | 134 | $48,837 | 26 | 4.80 | Posted "too long ago" — typically more than 24h |
| 3 | Too many invites | 106 | $43,251 | 24 | 4.89 | Too many proposals already submitted (typically 30+) |
| 4 | Low Higher rate *(typo: "Low Hourly Rate")* | 82 | $20,040 | 10 | 4.67 | Hourly bottom of range below acceptable floor |
| 5 | Location loc | 54 | $39,918 | 17 | 4.78 | Job requires freelancer to be physically in the US (or other specific country) |
| 6 | Client Low spending | 35 | **$7,970** (median **$228**) | 12 | 4.78 | Lifetime client spent too low to justify effort |
| 7 | Job unavailable | 18 | $8,678 | 24 | 4.29 | Job closed / posting taken down before bid sent |
| 8 | Already hired | 8 | $55,019 | 15 | 4.71 | Client already hired someone for this posting |
| 9 | Language barrier | 6 | $19,298 | 45 | 4.93 | Client communication clearly non-English / required language we don't speak |
| 10 | Bad rating client | 6 | $4,123 | 7 | **2.03** | Client's own rating is too low to risk working with them |
| 11 | Video Proposal | 4 | $326,545 | 49 | 4.88 | Job requires a recorded video pitch — out of our process |
| 12 | Duplicate | 2 | $3,880 | 14 | 4.72 | Same job already tracked elsewhere |
| 13 | Portfolio unavailable | 2 | $6,711 | 1 | 5.00 | Profile lacks a relevant portfolio piece |

### 6.3 Comparative profile: rejected vs proceeded (n8n-sourced only)

| Metric | N/A (n=325, with rating data) | Proposal Submitted (n=63) | Multiple |
|---|---|---|---|
| **Median client spent** | **$9,170** | **$18,355** | 2.0× |
| p25 client spent | $1,800 | $3,063 | 1.7× |
| Avg client spent | $66,330 | $215,941 | 3.3× |
| Median hires | 13 | 26 | 2.0× |
| Avg hires | 41.8 | 587.2 | 14× |
| Median rating | 4.99 | 4.97 | flat |
| Avg rating | 4.80 | 4.90 | +0.10 |

**Reading.** Proceeded jobs have ~2× the client spend and 2× the hire history at the median. Rating alone is a weak differentiator at the high end (4.99 vs 4.97). The signal is at the *low end* — bad-rating rejections sit at avg 2.03.

### 6.4 Per-profile rejection matrix

| Profile | Total rejects | Top reason | 2nd | 3rd |
|---|---|---|---|---|
| **Khansa** | **248** | Old job (72) | Out of stack (70) | Too many invites (37) |
| **Shayan** | **211** | Out of stack (53) | Too many invites (45) | Low Hourly Rate (40) |
| Laiba | 80 | Low Hourly Rate (22) | Out of stack (20) | Too many invites (19) |
| Saim | 22 | **Old job (20)** | Out of stack (1) | Low Hourly Rate (1) |
| Sana | 18 | Old job (11) | Too many invites (2) | mixed |
| Rebekah | 16 | **Old job (14)** | Out of stack (2) | — |
| Craig | 10 | Out of stack (6) | Too many invites (3) | Already hired (1) |
| Nawal | 0 | (zero rejected — also zero accepted) | — | — |

**Operational read.**
- **Saim and Rebekah are dominated by "Old job"** (90%+ of their rejects). Suggests their Vollna feeds may run too infrequently, or those agents triage in batches and lose freshness.
- **Khansa and Shayan carry the team's triage load** (459/681 rejects = 67%).
- **Nawal has zero traffic** — confirms an idle profile (also zero tags counted earlier). Worth investigating whether the Vollna feed is configured/active.

### 6.5 "Location loc" drill-down

Of 54 N/A tasks rejected with "Location loc":

| Country (of the client) | Count |
|---|---|
| United States | 37 |
| Canada | 4 |
| United Kingdom | 3 |
| Switzerland | 3 |
| New Zealand, Romania, Serbia, Spain, Hungary, Colombia, Indonesia | 1 each |

**Confirmed semantic** (per stakeholder, 2026-05-05): "Location loc" = the job posting requires the **freelancer** to be located in the US (or another specific country). 69% of these rejections come from US clients posting US-residency-required jobs, which matches expectation. The criterion is a property of the **job posting**, not of the client country.

### 6.6 Budget shape on N/A

- **222/681 (33%) "Not specified"** — agents reject ~1/3 of jobs that don't disclose budget
- Common rejected hourly ranges: `$10–20`, `$15–20`, `$15–25`, `$15–30`
- Common rejected fixed budgets: `$1,500`, `$2,000`, `$2,500`, `$5,000`

---

## 7. Job Relevancy Criteria — Hard gates

A job is **RELEVANT** when it passes **all** hard gates. Any single fail → reject (move to N/A, set reason).

| # | Gate | Threshold (v1) | Reason label on fail | Input source | Owner |
|---|---|---|---|---|---|
| 1 | **Stack match** | Job's primary skill ∈ assigned profile's stack bucket | "Out of stack" | Vollna pre-filter + agent eyeball check | Profile owner |
| 2 | **Job freshness** | Posted within last **24h** | "Old job" | Upwork posting timestamp (`_generated`) | Profile owner |
| 3 | **Proposal saturation** | **< 30 proposals** at time of triage (or "Less than 5" / "5–10" / "10–15" Upwork bucket) | "Too many invites" | Upwork "Proposals" indicator | Profile owner |
| 4 | **Hourly rate floor** | If hourly: bottom of range **≥ $25/hr** | "Low Hourly Rate" | `_budget` parsed | Profile owner |
| 5 | **Client spend floor** | `_client_spent` ≥ **$1,000** lifetime | "Client Low spending" | `_client_spent` | Profile owner |
| 6 | **Client rating floor** | `_client_rating` ≥ **4.0** (or rating absent on a new client with ≥ 0 hires) | "Bad rating client" | `_client_rating` | Profile owner |
| 7 | **Job availability** | Posting still open; not "filled" / "closed" | "Job unavailable" / "Already hired" | Upwork posting status | Profile owner |
| 8 | **No location lock-in** | Job does not require freelancer to be in US (or any country we cannot field) | "Location loc" | Job description (Upwork badge "U.S. only") | Profile owner |
| 9 | **No video-proposal requirement** | Job description does not require a recorded video pitch | "Video Proposal" | Job description scan | Profile owner |
| 10 | **Portfolio match available** | Profile has at least one portfolio item that maps to the job's stack | "Portfolio unavailable" | Profile-side knowledge | Profile owner |
| 11 | **No duplicate** | `_job_id` is not already tracked across active boards in last 30 days | "Duplicate" | Internal — `_job_id` lookup | n8n / system |

---

## 8. Soft signals (review, weighted)

These don't auto-reject but feed agent judgment when a job is borderline.

| Signal | Direction | Notes |
|---|---|---|
| Budget "Not specified" | **Caution** | 33% of N/A rows. Neutral if other gates pass strongly; adverse if combined with low hires or low spend. |
| Client country | **Neutral on its own** | "Location loc" handles the location-restriction case. Country alone is not a signal. |
| Client hires > 5 | **Bonus** | Proceeded clients have 2× hire history at median. |
| Client spent > $5,000 | **Bonus** | Strong positive signal. |
| Language barrier (soft) | **Caution** | If client communication is non-English but translatable. |
| Hourly range upper bound > $80/hr | **Bonus** | Indicates premium client willing to pay. |
| Connect cost on Upwork | **Caution if > 8 connects** | Boosting / featured jobs cost more; weigh against expected ROI. |

---

## 9. Process gaps (must fix before any automation)

These are weaknesses surfaced by the data. They affect data quality and must be addressed before we can automate or measure rejection-rate-by-gate.

### 9.1 Reason field is optional (19% blank rate)
**Impact.** 130 N/A tasks have no `_reason`. We can't tell why they were rejected, which weakens any uplift analysis.
**Fix.** Make `_reason` required at the moment of moving a card to N/A (UI guard). Block the move with a toast asking for at least one reason.

### 9.2 Reason label typos in production
- `"Low Higher rate"` → should be `"Low Hourly Rate"`
- `"Location loc"` → label kept by stakeholder request, but ambiguous to new readers; recommend adding tooltip "Job requires freelancer in specific country (e.g. US-only)"
- `"Manaual proposal"` (in tag table) → typo of `"Manual Proposal"`

**Fix.** Migration to rename labels (multi-select dropdown options) + UI tooltip; one-time backfill of existing rows so historical analysis stays clean.

### 9.3 Proceed flow drops n8n metadata
**Impact.** Once a card moves to Proposal Submitted, agents tend to switch to manual cards. The 124 n8n-sourced Proposal Submitted rows are a tiny minority. Without metadata on the proceed side, we cannot measure win-rate-by-stack, win-rate-by-budget, etc.
**Fix.** Treat the original n8n card as the system of record through the entire lifecycle. No new manual card per proposal. Manual cards reserved for genuinely off-Vollna leads (cold outreach, invites).

### 9.4 `profiles.stack` column is unused
**Impact.** The Vollna stack bucket per profile (e.g. Sana's 17 stacks) is not in our DB. Any automation of gate #1 would need a place to read it.
**Fix.** New column or sub-table — see §10. Out of scope for v1; flagged for v2.

### 9.5 Tag-case drift
**Impact.** Tag table has both `Shayan` and `shayan`, both `Saim` and `saim`, etc. — tags created with different casing across history. Slicing by tag double-counts.
**Fix.** One-time migration to merge lowercase variants into the canonical TitleCase tag. The `findConflictingTag` helper in the webhook route is already case-insensitive, so new tasks won't worsen the drift.

### 9.6 Idle / inactive profiles
**Impact.** Nawal has 0 tasks. Either the Vollna feed is misconfigured or the profile is inactive. Nawal also has no `vollna_filter_tag` set in the `profiles` table.
**Fix.** Audit: is Nawal a real active profile? If yes, configure the feed; if no, mark inactive in DB.

---

## 10. Implementation considerations (informational, not v1 scope)

When this PRD evolves into automation, the following design choices matter:

### 10.1 Storage of the stack bucket per profile
Three options if/when we want gate #1 to be machine-checkable:

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. `profiles.stack_keywords TEXT[]`** | Postgres array column | Simplest; one query to fetch | No history; not searchable cross-profile |
| **B. `profile_stacks` table** | `(profile_id, keyword)` rows + index | Indexable for "which profiles cover Laravel"; supports versioning | New table; new admin UI |
| **C. JSONB on `profiles.metadata`** | Flexible | Works with existing schema patterns | Not directly indexable |

Recommended: **Option B** if we ever want analytics like "win rate by keyword" (because keywords overlap across profiles). Option A if it stays read-only metadata.

### 10.2 Reading some gates from Upwork directly
- **Gate 2 (freshness):** We already have `_generated` timestamp from n8n. Computable today.
- **Gate 3 (proposal saturation):** Vollna ships an "interviewing" / "proposals" count for each job. n8n could map this into a `_proposals_submitted_count` field today. (Currently not extracted — verify.)
- **Gate 8 (location lock-in):** Detected from job description text. Pattern match for "U.S. residents only", "U.S.-based", "must be located in" patterns. Imperfect but cheap.
- **Gate 11 (duplicate):** Already enforced by the webhook intake (per CLAUDE.md). v1 doesn't need to change.

### 10.3 UI surfacing
- Add a **"Why might this be relevant?"** info panel on each Todo / new card showing the gate-by-gate result (✓/✗) with the relevant value.
- Existing rejection-reason multi-select stays unchanged; just becomes mandatory (§9.1).

### 10.4 Metrics
- **Rejection rate per gate per profile per week** — answers "is Khansa rejecting more 'Out of stack' than Sana?"
- **"Sneak-through" rate** — fraction of N/A tasks where rejection happened *after* the proposal was already submitted (lifecycle log). Indicates agents bid first then realised the gate failed; suggests upstream tightening.
- **Win rate per gate-pass profile** — once §9.3 is fixed (proceed flow keeps metadata), we can correlate gates to win rate.

### 10.5 Future n8n integration (out of scope for v1)
A future n8n node will read this PRD's gates and pre-filter incoming Vollna jobs before they reach an agent's queue. Design considerations:
- The node would sit between `Process Job` and `Route Job` in the workflow `EWnZg3svZWwcIRs4`.
- Machine-checkable gates (1, 2, 3, 4, 5, 6, 7, 11) auto-route to N/A with the matching reason. Eyes-only gates (8, 9, 10) fall through to Todo.
- The PRD's thresholds become the literal config of the node — so any change here propagates after one redeploy.
- **The relevancy-criteria-keeper agent owns this PRD.** When the node ships, the n8n-workflow-keeper reads from the PRD; never the reverse.

### 10.6 Vollna feed tightening (downstream of this PRD)
Once data is clean, we can answer: "what fraction of N/A 'Out of stack' tasks would Vollna's filter have caught with a tighter keyword list?" That's the path to reducing agent triage load.

---

## 11. Open questions

Listed for resolution before this PRD becomes v1.0.

1. **Threshold calibration.** Are the v1 thresholds (Gate 4 = $25/hr floor, Gate 5 = $1,000 spend, Gate 6 = 4.0 rating) the right defaults? Profile-by-profile data may justify different floors per profile (Khansa is much bigger and may tolerate lower-spend clients than Sana).
2. **Override flow.** Should there be a "manager override" path where a profile owner approves a job that fails one soft signal, with a reason logged?
3. **Old-job freshness window.** Is 24h the right number? Some agents ("Saim", "Rebekah") reject 90%+ of their pipeline as "Old job" — either the window is too tight for them or their Vollna feed cadence is the real problem.
4. **Should "Bad rating client" + low spend combine into a single "Risk" gate?** Today they're separate reasons but they cluster (avg rating 2.03 + spent $4k).
5. **Inactive profiles.** Is Nawal active? Should it be archived?
6. **Per-gate ownership for v2.** Which gates can the system check automatically (1, 2, 3, 4, 5, 6, 7, 11)? Which require human eyes (8, 9, 10)?
7. **Versioning.** When thresholds change, do we want a `criteria_version` field on N/A tasks so historical rejections stay auditable against the rules in force at the time?

---

## 12. Rollout plan

| Phase | Scope | Owner | Done when |
|---|---|---|---|
| **0. PRD review** | Stakeholder review of this document | Waqas + agent leads | Sign-off on §7 thresholds and §9 fixes |
| **1. Process fixes** | §9.1 (require `_reason`), §9.2 (rename typo'd labels), §9.5 (tag merge migration) | Dashboard team | Migration run, UI guard live |
| **2. Manual rule application** | Agents apply §7 gates manually; PRD is the reference doc | All agents | 2-week observation period |
| **3. Data review** | Re-run §6 analysis after 2 weeks; calibrate thresholds | Waqas | Adjusted thresholds for v1.1 |
| **4. Storage + gate automation (v2)** | §10.1 stack bucket storage; auto-checks for gates 1–7, 11 | Dashboard + n8n team | Vollna pre-filter or webhook-side gate live |
| **5. Vollna feed tightening** | Use data from gate 1 ("Out of stack") to tighten Vollna keyword filters | Waqas | Quantified reduction in "Out of stack" rate |

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Thresholds too strict → starve the pipeline | Track "would-have-been-rejected" rate during phase 2; back off if it crosses ~70% |
| Agents disagree on subjective gates (8, 9, 10) | Pair-review for first month; document edge cases in an addendum |
| `_reason` becoming mandatory frustrates agents | Pre-populate the most-likely reason based on the failed gate; one-click confirm |
| Win-rate side data stays thin (§9.3 not fixed) | Phase 4 cannot complete without §9.3; flag as blocker if not resolved |
| Vollna feed configs drift from the documented stack buckets | Single-source-of-truth: store stack buckets in DB (§10.1) and have Vollna sync from there, not the reverse |

---

## 14. Appendix A — Data extraction queries

All queries run against `sales_dashboard` on Contabo on 2026-05-05.

```sql
-- Column distribution
SELECT c.name, COUNT(t.id) FROM columns c
LEFT JOIN tasks t ON t.column_id = c.id
GROUP BY c.id, c.name ORDER BY c.position;

-- Reason distribution (multi-select unrolled)
WITH na AS (
  SELECT jsonb_array_elements_text(custom_fields->'_reason') AS reason
  FROM tasks t JOIN columns c ON c.id = t.column_id
  WHERE c.name = 'N/A'
)
SELECT reason, COUNT(*) FROM na GROUP BY reason ORDER BY 2 DESC;

-- Comparative numeric stats (n8n-sourced rows only, with rating data)
WITH base AS (
  SELECT t.id, c.name AS col,
    NULLIF(t.custom_fields->>'_client_spent','')::numeric AS spent,
    NULLIF(t.custom_fields->>'_client_hires','')::numeric AS hires,
    NULLIF(t.custom_fields->>'_client_rating','')::numeric AS rating
  FROM tasks t JOIN columns c ON c.id = t.column_id
  WHERE t.custom_fields->>'_source' = 'n8n'
    AND c.name IN ('N/A','Proposal Submitted')
    AND t.custom_fields->>'_client_rating' ~ '^[0-9.]+$'
)
SELECT col, COUNT(*),
  ROUND(AVG(spent)::numeric,0) AS avg_spent,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY spent) AS median_spent,
  ROUND(AVG(hires)::numeric,1) AS avg_hires,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY hires) AS median_hires,
  ROUND(AVG(rating)::numeric,2) AS avg_rating
FROM base GROUP BY col;

-- Per-reason numeric averages (the threshold extraction)
WITH na AS (
  SELECT t.id,
    jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.custom_fields->'_reason')='array'
           THEN t.custom_fields->'_reason' ELSE '[]'::jsonb END
    ) AS reason,
    NULLIF(t.custom_fields->>'_client_spent','')::numeric AS spent,
    NULLIF(t.custom_fields->>'_client_hires','')::numeric AS hires,
    NULLIF(t.custom_fields->>'_client_rating','')::numeric AS rating
  FROM tasks t JOIN columns c ON c.id = t.column_id
  WHERE c.name='N/A'
)
SELECT reason, COUNT(*) AS n,
  ROUND(AVG(spent)::numeric,0) AS avg_spent,
  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY spent)::numeric,0) AS med_spent,
  ROUND(AVG(hires)::numeric,1) AS avg_hires,
  ROUND(AVG(rating)::numeric,2) AS avg_rating
FROM na GROUP BY reason ORDER BY n DESC;

-- Per-profile rejection matrix
WITH na AS (
  SELECT t.custom_fields->>'_profile_name' AS profile,
    jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.custom_fields->'_reason')='array'
           THEN t.custom_fields->'_reason' ELSE '[]'::jsonb END
    ) AS reason
  FROM tasks t JOIN columns c ON c.id = t.column_id
  WHERE c.name='N/A' AND t.custom_fields->>'_profile_name' IS NOT NULL
)
SELECT profile, reason, COUNT(*) AS n
FROM na GROUP BY 1,2 ORDER BY profile, n DESC;

-- "Location loc" client country drill
SELECT t.custom_fields->>'_client_country' AS country, COUNT(*) AS n
FROM tasks t JOIN columns c ON c.id=t.column_id
WHERE c.name='N/A'
  AND t.custom_fields->'_reason' @> '["Location loc"]'::jsonb
GROUP BY 1 ORDER BY n DESC;
```

---

## 15. Appendix B — Files referenced (no edits proposed in this PRD)

| File | Purpose |
|---|---|
| `src/app/api/v1/webhooks/tasks/route.ts` | Sets all `_*` custom_fields on n8n-sourced tasks at intake |
| `src/lib/task-data.ts` | `getTasksByProject`, `moveTask`, `logActivity`, `syncJobStatusFromTask` |
| `src/lib/seed.ts`, `src/lib/migrations/006_task_management_schema.sql` | `custom_field_definitions`, `tasks.custom_fields` JSONB, board columns |
| `src/components/tasks/task-card.tsx` | Card display — would surface gate ✓/✗ in v2 |
| Vollna feed configs (off-DB) | Source of truth for stack buckets per profile |
| `.claude/agents/relevancy-criteria-keeper.md` | The agent that owns this document |

---

## 16. Changelog

This section is **append-only**. Every edit to this PRD must add a row at the top with: date (YYYY-MM-DD), version bump, what changed (one line), why (one line), evidence (data query result or stakeholder name), reviewer.

| Date | Version | What changed | Why | Evidence | Reviewer |
|---|---|---|---|---|---|
| 2026-05-05 | v0.1 | Initial draft | Define a written rule set for job relevancy from observed agent behaviour | Contabo task board snapshot: 681 N/A + 603 Proposal Submitted tasks, 13 distinct rejection reasons, per-profile matrix, comparative numeric profile | Drafted by Claude in collaboration with Waqas |

---

*End of PRD.*
