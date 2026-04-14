# Rising Lions Dashboard — Agent User Guide

A plain-language guide to the Sales Dashboard for agents. Covers every screen you use, every number you see, and what happens behind the scenes so you know when something is working as designed.

> **How to use this guide:** Each section is self-contained. Jump to the part you need. If a number on screen ever confuses you, find it in the **Stats & Counts** section — it probably has an explanation.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Your Pages (`/my-*`)](#2-your-pages)
3. [The Task Board](#3-the-task-board)
4. [The Task Card (Detail View)](#4-the-task-card-detail-view)
5. [Job Lifecycle: From New Job to Won/Lost](#5-job-lifecycle)
6. [Connects System](#6-connects-system)
7. [Stats & Counts — How Every Number Is Calculated](#7-stats--counts)
8. [Labels, Priorities, Filters & Views](#8-labels-priorities-filters--views)
9. [Real-Time Updates & Refresh](#9-real-time-updates--refresh)
10. [Automation: What Happens Automatically](#10-automation)
11. [Common Misunderstandings](#11-common-misunderstandings)
12. [Glossary](#12-glossary)

---

## 1. Quick Start

You are an **agent** user. When you log in, you land on **My Dashboard**. The left sidebar gives you access to seven pages, all scoped to **your own data only** — you cannot see another agent's numbers, and admins cannot accidentally show you theirs.

The core loop:

1. A new Upwork job comes in → a **task card** appears on your **Task Board** automatically.
2. You review the card, read the AI-generated proposal, submit it on Upwork.
3. You drag the card through board columns as the job progresses (Proposal Submitted → In Chat → Meeting Done → Won/Lost).
4. Every move you make updates your dashboard numbers automatically.

You almost never have to enter data manually. The system fills most fields from the n8n workflow.

---

## 2. Your Pages

All your pages live under `/my-*`. They mirror the admin views but only show **your** data.

| Page | URL | What you see |
|---|---|---|
| **My Dashboard** | `/my-dashboard` | Your KPIs, funnel, pipeline summary, recent jobs |
| **My Pipeline** | `/my-pipeline` | Active jobs grouped by stage |
| **My Tasks** | `/my-tasks` | Your task board (job cards) |
| **My Jobs** | `/my-jobs` | Full job list, searchable |
| **My Connects** | `/my-connects` | Connects usage, boosted connects, ROI |
| **My Analytics** | `/my-analytics` | Proposal models, geography, timing, budget breakdowns |
| **My Performance** | `/my-performance` | Win rate trends, response time |

**Top bar on every page:** date range picker, theme toggle, your name, logout. There is no agent/profile filter dropdown on your pages — your data is always already filtered to you.

---

## 3. The Task Board

Your Task Board (`/my-tasks`) is where jobs live as cards. Cards move left-to-right as a job progresses.

### 3.1 The 13 Columns (in order)

| # | Column | Meaning |
|---|---|---|
| 1 | **Todo** | New job waiting for you to review and submit a proposal |
| 2 | **Proposal Submitted** | You sent the proposal on Upwork |
| 3 | **Prototype Required** | Client asked for a prototype/sample |
| 4 | **Prototype Done** | You finished the prototype |
| 5 | **Prototype Submitted** | Prototype sent to client |
| 6 | **In Chat** | Client is messaging you on Upwork |
| 7 | **Meeting Scheduled** | Call booked |
| 8 | **Meeting Done** | Call completed |
| 9 | **Negotiation** | Discussing price/scope/terms |
| 10 | **Lost** | Job closed without winning |
| 11 | **On Hold** | Paused — client went quiet, waiting for response, etc. |
| 12 | **N/A** | Not applicable / filtered out / noise |
| 13 | **Won** | Contract signed |

> **Important:** These column names are also the **job status** values in the database. When you drag a card, you are literally setting the job's status. There is no other way to change a job's status.

### 3.2 How cards arrive

- **Automatically from n8n** — Vollna finds a job on Upwork → n8n picks the right profile → Claude AI writes a proposal → a card appears in **Todo** with everything pre-filled. This is how 99% of cards are created.
- **Manually** — click **+ New Task** (top right) or the **+** button at the top of any column.

### 3.3 Moving cards

- **Drag & drop** between columns.
- **Or** open the card and change the column from the dropdown.
- Every move is saved instantly and logged in the activity history.

### 3.4 Board actions

- **Group By:** default is Status (columns). You can group by **Assignee**, **Priority**, or **Label** instead.
- **Saved Views:** save filter+sort combinations and reload them later.
- **Auto-refresh:** the board refreshes every **5 seconds** (paused when the tab is hidden).

---

## 4. The Task Card (Detail View)

Click any card to open the detail modal. Three columns: **task fields** on the left, **job details** in the middle, **proposal** on the right.

### 4.1 Core task fields (editable)

| Field | What it does |
|---|---|
| **Title** | `[profile] Job title` — auto-filled for n8n cards |
| **Description** | Rich text notes |
| **Priority** | Urgent / High / Medium / Low |
| **Due Date** | n8n cards default to **24h** from creation |
| **Start Date** | Optional |
| **Column / Status** | Same as dragging the card |
| **Assignees** | You (auto-assigned by agent name from n8n) |
| **Tags** | Profile name + `vollna-auto` for auto-created cards |
| **Checklist** | Sub-tasks with checkboxes |
| **Comments** | Team discussion (edit your own within 60 min) |
| **Activity log** | Every change, auto-recorded |
| **Attachments** | Files you upload |

### 4.2 Job Snapshot (from Upwork)

Auto-filled for n8n cards, editable:

- **Job Link** — URL on Upwork
- **Budget**
- **Skills** — comma-separated
- **Posted** — when client posted the job

### 4.3 Client Intel (from Upwork)

- **Location**
- **Rating**
- **Total Spent**
- **Past Hires**

### 4.4 Routing Info (which agent/profile was matched)

- **Agent** — you
- **Profile** — the Upwork profile used
- **Stack** — tech stack / niche
- **Job ID** — internal ID linking the card to the `jobs` table
- **Generated** — when the AI wrote the proposal

### 4.5 Proposal panel

The right column shows the **AI-generated proposal** ready to copy into Upwork. You can edit it before submitting.

### 4.6 Connects fields

- **Boosted Connects** — number. If you used boosted connects on this proposal, enter the amount here. This feeds the **Boosted Connects** and **Bid out Boost** stats (see §6).

---

## 5. Job Lifecycle

Here is exactly what happens from the moment Vollna finds a job to the moment it's Won or Lost.

### Step-by-step example

**Example:** A React developer job on Upwork.

| Step | What happens | Where |
|---|---|---|
| 1 | Vollna scrapes the job from Upwork | External |
| 2 | n8n receives it on one of 8 agent webhooks | n8n |
| 3 | n8n matches the job to a profile + agent (you) | n8n |
| 4 | Claude AI writes a proposal | n8n |
| 5 | A task card is created in your **Todo** column with title, budget, skills, client data, and proposal all pre-filled | Dashboard |
| 6 | You open the card, review the proposal, submit it on Upwork | You |
| 7 | You drag the card to **Proposal Submitted** | You |
| 8 | Client replies → drag to **In Chat** | You |
| 9 | Client schedules a call → drag to **Meeting Scheduled** | You |
| 10 | Call done → drag to **Meeting Done** | You |
| 11 | Price agreed → drag to **Negotiation** | You |
| 12 | Contract signed → drag to **Won** (or **Lost** if it falls through) | You |

### What each move triggers automatically

- **Any move:** updates `jobs.status`, logs activity, refreshes your KPIs.
- **First time into "In Chat":** records the `in_chat_at` timestamp. Used in the **In Chat** KPI.
- **First time into "Meeting Scheduled":** records `meeting_booked_at`.
- **First time into "Meeting Done":** records `meeting_done_at`. Used in the **Meetings Done** KPI.
- **Into "Won":** marks outcome as won, stamps `outcome_at`, counts toward wins.
- **Into "Lost":** marks outcome as lost.
- **Out of Won/Lost:** reversal is allowed — outcome is cleared and the job becomes active again. You can correct mistakes.

### Milestones are "ever-reached" counters

If a job reaches **In Chat** and later gets dragged to **Lost**, it still counts as an "In Chat" job on your KPIs. The milestone records the first time a job ever hit that stage, not its current status. This is why your funnel numbers don't drop when a job is lost.

---

## 6. Connects System

The Connects page (`/my-connects`) shows 6 summary cards and a breakdown by profile.

### 6.1 The 6 summary cards

| Card | What it means | How it's calculated |
|---|---|---|
| **Total Connects Used** | Connects spent on proposals this period | Sum of the `_connects_used` field on your task cards. If that field is empty, estimated as **proposals sent × 6** |
| **Boosted Connects** | Extra connects you spent boosting bids | Sum of the **Boosted Connects** field on your task cards |
| **Bid out Boost** | Connects spent on boosted bids **that were tagged `bid out boost`** | Sum of Boosted Connects field **only for cards tagged `bid out boost`** |
| **Connects per Win** | Efficiency metric | Total Connects Used ÷ Total Wins |
| **Wasted Connects** | Connects spent on niches that produced zero wins | Sum of connects for any niche where wins = 0 |
| **Total Wins** | Jobs currently in the **Won** column | Count of `status = 'Won'` |

### 6.2 Important rules

- **You must fill in Boosted Connects** on the card for a boost to count. It is not detected automatically.
- **You must apply the `bid out boost` tag** on the card for it to count in **Bid out Boost**. Tag is case-insensitive but must be spelled exactly. Without the tag, a boosted connect counts in **Boosted Connects** but **not** in **Bid out Boost**.
- **Total Connects Used is an estimate** (proposals × 6) until `_connects_used` is populated for each task. This is why the number may look round.
- All numbers respect the **date range picker** at the top of the page.
- The page **auto-refreshes every 15 seconds**.

### 6.3 Breakdown by profile

Below the cards, you see each of your profiles with:
- Niche / stack
- Connects used
- Connects budget (150 per profile by default)
- Progress bar

---

## 7. Stats & Counts

This section explains every number you might see and why it shows what it shows.

### 7.1 Funnel / Pipeline KPIs (on My Dashboard)

| KPI | Counts |
|---|---|
| **Proposals Sent** | Jobs where `proposal_sent_at` is set (anything past Todo) |
| **Proposals Viewed** | Jobs that **ever** reached a "Proposal Viewed" / "Viewed" stage |
| **In Chat** | Jobs that **ever** reached the "In Chat" column |
| **Meetings Done** | Jobs that **ever** reached "Meeting Done" |
| **Wins** | Jobs currently in "Won" |
| **Losses** | Jobs currently in "Lost" |

> "Ever reached" means even a lost or won job still counts if it passed through that stage. Your funnel is additive.

### 7.2 Pipeline Now (active jobs only)

"Pipeline Now" groups your **active** cards into four buckets:

- **Todo**
- **In Progress** — Proposal Submitted, Prototype Required/Done/Submitted, In Chat, On Hold
- **Meetings** — Meeting Scheduled, Meeting Done
- **Negotiation**

**Excluded from Pipeline Now:** Won, Lost, N/A. These are not "active" jobs.

### 7.3 When data updates

| Place | Refresh |
|---|---|
| Task Board | Every **5 seconds** (smart polling) |
| Dashboard pages (Connects, My Dashboard, etc.) | Every **15 seconds** |
| KPIs after a card move | Instant — the move triggers a path revalidation |
| When your tab is hidden | **Paused** — resumes when you switch back |

### 7.4 Date range

The date picker at the top filters most stats by `created_at` / `posted_at`. Moving a card does not move a job outside the date range — a job stays in the range of when it first arrived.

---

## 8. Labels, Priorities, Filters & Views

### 8.1 Priorities

Four levels. Shown as a colored dot on the card:
- **Urgent** (red)
- **High** (orange)
- **Medium** (yellow)
- **Low** (blue)

Set priority in the card detail. Used for sorting and the "Priority" Group By option.

### 8.2 Tags (labels)

Tags are free-form and project-scoped. Auto-created tags on n8n cards:
- **Profile name** (e.g., `sana`, `craig`) — tells you which profile matched
- **`vollna-auto`** — means the card came from the automation, not manual creation

You can add your own tags inline in the card detail. Case-insensitive matching.

**Special tag: `bid out boost`** — apply this to a card whose boost should count toward the **Bid out Boost** stat on the Connects page.

### 8.3 Filters

On the board toolbar:

- **Group By:** Status (default) / Assignee / Priority / Label
- **Sort:** Position / Due Date / Priority / Created
- **More Filters:** filter by custom field values
- **Saved Views:** save the current filter+sort as a named view, reload later

Filters live in the URL — share a link and the recipient sees the same view.

---

## 9. Real-Time Updates & Refresh

The dashboard uses **smart polling**, not WebSockets. That means:

- Each page silently refreshes itself on a timer.
- When you switch to another tab or minimize the window, polling **pauses** (to save battery and bandwidth).
- When you come back, the next refresh fires immediately.

| Page | Interval |
|---|---|
| Task Board | 5 s |
| My Dashboard | 15 s |
| My Connects | 15 s |
| My Analytics | 15 s |
| My Performance | 15 s |

You can always force an instant refresh by reloading the browser tab (`Ctrl+R`).

---

## 10. Automation

Things that happen **without you clicking anything**:

| Trigger | What happens |
|---|---|
| n8n receives a new Upwork job for your profile | Card is created in **Todo**, fully populated, assigned to you, tagged with your profile + `vollna-auto`, with a 24-hour due date |
| Duplicate job (same profile + job ID) | System detects it and returns the existing card — no duplicate is created |
| You drag a card to a new column | `jobs.status` updates, milestones stamp (first-time only), KPIs recalculate, activity log entry is added |
| You drag a card to **Won** | `outcome = won`, `outcome_at = now`, wins counter bumps |
| You drag a card **out** of Won/Lost | Outcome is cleared — the job becomes active again |
| A client views your proposal | `proposal_viewed_at` gets set (currently detected via stage move; full Upwork integration pending) |
| Weekend or outside 16:10–02:00 PKT Mon–Fri | n8n **intentionally** drops jobs. You will see zero new cards during these hours — this is not a bug |

---

## 11. Common Misunderstandings

These are the questions agents ask most often. Read this section carefully — most "bugs" live here.

### 11.1 "Why didn't any cards come in this weekend?"

**By design.** The n8n workflow has an active-hours gate. New job cards only arrive:
- **Monday to Friday**
- **16:10 PKT to 02:00 PKT next day**

Saturdays and Sundays, and off-hours on weekdays, produce **zero cards**. This is a business rule, not a failure.

### 11.2 "There's no 'Proposal Views' column on my board, but the KPI shows a number. What?"

The 13 board columns do not include a literal "Proposal Views" column. The **Proposals Viewed** KPI tracks the first time each job hit a viewed stage historically. It's a metric, not a workflow step.

### 11.3 "I marked a bid as boosted, but Bid out Boost is still zero."

Two separate fields:
1. **Boosted Connects** (number on the card) → feeds the **Boosted Connects** card.
2. **`bid out boost`** tag (on the card) → required on top of the number for it to feed the **Bid out Boost** card.

If you only entered the number, it counts in Boosted Connects but **not** Bid out Boost. Add the tag to fix it.

### 11.4 "My Total Connects Used is a suspiciously round number."

It probably is. Until a task has the `_connects_used` field populated (coming from n8n), the system estimates it as `proposals × 6`. Once real data flows in, your number will become precise.

### 11.5 "I dragged a card to Won but my Wins counter didn't update."

Give it ~15 seconds for the dashboard poll, or reload the tab. The board itself updates in 5 seconds. If it still doesn't change, make sure the column you moved into is literally named **Won** (not a renamed custom column).

### 11.6 "I lost a job but moved it back to Negotiation by mistake. Did I break my stats?"

No. Moving out of Won or Lost clears the outcome and the job re-enters the active pipeline. You can move it back to Lost when ready. Reversals are fully supported.

### 11.7 "A card is missing from my board."

Possible reasons:
- It went to **N/A** (noise / filtered out) — check that column.
- A duplicate of a job you already had — the webhook deduped it. Check the existing card.
- Weekend / off-hours — n8n dropped it at the gate.
- It's on **another board** you haven't opened — agents currently only see their first assigned board.

### 11.8 "My sidebar looks different from another agent's."

All agents see the same 7 `/my-*` pages. If an agent sees admin pages (like `/tasks` without `/my-`), that user is an admin, not an agent.

### 11.9 "Why can I edit the proposal in the card?"

Because you should. The AI writes a first draft. Your job is to refine it before submitting on Upwork. Changes to the proposal field are saved automatically.

### 11.10 "The page doesn't refresh when I'm on another browser tab."

Correct — auto-refresh pauses when the tab is hidden. This is intentional (saves battery and DB load). Come back to the tab and the next poll fires instantly.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Agent** | You — a user with access to `/my-*` pages only |
| **Admin** | A superuser with access to all agents and the full `/dashboard` routes |
| **Profile** | An Upwork identity (e.g., a specific freelancer account). One agent can own several profiles |
| **Task / Card** | A row on the Task Board representing one Upwork job |
| **Job** | The underlying database record that a card is linked to. Cards and jobs are joined via the `_job_id` custom field |
| **Status** | The current column name of a task (= the job's status) |
| **Milestone** | A timestamp marking the first time a job hit a stage (In Chat, Meeting Done, etc.) |
| **Pipeline Now** | Count of currently active jobs grouped into Todo / In Progress / Meetings / Negotiation |
| **Connects** | Upwork's currency for sending proposals |
| **Boosted Connects** | Extra connects spent to boost a bid's visibility |
| **Bid out Boost** | A tagged subset of boosted connects, used for reporting |
| **n8n** | The automation tool that feeds new jobs into your board |
| **Vollna** | The Upwork scraper that feeds n8n |
| **Auto-refresh** | Smart polling that silently updates the page on a timer |

---

## Maintaining This Guide

This guide is organized by **feature**, not by chronology, so that:

- **New features** → add a new numbered section and a Table of Contents entry.
- **Changes to an existing feature** → update only that feature's section. Don't scatter edits across the doc.
- **Deprecated features** → remove the section entirely. Don't leave ghost references.
- **New board columns** → update §3.1 and §5.
- **New KPIs** → update §7.
- **New stat on the Connects page** → update §6.1.
- **New common question from support** → add to §11 (Common Misunderstandings). This section should grow over time as users discover corners.

Keep language plain. No code, no SQL, no file paths in agent-facing sections. Developers have `CLAUDE.md` for that.
