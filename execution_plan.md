# Vollna Analytics Dashboard — Execution Plan

**Version:** 1.0
**Created:** 2026-02-26
**Source of Truth:** `DASHBOARD_DEV.md`
**Current State:** E-commerce scaffold on Next.js 16 + Vercel. ~5% aligned with spec.

---

## STATUS KEY

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked (see notes)
- `[—]` Deferred to later phase

---

## PHASE 0 — INFRASTRUCTURE & FOUNDATION CLEANUP

> **Goal:** Strip the e-commerce scaffold, set up the correct database, environment, and project skeleton so every subsequent phase builds on solid ground.

### 0.1 — Database Setup (Supabase)

- [ ] Create Supabase project (or confirm existing Neon Postgres from Vercel integration)
- [ ] Decide ORM strategy: **Prisma** (spec recommendation) vs raw SQL via `@vercel/postgres` (currently installed)
  - _Edge case: Vercel already provisioned a Neon Postgres DB with env vars (`POSTGRES_URL`, `DATABASE_URL`, etc.). We may keep `@vercel/postgres` and skip Supabase entirely if Neon meets all requirements (no real-time subscriptions needed in Phase 1)._
- [ ] Confirm database connection works from local dev (`npm run dev`)
- [ ] Confirm database connection works from Vercel deployment

### 0.2 — Schema Migration (E-Commerce → Vollna)

- [ ] Drop existing e-commerce tables (`categories`, `products`, `regions`, `customers`, `sales`)
- [ ] Create `agents` table per spec (Section 4)
- [ ] Create `profiles` table per spec (Section 4)
- [ ] Create `jobs` table per spec (Section 4)
- [ ] Create `sync_log` table per spec (Section 4)
- [ ] Create `stats_cache` table per spec (Section 4)
- [ ] Create all indexes per spec (Section 4)
  - `idx_jobs_profile_id`, `idx_jobs_agent_id`, `idx_jobs_received_at`, `idx_jobs_clickup_status`, `idx_jobs_outcome`, `idx_jobs_job_id`
- [ ] Create `agent_stats` view per spec (Section 4)
- [ ] Create `profile_stats` view per spec (Section 4)
- [ ] Replace `src/lib/schema.sql` with new schema
- [ ] Update `src/app/seed/route.ts` to use new schema (or remove)

### 0.3 — Remove E-Commerce Code

- [ ] Delete `src/lib/seed.ts` (e-commerce seeder)
- [ ] Rewrite `src/lib/types.ts` — replace all e-commerce types with Vollna domain types:
  - `Job`, `Agent`, `Profile`, `SyncLog`, `StatsCache`
  - `KPIMetrics` (new: totalJobs, proposalsSent, won, lost, winRate, totalRevenue)
  - `AgentStats`, `ProfileStats`
  - `ActivityEvent`
  - `DateRange` (keep as-is)
- [ ] Rewrite `src/lib/data.ts` — replace all e-commerce queries with Vollna queries (detailed in Phase 2)
- [ ] Keep `src/lib/utils.ts` — already generic and reusable
- [ ] Keep `src/lib/chart-colors.ts` — reusable

### 0.4 — Environment Variables

- [ ] Audit current Vercel env vars (Neon Postgres vars already present)
- [ ] Add missing env vars to Vercel:
  - `CLICKUP_API_KEY`
  - `CLICKUP_TEAM_ID`
  - `GOOGLE_SHEETS_CLIENT_EMAIL`
  - `GOOGLE_SHEETS_PRIVATE_KEY`
  - `GOOGLE_SHEET_ID`
  - `N8N_WEBHOOK_SECRET`
  - `CLICKUP_WEBHOOK_SECRET`
  - `CRON_SECRET`
  - `NEXTAUTH_SECRET` (Phase 2+)
- [ ] Create `.env.example` with all required keys (no values)
- [ ] Pull env vars locally: `vercel env pull`

### 0.5 — Project Configuration

- [ ] Update `vercel.json` — add cron schedule:
  ```json
  {
    "framework": "nextjs",
    "crons": [
      { "path": "/api/sync/clickup", "schedule": "*/15 * * * *" }
    ]
  }
  ```
- [ ] Update root `layout.tsx` metadata: title → "Vollna Analytics Dashboard"
- [ ] Update `README.md` with actual project description

### 0.6 — Install Missing Dependencies

- [ ] Evaluate if `@supabase/supabase-js` is needed (only if switching from Vercel Postgres)
- [ ] Add `prisma` + `@prisma/client` if using Prisma ORM
- [ ] Add `googleapis` for Google Sheets integration
- [ ] Add `date-fns` or similar for date manipulation (or use native)
- [ ] Add any missing shadcn components as needed (tabs, dialog, dropdown-menu, input, textarea, skeleton, tooltip, avatar, sheet)

---

## PHASE 1 — CORE DATA LAYER & LAYOUT SHELL

> **Goal:** Build the data access layer, navigation layout, and the main dashboard page with real KPIs from the database. This is the minimum viable dashboard.

### 1.1 — Database Client Setup

- [ ] Create `src/lib/db.ts` — centralized database client
  - Export query helper that wraps `@vercel/postgres` `sql` (or Supabase client)
  - Handle connection pooling edge cases (serverless cold starts)
  - _Edge case: Vercel Postgres `sql` doesn't support `.from()` Supabase-style. All queries must use raw SQL template strings._
- [ ] Create `src/lib/clickup.ts` — ClickUp API client
  - `fetchClickUpTask(taskId)` — GET single task
  - `fetchClickUpTasks(listId, statuses?)` — GET tasks from a list
  - `mapStatusToOutcome(clickupStatus)` — 'Won' → 'won', 'Lost' → 'lost', etc.
  - Handle rate limiting (100 requests/min for ClickUp API)
  - _Edge case: ClickUp API returns paginated results. Must handle pagination for lists with >100 tasks._
- [ ] Create `src/lib/sheets.ts` — Google Sheets client
  - `readJobLog()` — Read all rows from `job_log` tab
  - Map sheet columns to `jobs` table fields
  - Handle auth via service account credentials
  - _Edge case: Google Sheets API has a 500-row read limit per request. Must paginate for large sheets._
  - _Edge case: Private key in env var needs `\n` replaced with actual newlines._
- [ ] Create `src/lib/stats.ts` — Aggregation helpers
  - `computeWinRate(jobs)` — won / (won + lost) * 100
  - `computeResponseTime(job)` — proposal_sent_at - received_at in hours
  - `computeRevenue(jobs)` — sum of won_value
  - _Edge case: Division by zero when no outcomes exist yet._

### 1.2 — Vollna Data Queries (`src/lib/data.ts` Rewrite)

- [ ] `getKPIMetrics(range?: DateRange)` → `KPIMetrics`
  - Total jobs received in range
  - Proposals sent (where `proposal_sent_at IS NOT NULL`)
  - Won count, lost count
  - Win rate % (won / (won + lost))
  - Total revenue (sum of `won_value` where outcome = 'won')
  - _Edge case: Empty database returns nulls — must default to 0._
- [ ] `getJobVolumeOverTime(range?: DateRange)` → `{ date, count }[]`
  - Jobs received per day, grouped by `received_at::date`
- [ ] `getStatusFunnel(range?: DateRange)` → `{ status, count }[]`
  - Count per `clickup_status`: Received → Proposal Ready → Sent → Following Up → Won
  - _Edge case: Status names must match ClickUp exactly. Unknown statuses should map to 'Other'._
- [ ] `getAgentStats(range?: DateRange)` → `AgentStats[]`
  - Query `agent_stats` view or compute inline
  - Include: name, totalJobs, proposalsSent, won, lost, winRate, totalRevenue, avgResponseHours
- [ ] `getProfileStats(range?: DateRange)` → `ProfileStats[]`
  - Query `profile_stats` view or compute inline
- [ ] `getRecentActivity(limit?: number)` → `ActivityEvent[]`
  - Last N jobs with status changes, ordered by `updated_at DESC`
  - Include: job title, agent name, old status → new status, timestamp
- [ ] `getTopAgentsByWinRate(limit?: number)` → Top N agents
- [ ] `getTopProfilesByVolume(limit?: number)` → Top N profiles
- [ ] `getSystemHealth()` → `{ lastSyncAt, gptFailureRate, openJobsCount }`
  - Last sync from `sync_log`
  - GPT failure rate: jobs where `proposal_text IS NULL AND received_at < NOW() - 1h`
  - _Edge case: No sync_log entries yet — return "Never synced"._
- [ ] `getJobs(filters)` → Paginated, filtered job list
  - Filters: agent_id, profile_id, status, outcome, date range, budget_type, search (title)
  - Pagination: offset + limit
  - Sorting: by date, budget, status
  - _Edge case: SQL injection risk with dynamic filters — must use parameterized queries._
- [ ] `getJobById(id)` → Single job with full details
- [ ] `getAgentById(id)` → Agent with stats
- [ ] `getProfileById(id)` → Profile with stats

### 1.3 — Layout Shell with Sidebar Navigation

- [ ] Create `src/components/layout/sidebar.tsx`
  - Navigation links: Dashboard, Agents, Profiles, Jobs, Settings
  - Icons from `lucide-react`: LayoutDashboard, Users, Briefcase, FileText, Settings
  - Active state highlighting based on current route
  - Collapsible on mobile (hamburger menu)
  - _Edge case: Mobile viewport — sidebar should become a slide-out sheet._
- [ ] Create `src/components/layout/header.tsx`
  - Page title (dynamic based on route)
  - Date range picker (reuse existing component)
  - System health indicator (green/yellow/red dot)
  - _Edge case: Header should show last sync time. If > 30 min ago, show yellow warning._
- [ ] Update `src/app/layout.tsx`
  - Wrap children with Sidebar + Header layout
  - Add sidebar to all pages (except potential login page)
- [ ] Create `src/app/(dashboard)/layout.tsx` — route group for authenticated dashboard pages
  - Sidebar + Header wrapper
  - Loading fallback

### 1.4 — Dashboard Overview Page (`/dashboard`)

- [ ] Create `src/app/(dashboard)/dashboard/page.tsx`
  - Server component fetching all overview data
  - Date range from search params (default: 30 days)
- [ ] Update root `page.tsx` to redirect to `/dashboard`
- [ ] KPI Row (top of page):
  - [ ] Total Jobs Received (period)
  - [ ] Proposals Sent
  - [ ] Won
  - [ ] Win Rate %
  - [ ] Total Revenue
  - _Reuse `kpi-cards.tsx` component but rewire props_
- [ ] Volume Chart — Jobs received per day (bar chart, last 30 days)
  - [ ] Create `src/components/charts/volume-chart.tsx`
- [ ] Status Funnel — Received → Sent → Following Up → Won
  - [ ] Create `src/components/charts/status-funnel.tsx`
  - _Edge case: Some funnel stages may have 0 jobs — chart should still render proportionally._
- [ ] Top 3 Agents by Win Rate
  - [ ] Create `src/components/top-agents.tsx` — mini leaderboard cards
- [ ] Top 3 Profiles by Volume
  - [ ] Create `src/components/top-profiles.tsx` — mini leaderboard cards
- [ ] Recent Activity Feed (last 10 events)
  - [ ] Create `src/components/activity-feed.tsx`
  - Show: "Agent X sent proposal for [Job Title]", "Job [Title] marked as Won", etc.
  - Relative timestamps ("2h ago", "Yesterday")
- [ ] System Health Widget
  - [ ] Last sync time
  - [ ] GPT failure rate (% of jobs with no proposal)
  - [ ] Open/pending jobs count
  - _Edge case: If no sync has ever run, show setup prompt instead._
- [ ] Implement loading.tsx skeleton for `/dashboard`

---

## PHASE 2 — ENTITY PAGES (Agents, Profiles, Jobs)

> **Goal:** Build the drill-down pages for each major entity, with filtering, sorting, and detail views.

### 2.1 — Agents Page (`/agents`)

- [ ] Create `src/app/(dashboard)/agents/page.tsx`
  - Server component, fetches `getAgentStats()`
- [ ] Create `src/components/agent-card.tsx`
  - Name, avatar (or initials fallback), profile assignments
  - Stats row: Jobs | Sent | Won | Win Rate | Avg Response Time | Revenue
  - Sparkline: win rate over last 12 weeks
  - Active tasks count badge
  - _Edge case: Agent with 0 jobs — show "No activity yet" state._
  - _Edge case: Avatar URL may be null — use initials fallback._
- [ ] Agent list with grid/table toggle
- [ ] Sort by: win rate, volume, revenue, response time
- [ ] Filter by: active/inactive
- [ ] Loading skeleton

### 2.2 — Agent Detail Page (`/agents/[id]`)

- [ ] Create `src/app/(dashboard)/agents/[id]/page.tsx`
  - Fetch agent details + their jobs
- [ ] Agent header: avatar, name, email, active status
- [ ] KPI row: their personal stats
- [ ] Win rate trend chart (12 weeks, line chart)
  - [ ] Create `src/components/charts/win-rate-chart.tsx`
- [ ] Job volume per week (bar chart)
- [ ] Recent jobs table (their jobs only)
- [ ] Profile assignments list
- [ ] Response time distribution
- [ ] _Edge case: Agent ID not found → 404 page._
- [ ] _Edge case: Agent with no jobs → show empty state, not broken charts._

### 2.3 — Profiles Page (`/profiles`)

- [ ] Create `src/app/(dashboard)/profiles/page.tsx`
  - Fetch `getProfileStats()`
- [ ] Create `src/components/profile-card.tsx`
  - Profile name, stack/tech focus, assigned agent
  - Stats: Total Jobs | Win Rate | Avg Won Value | Total Revenue
  - Mini volume chart (daily for last 30 days)
  - Top skills in won jobs
  - _Edge case: Profile with no agent assigned — show "Unassigned" warning._
- [ ] Profile list with sort/filter
- [ ] Sort by: volume, win rate, revenue
- [ ] Filter by: stack, active/inactive, agent
- [ ] Loading skeleton

### 2.4 — Profile Detail Page (`/profiles/[id]`)

- [ ] Create `src/app/(dashboard)/profiles/[id]/page.tsx`
- [ ] Profile header: name, stack, Vollna filter tag, assigned agent
- [ ] KPI row: profile-specific metrics
- [ ] Win rate trend (line chart)
- [ ] Job volume over time (bar chart)
- [ ] Top skills analysis — which skills appear in won vs lost jobs
  - _Edge case: `skills` is a TEXT[] array. Must parse and aggregate across jobs._
- [ ] Budget analysis — avg budget of won vs lost jobs
- [ ] Recent jobs table (this profile only)
- [ ] _Edge case: Profile ID not found → 404._

### 2.5 — Jobs Page (`/jobs`)

- [ ] Create `src/app/(dashboard)/jobs/page.tsx`
  - Server component with search params for filters
- [ ] Create `src/components/job-table.tsx` — Full filterable table
  - Columns: Title | Profile | Agent | Budget | Status | Received | Sent | Outcome
  - Clickable rows → expand or navigate to detail
  - _Edge case: Very long job titles — truncate with tooltip._
- [ ] Filter bar:
  - [ ] Agent dropdown (multi-select)
  - [ ] Profile dropdown (multi-select)
  - [ ] Status dropdown (Proposal Ready, Sent, Following Up, Won, Lost)
  - [ ] Outcome dropdown (won, lost, pending, skipped)
  - [ ] Budget type toggle (fixed / hourly / all)
  - [ ] Date range picker
  - [ ] Search input (job title text search)
  - _Edge case: Applying many filters simultaneously — ensure no SQL performance issues. Use indexes._
- [ ] Pagination (25 per page)
- [ ] Sort by any column (click header to toggle ASC/DESC)
- [ ] Job detail expansion / modal:
  - Full proposal text
  - ClickUp link (external)
  - Client details (country, rating, total spent, hires)
  - Skills list
  - Full timeline (received → sent → outcome)
- [ ] Export to CSV
  - [ ] Create `src/app/api/jobs/export/route.ts`
  - Generate CSV from filtered query
  - Return as downloadable file
  - _Edge case: Large export (1000+ rows) — stream response, don't buffer in memory._
- [ ] Loading skeleton

### 2.6 — Pipeline / Kanban View (Alternate Jobs View)

- [ ] Create `src/components/pipeline-board.tsx`
  - Kanban columns: Proposal Ready → Sent → Following Up → Won / Lost
  - Cards show: job title, profile, agent, budget, time in stage
  - _Optional: drag-and-drop to update status (writes to DB + ClickUp)_
  - _Edge case: Jobs without a clickup_status — place in "Untracked" column._
- [ ] Toggle between table view and pipeline view
- [ ] Cards count badge per column

---

## PHASE 3 — API ROUTES & DATA SYNC

> **Goal:** Build all webhook endpoints and sync mechanisms so data flows from ClickUp, n8n, and Google Sheets into the database.

### 3.1 — n8n Webhook (`/api/webhook/n8n`)

- [ ] Create `src/app/api/webhook/n8n/route.ts`
- [ ] POST handler:
  - [ ] Read raw body for HMAC verification
  - [ ] Verify `x-n8n-signature` header against `N8N_WEBHOOK_SECRET`
    - HMAC-SHA256 of request body
    - Return 401 if invalid
    - _Edge case: Missing signature header — reject, don't crash._
  - [ ] Parse JSON body
  - [ ] Resolve `agent_id` from `agent_clickup_id` (lookup agents table)
    - _Edge case: Unknown agent — create a new agent record or reject? (Decision needed)_
  - [ ] Upsert into `jobs` table (ON CONFLICT `job_id`)
    - Map all fields from webhook payload to jobs columns
    - Set `clickup_status` to 'Proposal Ready'
    - Set `received_at` to NOW()
  - [ ] Return `{ ok: true }` with 200
  - [ ] Return appropriate error codes: 400 (bad payload), 401 (bad sig), 500 (db error)
- [ ] Add rate limiting (optional: 100 req/min)
- [ ] Log to `sync_log` table

### 3.2 — ClickUp Status Sync (`/api/sync/clickup`)

- [ ] Create `src/app/api/sync/clickup/route.ts`
- [ ] GET handler (called by Vercel Cron every 15 min):
  - [ ] Verify `Authorization: Bearer {CRON_SECRET}` header
    - _Edge case: Vercel Cron sends its own auth header. Must match `CRON_SECRET` env var._
  - [ ] Query all jobs where `outcome IS NULL AND clickup_task_id IS NOT NULL`
  - [ ] For each job, call ClickUp API: `GET /api/v2/task/{clickup_task_id}`
    - _Edge case: ClickUp rate limit (100/min). If >100 open jobs, batch with delays._
    - _Edge case: Task deleted in ClickUp — handle 404 gracefully, mark job as 'skipped'._
  - [ ] Map ClickUp status to outcome:
    - 'Won' / 'Hired' → `outcome: 'won'`
    - 'Lost' / 'Rejected' → `outcome: 'lost'`
    - 'Sent' / 'Applied' → update `clickup_status`, keep `outcome: null`
    - _Edge case: Custom ClickUp statuses — need a configurable mapping, not hardcoded._
  - [ ] Update `jobs` table: `clickup_status`, `outcome`, `outcome_at`
  - [ ] If outcome = 'won', attempt to read `won_value` from ClickUp custom field
    - _Edge case: Custom field may not exist or be empty — default to NULL._
  - [ ] Create `sync_log` entry: source='clickup', records_synced, records_updated, status
  - [ ] Return `{ updated: N, errors: [...] }`
- [ ] Handle partial failures (some tasks succeed, some fail)

### 3.3 — ClickUp Webhook (`/api/webhook/clickup`) — Real-Time

- [ ] Create `src/app/api/webhook/clickup/route.ts`
- [ ] POST handler:
  - [ ] Verify ClickUp webhook signature
  - [ ] Parse `taskStatusUpdated` event payload
  - [ ] Extract task_id, new status
  - [ ] Find job by `clickup_task_id`
    - _Edge case: Task not in our DB (manually created in ClickUp) — ignore._
  - [ ] Update job status and outcome
  - [ ] Return 200
- [ ] Register webhook with ClickUp API:
  ```
  POST /api/v2/team/{team_id}/webhook
  { "endpoint": "https://dashboard.vercel.app/api/webhook/clickup",
    "events": ["taskStatusUpdated"] }
  ```
- [ ] _Edge case: ClickUp sends a verification request on registration — must respond correctly._

### 3.4 — Google Sheets Import (`/api/sync/sheets`)

- [ ] Create `src/app/api/sync/sheets/route.ts`
- [ ] POST handler (manual trigger from Settings page):
  - [ ] Authenticate with Google Sheets API via service account
  - [ ] Read all rows from `job_log` tab of configured spreadsheet
  - [ ] For each row:
    - Map columns to `jobs` table fields
    - Resolve `profile_id` and `agent_id` from names/IDs
    - Upsert into `jobs` (ON CONFLICT `job_id`)
    - _Edge case: Sheet column order may change — map by header name, not position._
    - _Edge case: Duplicate rows in sheet — upsert handles this via `job_id`._
    - _Edge case: Missing required fields — skip row, log error._
  - [ ] Create `sync_log` entry
  - [ ] Return `{ imported: N, skipped: N, errors: [...] }`
- [ ] Support incremental sync (only rows after last sync timestamp)
  - _Edge case: Sheet rows have no guaranteed ordering — use a "processed" marker or last row index._

### 3.5 — Stats API Routes

- [ ] Create `src/app/api/stats/overview/route.ts`
  - Calls `getKPIMetrics()`, `getAgentStats()`, `getProfileStats()`
  - Accepts `?days=30` query param
  - Returns combined JSON
- [ ] Create `src/app/api/stats/agents/route.ts`
  - Returns agent leaderboard data
  - Accepts `?days=30` and `?agent_id=` params
- [ ] Create `src/app/api/stats/profiles/route.ts`
  - Returns profile performance data
  - Accepts `?days=30` and `?profile_id=` params

### 3.6 — Stats Cache Layer

- [ ] Implement `stats_cache` read/write in `src/lib/data.ts`
  - Before running expensive aggregation, check `stats_cache` for fresh data
  - If `expires_at > NOW()`, return cached JSONB
  - Otherwise, compute, write to cache, return
  - Cache TTL: 15 minutes (matches cron interval)
  - _Edge case: Race condition — two requests compute simultaneously. Use upsert._
- [ ] Cron job should also refresh `stats_cache` after syncing ClickUp

---

## PHASE 4 — SETTINGS & ADMIN TOOLS

> **Goal:** Build the settings page for manual sync triggers, sync history, system configuration, and health monitoring.

### 4.1 — Settings Page (`/settings`)

- [ ] Create `src/app/(dashboard)/settings/page.tsx`
- [ ] Manual Sync Section:
  - [ ] "Sync ClickUp Statuses" button — calls `/api/sync/clickup`
  - [ ] "Import from Google Sheets" button — calls `/api/sync/sheets`
  - [ ] Show spinner during sync, result toast on completion
  - [ ] Display last sync result (records synced, errors)
  - _Edge case: User clicks sync button multiple times — debounce, show "already syncing"._
- [ ] Sync Log Section:
  - [ ] Table of last 20 sync runs from `sync_log`
  - [ ] Columns: Source | Records Synced | Records Updated | Errors | Started | Duration | Status
  - [ ] Status badges: green (success), red (failed), yellow (running)
  - _Edge case: Sync log entry with status='running' for >30 min — mark as stale/failed._
- [ ] Agent Management:
  - [ ] List all agents (name, ClickUp ID, email, active status)
  - [ ] Toggle active/inactive
  - [ ] Add new agent form (name, ClickUp user ID, email)
  - _Edge case: Deactivating an agent with open jobs — show warning._
- [ ] Profile Management:
  - [ ] List all profiles (name, stack, assigned agent, active)
  - [ ] Toggle active/inactive
  - [ ] Edit assignment (change assigned agent)
  - [ ] Add new profile form
  - _Edge case: Changing agent assignment — historical jobs keep old agent, only new jobs use new assignment._

### 4.2 — Alert Thresholds (Settings Sub-Section)

- [ ] Configurable thresholds stored in `stats_cache` or a `settings` table:
  - Win rate alert: notify if drops below X% (default: 20%)
  - Response time alert: notify if avg exceeds Y hours (default: 4h)
  - GPT failure rate alert: notify if exceeds Z% (default: 10%)
  - No-activity alert: notify if no new jobs in N hours (default: 24h)
- [ ] Display current values and allow editing
- [ ] _Phase 2 feature: Actually send alerts via Slack/email. For now, just show warnings on dashboard._

### 4.3 — Seed Data for Development

- [ ] Create `src/lib/seed-vollna.ts` — seed realistic test data
  - 3-4 agents with names
  - 5-6 profiles with different stacks
  - 100-200 sample jobs across different statuses and outcomes
  - Realistic date distribution (last 90 days)
  - Mix of won/lost/pending outcomes
  - Various budget ranges
  - _Purpose: Allow development and testing without real data._
- [ ] Create `src/app/api/seed/route.ts` — trigger seeding (dev only)
  - Guard with `NODE_ENV !== 'production'` check

---

## PHASE 5 — CHARTS & ADVANCED VISUALIZATIONS

> **Goal:** Build all the domain-specific charts and data visualizations referenced in the spec.

### 5.1 — Dashboard Charts

- [ ] `volume-chart.tsx` — Jobs received per day (bar chart, recharts)
  - X-axis: dates, Y-axis: count
  - Hover tooltip: date + exact count
  - Color-coded by outcome if stacked
- [ ] `status-funnel.tsx` — Funnel from Received → Won
  - Either horizontal funnel or stacked bar
  - Show conversion rate between each stage
  - _Edge case: Non-linear funnel (jobs can skip stages) — show actual counts, not strict conversion._
- [ ] `revenue-chart.tsx` — Revenue over time (area chart)
  - Cumulative won_value by week/month
  - Separate lines for fixed vs hourly contracts

### 5.2 — Agent Charts

- [ ] `win-rate-chart.tsx` — Win rate trend over 12 weeks (line chart / sparkline)
  - Per-agent or global
  - Show trend direction (up/down arrow)
- [ ] Response time distribution (histogram)
- [ ] Agent comparison radar chart (optional, Phase 2)

### 5.3 — Profile Charts

- [ ] Profile volume mini-chart (bar, last 30 days)
- [ ] Budget distribution chart — histogram of budget ranges for won jobs
- [ ] Skills word cloud or bar chart — most common skills in won jobs per profile
  - _Edge case: `skills` is TEXT[]. Must flatten across all jobs, count occurrences._

### 5.4 — Revenue Charts

- [ ] Total revenue tracker (gauge or big number with trend)
- [ ] Revenue by profile (horizontal bar)
- [ ] Revenue by agent (horizontal bar)
- [ ] Fixed vs hourly revenue split (donut)

---

## PHASE 6 — POLISH, UX, & PRODUCTION READINESS

> **Goal:** Final polish — responsive design, error handling, empty states, loading states, dark mode, and deployment hardening.

### 6.1 — Responsive Design

- [ ] Sidebar collapses to hamburger on mobile (< 768px)
- [ ] KPI cards stack vertically on mobile
- [ ] Charts resize properly (recharts `ResponsiveContainer`)
- [ ] Tables scroll horizontally on mobile
- [ ] Job detail modal / sheet instead of page on mobile
- [ ] Test on: iPhone SE, iPhone 14, iPad, 1080p desktop, 1440p desktop

### 6.2 — Empty States

- [ ] Dashboard with no data → "Welcome! Import your first data from Settings"
- [ ] Agent with no jobs → "No jobs assigned yet"
- [ ] Profile with no jobs → "No jobs received for this profile"
- [ ] Job table with no results → "No jobs match your filters"
- [ ] Sync log empty → "No syncs have run yet. Trigger one from Settings."

### 6.3 — Error Handling

- [ ] API routes: consistent error response format `{ error: string, code: number }`
- [ ] Client-side: error boundaries for chart/component failures
- [ ] Database connection failures: retry logic with exponential backoff
- [ ] ClickUp API failures: graceful degradation (show stale data with warning)
- [ ] Google Sheets API failures: clear error message ("Check credentials")
- [ ] Webhook failures: log to `sync_log` with error details

### 6.4 — Loading States

- [ ] Update `src/app/loading.tsx` for new dashboard layout
- [ ] Per-page loading skeletons matching actual content shape
- [ ] Inline loading spinners for sync buttons
- [ ] Chart loading placeholders (shimmer effect)
- [ ] Table row loading skeletons

### 6.5 — Dark Mode

- [ ] Already supported via CSS variables in `globals.css`
- [ ] Verify all custom components respect `dark:` variants
- [ ] Charts: verify recharts colors work in dark mode
- [ ] Add theme toggle to header (optional — currently follows system preference)

### 6.6 — Performance

- [ ] `revalidate` settings on each page (ISR):
  - Dashboard: 300s (5 min)
  - Agents/Profiles list: 300s
  - Agent/Profile detail: 60s
  - Jobs page: 0 (always fresh, filtered)
- [ ] `stats_cache` prevents redundant DB queries
- [ ] Database indexes are in place (Phase 0)
- [ ] Lazy load charts (dynamic import with `next/dynamic`)
- [ ] _Edge case: Large job tables (10k+ rows) — pagination is mandatory, never SELECT *._

### 6.7 — Security Hardening

- [ ] All webhook endpoints verify signatures (HMAC)
- [ ] Cron endpoint verifies `CRON_SECRET`
- [ ] No sensitive data in client components (service keys, DB credentials)
- [ ] Rate limiting on webhook endpoints (consider `@upstash/ratelimit` or simple in-memory)
- [ ] Input sanitization on all API routes
- [ ] SQL injection prevention (parameterized queries only)
- [ ] CORS headers on API routes (restrict to same-origin)
- [ ] `x-n8n-signature` and `x-clickup-signature` validation
- [ ] _Edge case: Replay attacks on webhooks — consider adding timestamp validation (reject if >5 min old)._

---

## PHASE 7 — AUTHENTICATION (Post-MVP)

> **Goal:** Add user authentication so the dashboard isn't publicly accessible, and agents can see their own stats.

### 7.1 — Auth Setup

- [ ] Choose auth provider: Supabase Auth vs NextAuth.js vs Clerk
  - _Spec recommends Supabase Auth (email+password). If staying on Neon Postgres, consider NextAuth or Clerk._
- [ ] Install auth dependencies
- [ ] Create auth middleware (`middleware.ts`)
  - Protect all `/dashboard`, `/agents`, `/profiles`, `/jobs`, `/settings` routes
  - Redirect unauthenticated users to `/login`
  - Protect API routes (webhook routes exempt — they have their own auth)

### 7.2 — Login Page

- [ ] Create `src/app/login/page.tsx`
  - Email + password form
  - Error handling (wrong credentials)
  - Redirect to `/dashboard` on success

### 7.3 — Role-Based Access

- [ ] Admin role: full access to everything
- [ ] Agent role: can only see their own stats, jobs, and assigned profiles
  - Filter all queries by `agent_id` matching logged-in user
  - Hide Settings page
  - _Edge case: Agent tries to access another agent's page via URL → 403._

### 7.4 — Deployment Protection

- [ ] Remove Vercel's automatic deployment protection (currently causing auth wall)
  - OR configure bypass for webhook endpoints
- [ ] Use application-level auth instead

---

## PHASE 8 — ADVANCED FEATURES (Phase 2 from Spec)

> **Goal:** Build the features listed in DASHBOARD_DEV.md Section 12 — these are post-launch enhancements.

### 8.1 — Notifications & Alerts

- [ ] Slack integration: send alerts when thresholds are breached
  - Win rate drops below configured threshold
  - GPT failure rate spikes
  - No new jobs in 24h
- [ ] Email alerts (weekly digest to admin)
  - Summary: jobs received, proposals sent, win rate, revenue
  - Comparison vs previous week

### 8.2 — Proposal Intelligence

- [ ] A/B testing: track which GPT instructions lead to better win rates
  - Store `gpt_model` and instruction version per job
  - Compare win rates across instruction versions
- [ ] Proposal quality scoring (future: AI-based)

### 8.3 — Advanced Analytics

- [ ] Budget intelligence: which budget ranges yield best win rates per profile
  - Histogram: budget range vs win rate
  - Recommendation: "Profile X wins most often in $500-$1000 range"
- [ ] Client country heatmap
  - World map visualization
  - Color intensity = job volume or win rate
  - _Dependency: need a map library (react-simple-maps or similar)._
- [ ] Best time to apply analysis
  - Jobs posted at X hour/day of week → Y win rate
  - Heatmap: day × hour with win rate color
- [ ] Auto-update `won_value` from ClickUp custom field
  - When agent enters contract value in ClickUp, sync to DB

### 8.4 — Agent Portal

- [ ] Agent-specific login and dashboard view
- [ ] Personal task queue (their assigned jobs, ordered by priority)
- [ ] Ability to mark proposals as sent (updates ClickUp via API)
- [ ] Personal performance trends

---

## DEPENDENCY GRAPH

```
Phase 0 (Infrastructure)
  └── Phase 1 (Data Layer + Layout + Dashboard)
        ├── Phase 2 (Entity Pages: Agents, Profiles, Jobs)
        │     └── Phase 5 (Advanced Charts)
        ├── Phase 3 (API Routes + Data Sync)
        │     └── Phase 4 (Settings & Admin)
        └── Phase 6 (Polish & Production Readiness)
              └── Phase 7 (Authentication)
                    └── Phase 8 (Advanced Features)
```

**Critical Path:** Phase 0 → Phase 1 → Phase 3 → Phase 6 (minimum viable product)

**Parallel Work Possible:**
- Phase 2 and Phase 3 can be built in parallel after Phase 1
- Phase 5 can be built in parallel with Phase 4
- Phase 6 should be ongoing throughout all phases

---

## DECISION LOG

| # | Decision Needed | Options | Impact | Status |
|---|----------------|---------|--------|--------|
| 1 | Database: Keep Vercel/Neon Postgres or switch to Supabase? | A) Keep Neon (already provisioned, env vars set) B) Switch to Supabase (spec says so, has realtime + auth) | High — affects every query and Phase 7 auth | OPEN |
| 2 | ORM: Prisma or raw SQL? | A) Prisma (type-safe, migrations) B) Raw SQL via `@vercel/postgres` (simpler, already working) | Medium — affects DX and migration strategy | OPEN |
| 3 | Auth: Supabase Auth, NextAuth, or Clerk? | A) Supabase Auth (free, spec recommendation) B) NextAuth (flexible, works with any DB) C) Clerk (easiest, paid) | Medium — Phase 7 only | DEFERRED |
| 4 | Unknown agent in n8n webhook: create or reject? | A) Auto-create agent record B) Reject with error | Low — affects data integrity | OPEN |
| 5 | ClickUp status mapping: hardcoded or configurable? | A) Hardcoded map in code B) Configurable via Settings page | Low — affects flexibility | OPEN |
| 6 | Deployment protection: remove or bypass? | A) Disable Vercel deployment protection B) Add bypass tokens for webhooks | Medium — affects webhook reachability | OPEN |

---

## ESTIMATED SCOPE PER PHASE

| Phase | Files to Create/Modify | Complexity | Builds On |
|-------|----------------------|------------|-----------|
| **Phase 0** | ~8 files | Low | Nothing |
| **Phase 1** | ~15 files | High | Phase 0 |
| **Phase 2** | ~20 files | High | Phase 1 |
| **Phase 3** | ~10 files | High | Phase 0 + 1 |
| **Phase 4** | ~8 files | Medium | Phase 1 + 3 |
| **Phase 5** | ~10 files | Medium | Phase 1 + 2 |
| **Phase 6** | ~15 files (modifications) | Medium | All prior |
| **Phase 7** | ~6 files | Medium | Phase 6 |
| **Phase 8** | ~15 files | High | Phase 7 |

---

## NOTES

1. **The current codebase is an e-commerce template.** Every data query, type definition, chart, and page needs to be rebuilt. The UI primitives (shadcn components, Tailwind theme, chart library) are reusable.

2. **Vercel already provisioned a Neon Postgres database** with 16 env vars. Decision #1 (Neon vs Supabase) should be made before Phase 0 begins — it affects everything.

3. **The spec references Prisma but the current code uses raw SQL.** Decision #2 should also be made upfront.

4. **Phase 1 is the critical milestone.** Once the data layer, layout, and dashboard overview work with real data, all other phases are incremental additions.

5. **Webhooks (Phase 3) are essential for live data.** Without them, the dashboard is read-only from manually imported data. Prioritize n8n webhook and ClickUp sync.
