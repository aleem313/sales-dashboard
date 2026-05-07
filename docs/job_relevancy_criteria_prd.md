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

### 6.7 Concrete reject examples by reason

These are real n8n-sourced jobs from the production board (Contabo snapshot, 2026-05-05). Each row shows **the actual data the AI sees at intake** alongside the reason an agent gave for moving the card to N/A. Use these as labeled training data for the upcoming n8n classifier (full structured payload in Appendix C).

Notation: `client_spent` = lifetime USD; `hires` = total Upwork hires by client; `rating` = 0–5 client rating; `—` = field absent.

#### 6.7.1 "Out of stack" (n=154 — 5 representative)

| Profile | Title | Skills (excerpt) | Budget | client_spent / hires / rating |
|---|---|---|---|---|
| Craig | Web Developer | "Web Development" *(only tag)* | Not specified | — / — / — |
| Shayan | Need Wordpress developer with Polylang expertise | Polylang, WordPress, PHP, CSS | 20–40 USD | $29,661 / 19 / 4.99 |
| Shayan | Programmatic SEO Strategist for Golf Travel Startup — Next.js SEO Page Launch | SEO, SEO Keyword Research, GA, On-Page SEO | 10–20 USD | $1,000 / 3 / 5.00 |
| Shayan | I need a frontend developer to recreate a Figma design (Laravel/Blade/Livewire) | Front-End, Laravel, Blade, Livewire, Tailwind | 18–40 USD | $2,861 / 29 / 4.98 |
| Craig | Wordpress Website transfer | Web Dev, Node.js, Next.js, React, Go, Nest, Express | Not specified | — / — / — |

**Failure modes.** (a) Skills tag too generic ("Web Development" only) — no machine-detectable stack match. (b) Job tagged with our keywords but actual work *outside* our buckets (Polylang i18n, programmatic SEO with a Next.js red herring, Laravel/Blade for a Next-leaning profile). (c) No-code platforms (Wix, Webflow, Bubble, Squarespace) leak through Vollna's keyword filter — see Appendix C.

#### 6.7.2 "Old job" (n=134 — 5 representative)

| Profile | Title | Skills (excerpt) | Budget | client_spent / hires / rating |
|---|---|---|---|---|
| Sana | Senior Node.js Engineer — On-Call Maintenance for AI Document Pipeline | API Integration, Node.js, JS, Claude API | 20–40 USD | $189,897 / 58 / 4.99 |
| Sana | Divi/WordPress Designer Needed — 10-Page Site Refresh | Divi, WordPress, Web Design, Landing Page | 18–40 USD | $4,929 / 9 / 4.99 |
| Sana | MERN Stack Developer Needed for Project Optimization | JS, React, Node.js, MongoDB, CSS | 15–35 USD | — / — / — |
| Rebekah | Advanced All-in-One Travel Booking Platform | Full-Stack, Next.js, React, TS, n8n | Not specified | — / — / — |
| Saim | Operations Specialist wanted for busy Founder | Email, Word, Excel, Admin Support | $25/hr | $29,187 / 21 / 4.72 |

**Failure mode.** Listing was already 24h+ old when the agent triaged. **Saim & Rebekah profiles are dominated by this reason (90%+ of their rejects)** — root cause is likely slow Vollna feed cadence, not job quality (clients here are healthy: $189k spend, 58 hires).

#### 6.7.3 "Too many invites" (n=106 — 5 representative)

| Profile | Title | Skills (excerpt) | Budget | client_spent / hires / rating |
|---|---|---|---|---|
| Craig | FlutterFlow + Firebase Developer Needed — Paid Messaging Feature | FlutterFlow, Flutter, Supabase, GCP | Not specified | $170 / 1 / — |
| Shayan | Website Redesign for Dog Daycare | Web Design, WordPress, Web Dev | Not specified | $954 / 4 / 5.00 |
| Craig | PowerApp Developer & Consultant Needed | MS PowerApps, SharePoint, Windows | Not specified | $430 / 2 / — |
| Shayan | OnBoardNoe: Guided Onboarding Platform | Web Dev, WordPress, Web Design, JS | Not specified | $85,114 / 38 / 4.57 |
| Shayan | Independent consulting website | Web Design, WordPress, Wix, Wireframing | 20–50 USD | — / — / — |

**Failure mode.** 30+ proposals already submitted (Upwork "30+ proposals" indicator) — saturation makes marginal connect ROI negative regardless of client quality.

#### 6.7.4 "Low Higher rate" *(typo — should read "Low Hourly Rate")* (n=82 — 5 representative)

| Profile | Title | Skills (excerpt) | Budget | client_spent / hires / rating |
|---|---|---|---|---|
| Shayan | SeedProd Landing Page Creation | Web Design, HTML5, Landing Page, Graphic Design | 15–30 USD | — / 1 / — |
| Shayan | Senior Full-Stack Developer for Talent Marketplace MVP | Next.js, PostgreSQL, React, Node.js, Stripe | $5,000 fixed *(scope/effort mismatch)* | — / — / — |
| Shayan | Capalot Gaming Web Design | WordPress, WooCommerce, Elementor, SEO | 15–30 USD | — / — / — |
| Shayan | Family Law Firm Website Redesign | Web Design, Web Dev, Graphic Design, Logo | 15–30 USD | — / — / — |
| Shayan | Website recovery | WordPress (multi-flavor), WooCommerce, Shopify | Not specified | — / — / — |

**Failure mode.** Hourly bottom-of-range below $25/hr OR a fixed-price job whose implied hourly (estimated effort vs. budget) falls below the floor.

#### 6.7.5 "Location loc" (n=54 — 5 representative)

Per §6.5: this means the **job posting requires a US-resident freelancer** (not the client country).

| Profile | Title | Skills (excerpt) | Budget | client (spend / country) |
|---|---|---|---|---|
| Shayan | Web Manager for Ongoing Maintenance and Updates | WordPress, Web Dev, HTML, PHP | Not specified | — / United States |
| Shayan | American based app developer | JavaScript, API | Not specified | $825 / United States |
| Shayan | Custom ecommerce site migration to WooCommerce | WooCommerce, Web Design, Web Dev | $3,000 fixed | $1,550 / United States |
| Shayan | Guitar Training Tool Development | JS, WordPress, HTML, PHP, Web Dev | Not specified | — / United States |
| Shayan | Strategic Web Designer Needed for Website Build/Rebuild | Web Design, Web Dev | — | — / United States |

**Failure mode.** Posting text contains "U.S. residents only" / "must be located in the United States" / "American-based" — disqualifying for our non-US team. 69% of these come from US clients (expected); the rest are UK/CA/CH clients posting same residency lock-ins.

#### 6.7.6 "Client Low spending" (n=35 — 5 representative)

| Profile | Title | Skills (excerpt) | Budget | client_spent / hires / rating |
|---|---|---|---|---|
| Shayan | Website Updates Needed – FAQ + Team Page + Resource Page | WordPress | Not specified | $231 / 4 / 1.91 |
| Shayan | Consulting Firm Website Redesign | Web Design, Web Dev, WordPress, Graphic Design | 15–30 USD | $262 / 1 / — |
| Shayan | IT Expert Needed for Migration Project | WordPress, PHP, Web Dev, Data Entry, JS | 10–20 USD | $211 / 6 / 5.00 |
| Shayan | Framer developer | Web Dev, Framer, webdesign, ui ux | 15–30 USD | $300 / 9 / 5.00 |
| Khansa | Programmer for Case Management System | PHP, MySQL | Not specified | $204,510 / 219 / 4.92 *(co-flagged for low budget signal)* |

**Failure mode.** Client lifetime spend < $1,000 → low conviction the client will actually pay. Median in this rejection group is $228 — well below the $1,000 threshold.

#### 6.7.7 Less common rejection reasons

| Reason | n | Representative example | Key signal |
|---|---|---|---|
| Bad rating client | 6 | [Shayan] WordPress Bug Fixing Expert — $4,064 / 9 / **2.07** | Client rating < 4.0 |
| Bad rating client | 6 | [Khansa] Showit + Systeme.io Funnel Assistant — $1,039 / 4 / **1.52** | Client rating < 4.0 |
| Already hired | 8 | [Sana] Upgrade Laravel Website to Latest — $192,993 / 28 / 5.00 | Posting closed before bid |
| Already hired | 8 | [Khansa] Next.js + Supabase Marketplace, $5,000 fixed | Posting closed before bid |
| Job unavailable | 18 | [Sana] SEO Specialist – Local SEO — $1,866 / 12 / 5.00 | Posting taken down |
| Job unavailable | 18 | [Khansa] ZENTIQ AI – GLOBAL SaaS PLATFORM, $5,000 fixed | Posting taken down |
| Video Proposal | 4 | [Sana] Product Engineer (Next.js / Node) — **$1,226,133** / 92 / 4.97 | Job requires video pitch (large client, format mismatch) |
| Video Proposal | 4 | [Khansa] Frontend QA + UX Polish (Lovable / React) — $59,149 / 43 / 4.82 | Job requires video pitch |
| Language barrier | 6 | [Sana] WordPress + HubSpot Maintenance — Oman / $14,522 / 21 / 5.00 | Communication non-English |
| Language barrier | 6 | [Laiba] Go High Level setup in Spanish — Uruguay / $40,041 / 112 / 4.80 | Spanish-required role |
| Portfolio unavailable | 2 | [Khansa] AI-Augmented SE (Claude Code) — Canada / $10,412 / 1 / — | Profile lacks comparable case study |
| Portfolio unavailable | 2 | [Laiba] Python Dev for Windows-based HMI — $3,009 / 1 / 5.00 | Profile lacks Python/HMI portfolio |
| Duplicate | 2 | [Shayan] HubSpot HTML/CSS Developer — $7,672 / 26 / 4.72 | Same `_job_id` already on board |

**Reading.** Rare reasons cluster on **format mismatch** (video proposal, language) or **system state** (already hired, taken down, duplicate). They are mostly orthogonal to client quality — the Video Proposal cluster averages **$326k client spend**, our highest of any reject category.

---

### 6.8 Concrete proceed examples

Jobs that bypassed every hard gate and reached Proposal Submitted or further (n8n-sourced only — the 124 with full metadata + downstream stages). These define **what good looks like** for the LLM classifier.

#### 6.8.1 Won + In Chat + Proposal Views (highest-conviction signal)

| Stage | Profile | Title | Skills (excerpt) | Budget | client (spend / hires / rating) |
|---|---|---|---|---|---|
| **Won** | Laiba | AI + Frontend Integration (Voiceflow + UI State + Kajabi) | API Integration, Next.js, Python, RAG, LangChain | Not specified | $200 / 1 / — |
| In Chat | Khansa | Full Stack + AI Systems Engineer (AI OS for Businesses) | AI Agent Dev, Python, ML, API | 15–35 USD | $10,051 / 32 / 4.94 |
| In Chat | Shayan | JavaScript App Code Verification & Server Configuration | JavaScript, Node.js, API | $2,400 fixed | — / — / — |
| Proposal Views | Khansa | AI-Powered Email Filtering SaaS Platform | Python, API, JS, Node.js | 30–50 USD | $9,801 / 38 / 4.98 |
| Proposal Views | Khansa | Full-Stack Developer for Claude-Powered SaaS MVP | AI App Dev, Web App, Claude, React | 25–47 USD | $111 / 5 / 5.00 |
| Proposal Views | Khansa | Developer needed for mobile site with AI integration | AI TTS, MySQL, Web Dev, JS, PHP | 25–55 USD | $19,345 / 38 / 4.98 |
| Proposal Views | Laiba | Senior Fraud Detection System Architect | Fraud Detection, ML, Risk Assessment, FinTech | Not specified | — / — / — |
| Proposal Views | Laiba | RAG + Knowledge Graph System | Python, RAG, Knowledge Graph, Neo4j, Vector DB | Not specified | $15,455 / 71 / 4.97 |
| Proposal Views | Sana | Local SEO Specialist for U.S. Accounting Firm | SEO, Keyword Research, Backlinking, Audit | Not specified | $4,808 / 19 / 5.00 |
| Proposal Views | Shayan | Website Development for Customized Rubber Stamps | Graphic Design, Web Dev, Web Design, Magento 2 | Not specified | **$608,192** / 91 / 4.97 |

**Pattern.** Strong client spend ($4k–$608k) with hire history (5–91) and rating ≥ 4.94 when present, OR weak client signal but stack-perfect AI/fintech work on a profile geared for it (Khansa AI cluster, Laiba RAG/fraud).

#### 6.8.2 Proposal Submitted (15 representative across profiles)

| Profile | Title | Skills (excerpt) | Budget | client (spend / hires / rating) |
|---|---|---|---|---|
| Sana | Woocommerce expert assistance | WooCommerce, WordPress, Meta Pixel, GA4 | 30–60 USD | $21,167 / 10 / 5.00 |
| Sana | Software Engineer for Boutique M&A Advisory | Python, JS, AI Dev, AWS Lambda, SQL, Zapier | 15–35 USD | $92,602 / 43 / 5.00 |
| Sana | Senior Full Stack Architect / Technical Lead | NestJS, Python, React, Node.js | 25–35 USD | $8,410 / 103 / 4.96 |
| Khansa | Sr. Fullstack Software Engineer | (no skills tag) | Not specified | — / 603 / 4.90 |
| Khansa | Principal Engineer for AI-Built Next.js / Vercel / Prisma archive | React, TS, Next.js, PostgreSQL, Vercel, Prisma | 40–75 USD | $3,636 / 18 / 5.00 |
| Khansa | Restaurant & Influencer Marketplace w/ Escrow & FAVR Pay | Web App, API, PHP, JS, Marketing | $2,500 fixed | $6,918 / 14 / 4.30 |
| Laiba | AI Automation Workflow Setup n8n + Custom AI Agent | Node.js, n8n, Workflow Automation, Python, REST | 15–20 USD | $5,867 / 146 / 5.00 |
| Laiba | AI Automation Specialist | Automated Workflow, OpenAI API, M365 Copilot, n8n | Not specified | $2,888 / 1 / — |
| Laiba | Senior backend AI engineer with production LLM experience | Python, AWS, React, LLM Prompt Eng, API | 10–50 USD | $75 / 4 / 5.00 |
| Shayan | WordPress/WooCommerce Developer Needed | WordPress, WooCommerce, PHP | 12–27 USD | — / — / — |
| Shayan | PDR API Integration Development (Fannie Mae) | API, PHP, JS, API Integration, WordPress | $6,000 fixed | — / — / — |
| Shayan | Mobile and Web Developer for Digital Compliance Website | WordPress, Web Dev, JS, Web Design, PHP | 15–35 USD | $23,526 / 6 / 5.00 |
| Craig | Software engineer and mobile development lead | JS, TS, React, Material UI, Node.js, Next.js, RN | Not specified | — / — / — |
| Craig | App development for all mobile app stores | Flutter, Mobile App Dev, Android, iOS | Not specified | — / — / — |
| Craig | IPTV Streaming App Developer | Android, Mobile App Dev, iOS, PHP | Not specified | — / — / — |

**Pattern.** Stack alignment dominates. Every accepted job has at least one core stack keyword from the assigned profile's bucket. Sparse client metadata (especially on hourly Upwork jobs) is **tolerated** when the work is unambiguously on-stack. Notably, rejected jobs in §6.7 frequently have *better* client metadata than accepted ones — confirming **stack match outweighs client signal in current acceptance behaviour**. Threshold calibration in §11 should weigh this carefully.

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

## 16. Appendix C — LLM-ready example library (JSON)

This appendix is **the structured form of §6.7 and §6.8**, designed for direct embedding into the upcoming n8n classifier node's system prompt. Each example carries a `gates_failed` (rejects) or `gates_passed` (proceeds) array using the gate IDs defined in §7, plus a one-line `explanation` linking evidence to the gate.

**Gate ID reference** (matches §7 row order):

| ID | Gate | Reason label on fail |
|---|---|---|
| `1_stack_match` | Stack match | "Out of stack" |
| `2_freshness` | Job freshness (≤ 24h) | "Old job" |
| `3_proposal_saturation` | < 30 proposals | "Too many invites" |
| `4_hourly_floor` | Hourly bottom ≥ $25/hr | "Low Higher rate" |
| `5_client_spend_floor` | client_spent ≥ $1,000 | "Client Low spending" |
| `6_client_rating_floor` | client_rating ≥ 4.0 | "Bad rating client" |
| `7_job_availability` | Posting open | "Job unavailable" / "Already hired" |
| `8_no_location_lockin` | No country residency requirement | "Location loc" |
| `9_no_video_proposal` | No video pitch required | "Video Proposal" |
| `10_portfolio_match` | Profile has matching portfolio | "Portfolio unavailable" |
| `11_no_duplicate` | Job not already on board | "Duplicate" |

The "Language barrier" reason maps to §8 soft signals, not a hard gate — represented in the JSON below as `gates_failed: []` with the reason captured separately.

```json
{
  "version": "0.2",
  "generated_at": "2026-05-05",
  "source": "Contabo sales_dashboard, n8n-sourced tasks (_source = 'n8n')",
  "reject_examples": [
    {
      "title": "Web Developer",
      "profile": "Craig",
      "skills": ["Web Development"],
      "budget": "Not specified",
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "reasons": ["Out of stack"],
      "gates_failed": ["1_stack_match"],
      "explanation": "Single generic skill tag with no concrete stack signal — cannot be mapped to any profile bucket."
    },
    {
      "title": "Need Wordpress developer with Polylang expertise",
      "profile": "Shayan",
      "skills": ["Polylang", "WordPress", "PHP", "CSS"],
      "budget": "20 - 40 USD",
      "client": {"spent": 29660.90, "hires": 19, "rating": 4.99, "country": "United States"},
      "reasons": ["Out of stack"],
      "gates_failed": ["1_stack_match"],
      "explanation": "Polylang is a niche WordPress i18n plugin; not in Shayan's bucket despite WordPress overlap."
    },
    {
      "title": "Programmatic SEO Strategist for Golf Travel Startup — Next.js SEO Page Launch",
      "profile": "Shayan",
      "skills": ["Search Engine Optimization", "SEO Keyword Research", "Organic Traffic Growth", "Google Analytics", "On-Page SEO"],
      "budget": "10 - 20 USD",
      "client": {"spent": 1000, "hires": 3, "rating": 5.00, "country": "United States"},
      "reasons": ["Out of stack"],
      "gates_failed": ["1_stack_match", "4_hourly_floor"],
      "explanation": "SEO strategy role with a Next.js red herring in the title; hourly bottom $10 is below floor."
    },
    {
      "title": "I need a frontend developer to recreate a Figma design (Laravel/Blade/Livewire)",
      "profile": "Shayan",
      "skills": ["Front-End Development", "Laravel", "Blade Server", "tailwindcss", "livewire"],
      "budget": "18 - 40 USD",
      "client": {"spent": 2861.40, "hires": 29, "rating": 4.98, "country": "United Kingdom"},
      "reasons": ["Out of stack"],
      "gates_failed": ["1_stack_match"],
      "explanation": "Laravel/Blade/Livewire stack — Shayan is React/Next.js-leaning; mismatched bucket."
    },
    {
      "title": "Wix Website Designer Needed for Section Redesign",
      "profile": "Shayan",
      "skills": ["Wix", "Web Design", "Graphic Design", "Mockup", "Web Development"],
      "budget": "15 - 30 USD",
      "client": {"spent": 672.89, "hires": 63, "rating": 5.00, "country": "Nigeria"},
      "reasons": ["Old job", "Out of stack"],
      "gates_failed": ["1_stack_match", "2_freshness"],
      "explanation": "No-code platform (Wix); we don't field Wix work on any profile."
    },

    {
      "title": "Senior Node.js Engineer — On-Call Maintenance for AI Document Pipeline",
      "profile": "Sana",
      "skills": ["API Integration", "Node.js", "JavaScript", "API", "PDF Conversion", "Claude API", "Open AI API", "Automation Workflow"],
      "budget": "20 - 40 USD",
      "client": {"spent": 189896.64, "hires": 58, "rating": 4.99, "country": "United States"},
      "reasons": ["Old job"],
      "gates_failed": ["2_freshness"],
      "explanation": "On-stack and high-conviction client signal, but listing was already 24h+ old when triaged."
    },
    {
      "title": "Divi/WordPress Designer Needed — 10-Page Site Refresh (3-4 Week Sprint)",
      "profile": "Sana",
      "skills": ["Divi", "Responsive Design", "Landing Page", "WordPress", "Web Design", "Visual Design"],
      "budget": "18 - 40 USD",
      "client": {"spent": 4928.68, "hires": 9, "rating": 4.99, "country": "United States"},
      "reasons": ["Old job"],
      "gates_failed": ["2_freshness"],
      "explanation": "Stack-aligned WordPress + healthy client, but listing aged past freshness window."
    },
    {
      "title": "Advanced All-in-One Travel Booking Platform (Flights, Hotels, & Cars)",
      "profile": "Rebekah",
      "skills": ["Full-Stack Development", "Next.js", "React", "JavaScript", "TypeScript", "API Integration", "AI Agent Development", "n8n", "React Native", "Supabase"],
      "budget": "Not specified",
      "client": {"spent": null, "hires": null, "rating": null, "country": "Canada"},
      "reasons": ["Old job"],
      "gates_failed": ["2_freshness"],
      "explanation": "On-stack for Rebekah but listing aged out — Rebekah's feed cadence is a recurring root cause (90% Old job)."
    },
    {
      "title": "Operations Specialist wanted for busy Founder",
      "profile": "Saim",
      "skills": ["Email Communication", "Microsoft Word", "Microsoft Excel", "Administrative Support"],
      "budget": "25 USD",
      "client": {"spent": 29186.95, "hires": 21, "rating": 4.72, "country": "United States"},
      "reasons": ["Old job"],
      "gates_failed": ["1_stack_match", "2_freshness"],
      "explanation": "Admin/ops role — out of dev stack entirely; would also fail freshness."
    },

    {
      "title": "FlutterFlow + Firebase Developer Needed — Paid Messaging / Transactional Chat Feature",
      "profile": "Craig",
      "skills": ["FlutterFlow", "Flutter", "API Integration", "Supabase", "Google Cloud Platform", "Mobile App Development", "Firebase"],
      "budget": "Not specified",
      "client": {"spent": 170, "hires": 1, "rating": null, "country": "Australia"},
      "reasons": ["Too many invites"],
      "gates_failed": ["3_proposal_saturation", "5_client_spend_floor"],
      "explanation": "Saturated job board for this listing; client spend $170 also below floor."
    },
    {
      "title": "Website Redesign for Dog Daycare",
      "profile": "Shayan",
      "skills": ["Web Design", "WordPress", "Web Development", "Website Redesign", "Graphic Design", "Marketing"],
      "budget": "Not specified",
      "client": {"spent": 953.50, "hires": 4, "rating": 5.00, "country": "United States"},
      "reasons": ["Too many invites"],
      "gates_failed": ["3_proposal_saturation"],
      "explanation": "On-stack and decent client, but 30+ proposals already in — connect ROI negative."
    },
    {
      "title": "PowerApp Developer & Consultant Needed",
      "profile": "Craig",
      "skills": ["Microsoft PowerApps", "Microsoft SharePoint Development", "Microsoft Windows", "Microsoft SharePoint", "iOS"],
      "budget": "Not specified",
      "client": {"spent": 430, "hires": 2, "rating": null, "country": "United States"},
      "reasons": ["Too many invites"],
      "gates_failed": ["1_stack_match", "3_proposal_saturation"],
      "explanation": "PowerApps not in any profile bucket; saturated regardless."
    },
    {
      "title": "Website Development for OnBoardNoe: Guided Onboarding Platform",
      "profile": "Shayan",
      "skills": ["Web Development", "WordPress", "Web Design", "JavaScript", "HTML"],
      "budget": "Not specified",
      "client": {"spent": 85114.41, "hires": 38, "rating": 4.57, "country": "United Kingdom"},
      "reasons": ["Too many invites"],
      "gates_failed": ["3_proposal_saturation"],
      "explanation": "Strong client signal ($85k / 38 hires) but saturation killed marginal ROI."
    },

    {
      "title": "SeedProd Landing Page Creation",
      "profile": "Shayan",
      "skills": ["Web Design", "HTML5", "Landing Page", "Graphic Design"],
      "budget": "15 - 30 USD",
      "client": {"spent": null, "hires": 1, "rating": null, "country": "Canada"},
      "reasons": ["Low Higher rate"],
      "gates_failed": ["4_hourly_floor"],
      "explanation": "Hourly bottom $15 is below the $25 floor; client signal also weak."
    },
    {
      "title": "Senior Full-Stack Developer needed for Talent Marketplace Platform MVP (Next.js + Stripe)",
      "profile": "Shayan",
      "skills": ["Next.js", "PostgreSQL", "React", "Node.js", "Stripe"],
      "budget": "5,000 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "Mexico"},
      "reasons": ["Low Higher rate"],
      "gates_failed": ["4_hourly_floor"],
      "explanation": "Fixed-price $5k for an MVP-scope Next.js platform; implied effort produces sub-floor hourly rate."
    },
    {
      "title": "Capalot Gaming Web Design",
      "profile": "Shayan",
      "skills": ["WordPress", "WooCommerce", "Elementor", "Page Speed Optimization", "Landing Page Design", "SEO Audit", "Web Design"],
      "budget": "15 - 30 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "reasons": ["Low Higher rate"],
      "gates_failed": ["4_hourly_floor"],
      "explanation": "Hourly $15-30 below floor; gaming-themed WP build."
    },
    {
      "title": "Family Law Firm Website Redesign",
      "profile": "Shayan",
      "skills": ["Web Design", "Web Development", "Graphic Design", "Logo Design"],
      "budget": "15 - 30 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "reasons": ["Low Higher rate", "Out of stack"],
      "gates_failed": ["1_stack_match", "4_hourly_floor"],
      "explanation": "Generic 'Web Design / Logo Design' tags + sub-floor hourly."
    },

    {
      "title": "Web Manager for Ongoing Maintenance and Updates",
      "profile": "Shayan",
      "skills": ["WordPress", "Web Development", "HTML", "PHP", "CSS"],
      "budget": "Not specified",
      "client": {"spent": null, "hires": 1, "rating": null, "country": "United States"},
      "reasons": ["Location loc"],
      "gates_failed": ["8_no_location_lockin"],
      "explanation": "On-stack maintenance role but posting requires US-resident freelancer."
    },
    {
      "title": "American based app developer",
      "profile": "Shayan",
      "skills": ["JavaScript", "API"],
      "budget": "Not specified",
      "client": {"spent": 825.49, "hires": 1, "rating": null, "country": "United States"},
      "reasons": ["Location loc"],
      "gates_failed": ["8_no_location_lockin"],
      "explanation": "Title literally states US-based requirement."
    },
    {
      "title": "Custom ecommerce site migration to WooCommerce",
      "profile": "Shayan",
      "skills": ["WooCommerce", "Web Design", "Web Development", "Ecommerce Website Development"],
      "budget": "3,000 USD",
      "client": {"spent": 1550.20, "hires": 6, "rating": 5.00, "country": "United States"},
      "reasons": ["Location loc"],
      "gates_failed": ["8_no_location_lockin"],
      "explanation": "Stack-aligned + acceptable client, but US-residency lock in posting body."
    },
    {
      "title": "Strategic Web Designer Needed for Website Build/Rebuild",
      "profile": "Shayan",
      "skills": ["Web Design", "Web Development"],
      "budget": null,
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "reasons": ["Location loc"],
      "gates_failed": ["8_no_location_lockin"],
      "explanation": "Posting requires US-based freelancer."
    },

    {
      "title": "Website Updates Needed – FAQ Section, Team Page Completion & Resource Page Setup",
      "profile": "Shayan",
      "skills": ["WordPress"],
      "budget": "Not specified",
      "client": {"spent": 230.75, "hires": 4, "rating": 1.91, "country": "United States"},
      "reasons": ["Client Low spending"],
      "gates_failed": ["5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "Client spent only $231 + low rating 1.91 — double red flag."
    },
    {
      "title": "Consulting Firm Website Redesign",
      "profile": "Shayan",
      "skills": ["Web Design", "Web Development", "WordPress", "Graphic Design"],
      "budget": "15 - 30 USD",
      "client": {"spent": 262.24, "hires": 1, "rating": null, "country": "United States"},
      "reasons": ["Client Low spending"],
      "gates_failed": ["4_hourly_floor", "5_client_spend_floor"],
      "explanation": "Sub-floor hourly + client spend $262."
    },
    {
      "title": "IT Expert Needed for Migration Project",
      "profile": "Shayan",
      "skills": ["WordPress", "PHP", "Web Development", "Data Entry", "JavaScript"],
      "budget": "10 - 20 USD",
      "client": {"spent": 210.97, "hires": 6, "rating": 5.00, "country": "United States"},
      "reasons": ["Client Low spending"],
      "gates_failed": ["4_hourly_floor", "5_client_spend_floor"],
      "explanation": "Hourly $10-20 below floor; client spend $211 below floor; 5.0 rating cannot offset."
    },
    {
      "title": "Framer developer",
      "profile": "Shayan",
      "skills": ["Web Development", "Framer", "webdesign", "ui ux"],
      "budget": "15 - 30 USD",
      "client": {"spent": 300.19, "hires": 9, "rating": 5.00, "country": "France"},
      "reasons": ["Client Low spending"],
      "gates_failed": ["1_stack_match", "4_hourly_floor", "5_client_spend_floor"],
      "explanation": "Framer (no-code design) not in stack; sub-floor hourly + low spend."
    },

    {
      "title": "WordPress Bug Fixing Expert Needed",
      "profile": "Shayan",
      "skills": ["WordPress", "PHP", "WordPress Plugin", "Web Development"],
      "budget": "30 - 50 USD",
      "client": {"spent": 4063.63, "hires": 9, "rating": 2.07, "country": "United States"},
      "reasons": ["Bad rating client"],
      "gates_failed": ["6_client_rating_floor"],
      "explanation": "Stack-perfect WP work + above-floor budget + above-floor spend, but client rating 2.07 disqualifies."
    },
    {
      "title": "Proactive Funnel & Website Assistant for Showit + Systeme.io",
      "profile": "Khansa",
      "skills": ["Landing Page", "system io", "Showit", "Email Marketing"],
      "budget": "10 - 28 USD",
      "client": {"spent": 1039.30, "hires": 4, "rating": 1.52, "country": "Netherlands"},
      "reasons": ["Bad rating client"],
      "gates_failed": ["1_stack_match", "4_hourly_floor", "6_client_rating_floor"],
      "explanation": "No-code stack + sub-floor hourly + 1.52 rating."
    },

    {
      "title": "Upgrade Laravel Website to Latest Version",
      "profile": "Sana",
      "skills": ["PHP", "Laravel", "MySQL", "MySQL Programming"],
      "budget": "25 - 50 USD",
      "client": {"spent": 192993.11, "hires": 28, "rating": 5.00, "country": "United States"},
      "reasons": ["Already hired"],
      "gates_failed": ["7_job_availability"],
      "explanation": "Otherwise an ideal job (stack + $193k spend + 5.0 rating) — but already filled."
    },
    {
      "title": "Next.js + Supabase Marketplace Deployment — Fixed Scope",
      "profile": "Khansa",
      "skills": ["Next.js", "TypeScript", "Vercel", "Supabase", "Stripe API"],
      "budget": "5,000 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "reasons": ["Already hired"],
      "gates_failed": ["7_job_availability"],
      "explanation": "Stack-perfect for Khansa, $5k fixed — but posting closed."
    },

    {
      "title": "SEO Specialist – Local SEO (Multiple Businesses)",
      "profile": "Sana",
      "skills": ["Local SEO", "On-Page SEO", "SEO Audit", "Search Engine Optimization", "Google business profile", "Organic Traffic Growth"],
      "budget": "15 - 20 USD",
      "client": {"spent": 1866, "hires": 12, "rating": 5.00, "country": "United States"},
      "reasons": ["Job unavailable"],
      "gates_failed": ["7_job_availability"],
      "explanation": "Posting taken down before bid sent."
    },
    {
      "title": "ZENTIQ AI – GLOBAL SaaS PLATFORM",
      "profile": "Khansa",
      "skills": ["Node.js", "SaaS", "Python", "API", "AWS Application"],
      "budget": "5,000 USD",
      "client": {"spent": null, "hires": 1, "rating": null, "country": "United Kingdom"},
      "reasons": ["Job unavailable"],
      "gates_failed": ["7_job_availability"],
      "explanation": "On-stack SaaS work, but posting deleted before triage."
    },

    {
      "title": "Product Engineer (Next.js / Node) - AI Encouraged",
      "profile": "Sana",
      "skills": ["JavaScript", "Node.js", "React", "PostgreSQL", "Next.js", "TypeScript", "Prisma", "Fastify"],
      "budget": "40 - 65 USD",
      "client": {"spent": 1226132.69, "hires": 92, "rating": 4.97, "country": "United States"},
      "reasons": ["Video Proposal"],
      "gates_failed": ["9_no_video_proposal"],
      "explanation": "$1.2M spend + 92 hires + 4.97 rating + on-stack — would be elite, but requires video pitch (out of process)."
    },
    {
      "title": "Frontend QA + UX Polish (Lovable / React) – Mobile App Feel (PWA)",
      "profile": "Khansa",
      "skills": ["Responsive Design", "UI Animation", "Front-End Development", "JavaScript", "react.js", "Progressive Web App"],
      "budget": "15 - 30 USD",
      "client": {"spent": 59149.46, "hires": 43, "rating": 4.82, "country": "Netherlands"},
      "reasons": ["Video Proposal"],
      "gates_failed": ["4_hourly_floor", "9_no_video_proposal"],
      "explanation": "Strong client + on-stack, but sub-floor hourly + video pitch requirement."
    },

    {
      "title": "Ongoing WordPress Maintenance and HubSpot Integration",
      "profile": "Sana",
      "skills": ["WordPress", "CSS", "Web Development", "HubSpot", "HTML"],
      "budget": "14 - 28 USD",
      "client": {"spent": 14522.11, "hires": 21, "rating": 5.00, "country": "Oman"},
      "reasons": ["Language barrier"],
      "gates_failed": [],
      "soft_signal_failed": ["language_barrier"],
      "explanation": "Healthy client, on-stack, but client communication non-English. Maps to §8 soft signal, not a hard gate."
    },

    {
      "title": "AI-Augmented Software Engineer (Contract) — Ship Features Fast with Claude Code",
      "profile": "Khansa",
      "skills": ["Node.js", "AWS Lambda", "TypeScript", "Python", "JavaScript", "Claude", "amazon connect"],
      "budget": "30 - 45 USD",
      "client": {"spent": 10412.27, "hires": 1, "rating": null, "country": "Canada"},
      "reasons": ["Portfolio unavailable"],
      "gates_failed": ["10_portfolio_match"],
      "explanation": "Stack-aligned + above-floor, but profile lacked a Claude-Code-style case study to attach."
    },

    {
      "title": "HubSpot HTML/CSS Developer Needed – Clean Up Code, Fix Speed Issues",
      "profile": "Shayan",
      "skills": ["CSS", "HTML", "JavaScript", "HTML5", "Website", "PHP"],
      "budget": "Not specified",
      "client": {"spent": 7672.31, "hires": 26, "rating": 4.72, "country": "United States"},
      "reasons": ["Duplicate"],
      "gates_failed": ["11_no_duplicate"],
      "explanation": "Same `_job_id` already tracked on a sibling profile's board."
    }
  ],
  "proceed_examples": [
    {
      "title": "AI + Frontend Integration (Voiceflow + UI State + Kajabi) — Discovery Phase",
      "profile": "Laiba",
      "skills": ["API Integration", "Full-Stack Development", "Next.js", "Python", "AI Implementation", "AI Agent Development", "React", "Retrieval Augmented Generation", "LangChain", "Node.js"],
      "budget": "Not specified",
      "client": {"spent": 200, "hires": 1, "rating": null, "country": "United States"},
      "outcome_stage": "Won",
      "gates_passed": ["1_stack_match", "2_freshness", "3_proposal_saturation", "7_job_availability", "8_no_location_lockin", "9_no_video_proposal", "10_portfolio_match", "11_no_duplicate"],
      "explanation": "Stack-perfect AI/Next.js work for Laiba; sparse client metadata tolerated due to discovery-phase scope. Closed Won."
    },
    {
      "title": "Full Stack + AI Systems Engineer (AI Operating System for Businesses)",
      "profile": "Khansa",
      "skills": ["AI Agent Development", "AI App Development", "AI Model Integration", "Artificial Intelligence", "Python", "Machine Learning", "API"],
      "budget": "15 - 35 USD",
      "client": {"spent": 10050.87, "hires": 32, "rating": 4.94, "country": "United States"},
      "outcome_stage": "InChat",
      "gates_passed": ["1_stack_match", "2_freshness", "3_proposal_saturation", "5_client_spend_floor", "6_client_rating_floor", "7_job_availability", "8_no_location_lockin"],
      "explanation": "Stack-perfect AI work + $10k spend + 4.94 rating. Hourly $15-35 borderline (fail on strict $25 floor — bottom is $15) but agent proceeded; flagged for §11 question 1."
    },
    {
      "title": "JavaScript App Code Verification and Server Configuration",
      "profile": "Shayan",
      "skills": ["JavaScript", "Node.js", "API"],
      "budget": "2,400 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "Canada"},
      "outcome_stage": "InChat",
      "gates_passed": ["1_stack_match", "2_freshness", "3_proposal_saturation", "7_job_availability"],
      "explanation": "Stack-aligned JS/Node work; $2,400 fixed implies acceptable hourly. Client metadata sparse but stack signal dominated."
    },
    {
      "title": "Develop an AI-Powered Email Filtering SaaS Platform",
      "profile": "Khansa",
      "skills": ["Python", "API", "JavaScript", "Node.js"],
      "budget": "30 - 50 USD",
      "client": {"spent": 9800.54, "hires": 38, "rating": 4.98, "country": "United States"},
      "outcome_stage": "ProposalViews",
      "gates_passed": ["1_stack_match", "4_hourly_floor", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "Above-floor hourly $30-50 + on-stack + $9.8k spend + 4.98 rating. Textbook proceed."
    },
    {
      "title": "Full-Stack Developer Needed to Build Claude-Powered SaaS MVP",
      "profile": "Khansa",
      "skills": ["AI App Development", "Website Redesign", "Web Application", "Claude", "React"],
      "budget": "25 - 47 USD",
      "client": {"spent": 110.73, "hires": 5, "rating": 5.00, "country": "Kenya"},
      "outcome_stage": "ProposalViews",
      "gates_passed": ["1_stack_match", "4_hourly_floor", "6_client_rating_floor"],
      "explanation": "Hourly bottom $25 = floor pass; client spend $111 below threshold but agent proceeded on stack-perfection (Claude/React/SaaS for Khansa) — 5.0 rating offsets."
    },
    {
      "title": "RAG + Knowledge Graph System - Fixed Price Build",
      "profile": "Laiba",
      "skills": ["Python", "Retrieval Augmented Generation", "Knowledge Graph", "Neo4j", "Vector Database"],
      "budget": "Not specified",
      "client": {"spent": 15455.21, "hires": 71, "rating": 4.97, "country": "United Kingdom"},
      "outcome_stage": "ProposalViews",
      "gates_passed": ["1_stack_match", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "Niche but Laiba-aligned stack (RAG/KG/Vector); $15k client + 71 hires + 4.97 rating."
    },
    {
      "title": "Local SEO Specialist for U.S. Accounting Firm",
      "profile": "Sana",
      "skills": ["Search Engine Optimization", "SEO Keyword Research", "SEO Backlinking", "SEO Audit", "Organic Traffic Growth", "On-Page SEO"],
      "budget": "Not specified",
      "client": {"spent": 4807.90, "hires": 19, "rating": 5.00, "country": "United States"},
      "outcome_stage": "ProposalViews",
      "gates_passed": ["5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "SEO work for Sana — note: §6.7 has SEO as out-of-stack for Shayan but Sana's bucket allows SEO/marketing-adjacent. Stack-bucket per profile matters."
    },
    {
      "title": "Software Engineer for Boutique M&A Advisory Firm",
      "profile": "Sana",
      "skills": ["API Development", "Python", "JavaScript", "AI Development", "AWS Lambda", "SQL", "Zapier", "CRM Automation"],
      "budget": "15 - 35 USD",
      "client": {"spent": 92602.24, "hires": 43, "rating": 5.00, "country": "United States"},
      "outcome_stage": "ProposalSubmitted",
      "gates_passed": ["1_stack_match", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "Strong client signal ($92k spend, 5.0 rating) + on-stack Python/AI/AWS. Hourly bottom $15 is below strict floor — agent override on client strength."
    },
    {
      "title": "Senior Full Stack Architect / Technical Lead",
      "profile": "Sana",
      "skills": ["NestJS", "Python", "React", "Node.js", "System Architecture", "Full Stack Development", "API Design", "Technical Leadership"],
      "budget": "25 - 35 USD",
      "client": {"spent": 8409.58, "hires": 103, "rating": 4.96, "country": "United Kingdom"},
      "outcome_stage": "ProposalSubmitted",
      "gates_passed": ["1_stack_match", "4_hourly_floor", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "Hourly $25 floor pass + 103 hires + 4.96 rating + NestJS/Python/React on Sana's bucket."
    },
    {
      "title": "Principal Engineer / Technical Steward for AI-Built Next.js / Vercel / Prisma archive",
      "profile": "Khansa",
      "skills": ["React", "TypeScript", "Next.js", "PostgreSQL", "Vercel", "Software Debugging", "Node.js", "Prisma"],
      "budget": "40 - 75 USD",
      "client": {"spent": 3636.22, "hires": 18, "rating": 5.00, "country": "United States"},
      "outcome_stage": "ProposalSubmitted",
      "gates_passed": ["1_stack_match", "4_hourly_floor", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "All gates pass cleanly: hourly $40-75, client $3.6k, rating 5.0, stack perfect."
    },
    {
      "title": "AI Automation Workflow Setup n8n + Custom AI Agent",
      "profile": "Laiba",
      "skills": ["Node.js", "n8n", "Workflow Automation", "AI Integration", "AI Agents", "Python", "REST API", "Webhooks"],
      "budget": "15 - 20 USD",
      "client": {"spent": 5867.27, "hires": 146, "rating": 5.00, "country": "United Arab Emirates"},
      "outcome_stage": "ProposalSubmitted",
      "gates_passed": ["1_stack_match", "5_client_spend_floor", "6_client_rating_floor"],
      "explanation": "146 hires + 5.0 rating + n8n/AI core stack. Hourly $15-20 below strict floor — agent override on client strength + stack-perfection."
    },
    {
      "title": "PDR API Integration Development Using Fannie Mae Specifications",
      "profile": "Shayan",
      "skills": ["API", "PHP", "JavaScript", "API Integration", "WordPress"],
      "budget": "6,000 USD",
      "client": {"spent": null, "hires": null, "rating": null, "country": "United States"},
      "outcome_stage": "ProposalSubmitted",
      "gates_passed": ["1_stack_match"],
      "explanation": "Stack-aligned + $6k fixed scope. Client metadata sparse but agent proceeded on stack signal."
    }
  ]
}
```

**Usage notes for the n8n classifier author:**
1. Embed this `reject_examples` + `proceed_examples` array verbatim in the AI Agent system prompt as labeled few-shot examples.
2. The classifier should output `proceed | reject` plus the reason label (matching §6.2 spelling exactly — `"Out of stack"`, `"Old job"`, `"Low Higher rate"` etc.) so n8n can route directly to the right column.
3. If a job exhibits multiple gate failures, the AI should return all matching reason labels (the `_reason` field is multi-select on the Task Board UI).
4. **The LLM MUST NOT invent new reason labels.** Every output reason must be one of the 13 labels in §6.2.
5. Soft signals (§8) are advisory — the classifier should weigh them but not auto-reject on a single soft signal alone.
6. To refresh examples, re-run the queries in §14 Appendix A — pick top-N per reason ordered by `created_at DESC`.

---

## 17. Changelog

This section is **append-only**. Every edit to this PRD must add a row at the top with: date (YYYY-MM-DD), version bump, what changed (one line), why (one line), evidence (data query result or stakeholder name), reviewer.

| Date | Version | What changed | Why | Evidence | Reviewer |
|---|---|---|---|---|---|
| 2026-05-05 | v0.2 | Added §6.7 (concrete reject examples by reason, ~40 jobs across 13 categories), §6.8 (concrete proceed examples, 25 jobs from Won → Proposal Submitted), and §15.5 Appendix C (LLM-ready JSON example library with `gates_failed` / `gates_passed` annotations and gate-ID reference). Additive only — no edits to v0.1 §1–§13 content. | Make the PRD usable as in-context training data for the upcoming n8n AI classifier node, so a single source of truth governs both human review and machine classification. | Contabo `sales_dashboard` snapshot 2026-05-05: 668 n8n-sourced N/A tasks (taxonomy fully populated) + 124 n8n-sourced Proposal Submitted + 9 Proposal Views + 2 In Chat + 1 Won. Live queries in §14 Appendix A. | Drafted by Claude (relevancy-criteria-keeper persona) in collaboration with Waqas |
| 2026-05-05 | v0.1 | Initial draft | Define a written rule set for job relevancy from observed agent behaviour | Contabo task board snapshot: 681 N/A + 603 Proposal Submitted tasks, 13 distinct rejection reasons, per-profile matrix, comparative numeric profile | Drafted by Claude in collaboration with Waqas |

---

*End of PRD.*
