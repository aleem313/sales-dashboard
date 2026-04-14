# Vollna Analytics Dashboard — Claude Skill

## WHEN TO USE THIS SKILL
Use this skill for any task involving the Vollna Analytics Dashboard, including:
- Writing or editing Next.js pages, API routes, or components
- Writing SQL queries, views, or schema migrations
- Debugging sync issues between n8n, ClickUp, Google Sheets, and Supabase
- Setting up environment variables or deployment configs
- Building new dashboard features

---

## PROJECT SNAPSHOT

**What it is:** A real-time analytics dashboard for an Upwork automation system. It aggregates job data from ClickUp, Google Sheets (`job_log`), and n8n webhooks into a Supabase PostgreSQL database and displays it in a Next.js frontend on Vercel.

**Stack:** Next.js 14 (App Router) · Tailwind CSS · Recharts · Supabase (PostgreSQL) · Prisma ORM · Supabase Auth · Vercel · n8n

---

## DATABASE — KEY FACTS

**Tables:** `jobs`, `agents`, `profiles`, `sync_log`, `stats_cache`

**Views (computed, no writes):** `agent_stats`, `profile_stats`

**Critical field conventions:**
- `job_id` — Vollna/Upwork job ID (TEXT, UNIQUE). Always use as upsert conflict key.
- `profile_id` — TEXT foreign key matching `profiles.profile_id` (NOT the UUID `profiles.id`)
- `agent_id` — UUID foreign key referencing `agents.id` (must resolve from `clickup_user_id` before insert)
- `outcome` — only ever `'won'`, `'lost'`, `'pending'`, or `'skipped'` (lowercase always)
- `clickup_status` — raw string from ClickUp (e.g. `'Proposal Ready'`, `'Sent'`, `'Won'`, `'Lost'`)
- `won_value` — DECIMAL, manually entered or synced from ClickUp custom field
- `skills` — TEXT[] (PostgreSQL array). When inserting from n8n, split comma-separated string: `body.skills?.split(', ')`

**Stats cache pattern:** Expensive aggregations are pre-computed and stored in `stats_cache` as JSONB. Cron refreshes every 15 min. Dashboard reads from cache, not raw tables directly.

**Indexes to remember:** `jobs(profile_id)`, `jobs(agent_id)`, `jobs(received_at DESC)`, `jobs(outcome)`, `jobs(clickup_status)`

---

## DATA SYNC — HOW IT WORKS

Three sync paths, each responsible for different data:

| Path | Trigger | What it does |
|------|---------|-------------|
| **n8n → Supabase webhook** | Every job processed by n8n | Creates/upserts job record with proposal text, ClickUp task ID |
| **Vercel Cron `/api/sync/clickup`** | Every 15 min | Polls ClickUp for status changes on open jobs, updates `clickup_status`, `outcome`, `outcome_at` |
| **ClickUp Webhook `/api/webhook/clickup`** | Real-time (advanced) | Instant status update when ClickUp task changes |

**Status → Outcome mapping:** `Won` → `'won'`, `Lost` → `'lost'`, all others → outcome stays `null`

**Always check:** When writing sync code, query only jobs where `outcome IS NULL` (open jobs). Closed jobs don't need re-syncing.

---

## API ROUTES — REFERENCE

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhook/n8n` | POST | Receive job data from n8n (verify HMAC with `N8N_WEBHOOK_SECRET`) |
| `/api/webhook/clickup` | POST | Receive ClickUp status updates (verify with `CLICKUP_WEBHOOK_SECRET`) |
| `/api/sync/clickup` | GET | Cron or manual ClickUp status poll (requires `Authorization: Bearer CRON_SECRET`) |
| `/api/sync/sheets` | GET | Import job_log from Google Sheets |
| `/api/stats/overview` | GET | Dashboard KPIs; accepts `?days=30` query param |
| `/api/stats/agents` | GET | Per-agent stats |
| `/api/stats/profiles` | GET | Per-profile stats |

**Security rules (never skip):**
- Webhook routes: verify HMAC signature before processing body
- Cron route: verify `Authorization: Bearer ${process.env.CRON_SECRET}` header
- All dashboard pages: protected by Supabase Auth middleware
- Service role key: server-side ONLY, never in client components or `NEXT_PUBLIC_*` vars

---

## DASHBOARD PAGES — WHAT TO SHOW

### `/dashboard` (Overview)
KPI row: Total Jobs · Proposals Sent · Won · Win Rate % · Total Revenue  
Charts: Daily job volume (bar, last 30d), Status funnel (Received→Sent→Following Up→Won)  
Tables: Top 3 agents by win rate, Top 3 profiles by volume  
Feed: Last 10 activity events  
System: Last sync time, GPT failure rate

### `/agents`
Per agent: jobs assigned, proposals sent, won count, win rate %, avg response time (hours), revenue  
Trend: Win rate sparkline over last 12 weeks

### `/profiles`
Per profile: total jobs, win rate, avg won value, total revenue  
Mini chart: volume by day  
Extras: Top skills in won jobs

### `/jobs`
Filterable table: agent, profile, status, date range, budget type  
Columns: Title · Profile · Agent · Budget · Status · Received · Sent · Outcome  
Row click: full proposal text, ClickUp link, client details  
Export: CSV

### `/settings`
Manual sync triggers, sync log (last 20 runs), alert thresholds

---

## ENVIRONMENT VARIABLES — FULL LIST

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # safe for client
SUPABASE_SERVICE_ROLE_KEY=            # SERVER ONLY

# Database
DATABASE_URL=                          # Supabase Postgres connection string

# ClickUp
CLICKUP_API_KEY=
CLICKUP_TEAM_ID=

# Google Sheets
GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_PRIVATE_KEY=
GOOGLE_SHEET_ID=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# Webhooks / Cron security
N8N_WEBHOOK_SECRET=
CLICKUP_WEBHOOK_SECRET=
CRON_SECRET=
```

---

## PROJECT FILE STRUCTURE

```
dashboard/
├── app/
│   ├── dashboard/page.tsx          ← Overview KPIs + charts
│   ├── agents/page.tsx             ← Agent list
│   ├── agents/[id]/page.tsx        ← Individual agent drilldown
│   ├── profiles/page.tsx
│   ├── profiles/[id]/page.tsx
│   ├── jobs/page.tsx               ← Filterable job table
│   ├── settings/page.tsx
│   └── api/
│       ├── webhook/n8n/route.ts
│       ├── webhook/clickup/route.ts
│       ├── sync/clickup/route.ts   ← Also used as Vercel Cron endpoint
│       ├── sync/sheets/route.ts
│       ├── stats/overview/route.ts
│       ├── stats/agents/route.ts
│       └── stats/profiles/route.ts
├── components/
│   ├── ui/                         ← StatCard, AgentCard, JobTable, etc.
│   ├── charts/                     ← Recharts wrappers
│   └── layout/                     ← Sidebar, Header, DateRangePicker
├── lib/
│   ├── supabase.ts                 ← Supabase client
│   ├── clickup.ts                  ← ClickUp API helpers
│   ├── sheets.ts                   ← Google Sheets helpers
│   └── stats.ts                    ← Aggregation utilities
├── prisma/schema.prisma
├── vercel.json                     ← Cron schedule: "*/15 * * * *"
└── .env.local
```

---

## CODING PATTERNS TO FOLLOW

### Supabase upsert (job creation)
```typescript
await supabase.from('jobs').upsert(
  { job_id: body.job_id, ... },
  { onConflict: 'job_id' }
);
```

### Resolving agent_id from ClickUp user ID
```typescript
const { data: agent } = await supabase
  .from('agents')
  .select('id')
  .eq('clickup_user_id', clickupUserId)
  .single();
const agentId = agent?.id ?? null;
```

### Stats API — time-windowed query pattern
```typescript
const days = parseInt(searchParams.get('days') || '30');
const since = new Date(Date.now() - days * 86400000).toISOString();
// then: .gte('received_at', since)
```

### Win rate computation
```typescript
const winRate = (won / (won + lost)) * 100  // only count won+lost, not pending
// SQL equivalent: COUNT(won) / NULLIF(COUNT(won+lost), 0) * 100
```

### HMAC webhook verification (n8n)
```typescript
import crypto from 'crypto';
function verifySignature(sig: string, body: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

---

## COMMON MISTAKES TO AVOID

- **Don't** use `profiles.id` (UUID) as FK in jobs — use `profiles.profile_id` (TEXT)
- **Don't** expose `SUPABASE_SERVICE_ROLE_KEY` in client components or `NEXT_PUBLIC_*`
- **Don't** query raw `jobs` for dashboard stats on every load — use `stats_cache` or the `agent_stats`/`profile_stats` views
- **Don't** forget to add `outcome_at` timestamp when setting `outcome` to `'won'` or `'lost'`
- **Don't** skip HMAC/signature verification on any webhook route
- **Don't** re-sync jobs where `outcome IS NOT NULL` — they're closed

---

## GLOSSARY

| Term | Meaning |
|------|---------|
| Job | An Upwork job posting received from Vollna via n8n |
| Proposal | AI-generated text sent to client via Upwork |
| Profile | One Upwork account targeting a specific tech stack/niche |
| Agent | Human freelancer managing proposals for 1+ profiles |
| Win Rate | `won ÷ (won + lost) × 100` |
| Response Time | `proposal_sent_at - received_at` (in hours) |
| Outcome | `won` / `lost` / `pending` / `skipped` (always lowercase) |
| Revenue | Sum of `won_value` for all won jobs |
