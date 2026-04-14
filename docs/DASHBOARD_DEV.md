# Vollna Analytics Dashboard — Developer Document
**Version:** 1.0  
**Status:** Specification  
**Last Updated:** 2025-02-25

---

## 1. PROJECT OVERVIEW

A real-time analytics dashboard that aggregates data from ClickUp, Google Sheets (job_log), and optionally Vollna directly, and presents unified performance stats per agent, profile, and job. Deployed on Vercel with a PostgreSQL database via Supabase.

### What it shows
- Total jobs received, proposals sent, win/loss rates
- Per-agent performance (jobs assigned, sent, won, win %, avg response time)
- Per-profile performance (volume, win rate, avg budget won)
- Job pipeline (kanban-style status view)
- Revenue tracking (hourly + fixed won deals)
- GPT failure rate and system health
- Recent activity feed

### Who uses it
- System admin (you) — full view of all agents and profiles
- Agents — view their own stats and task queue (future phase)

---

## 2. TECH STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14 (App Router) | Vercel-native, SSR + client components |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Charts | Recharts | React-native, no extra bundle issues |
| Database | Supabase (PostgreSQL) | Free tier, real-time, REST + SDK |
| ORM | Prisma | Type-safe DB queries, auto migrations |
| Auth | Supabase Auth (email+password) | Simple, free, integrates with DB |
| Deployment | Vercel | Git push to deploy, free hobby tier |
| Data sync | n8n (existing) + Vercel API routes | n8n writes to DB, dashboard reads |
| Cron jobs | Vercel Cron (or n8n schedule) | Periodic ClickUp data sync |
| Environment | `.env.local` + Vercel env vars | Secrets management |

---

## 3. ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                     DATA SOURCES                             │
├─────────────────┬──────────────────┬────────────────────────┤
│   ClickUp API   │  Google Sheets   │      Vollna            │
│  (task status,  │  (job_log tab —  │  (webhook payload      │
│   assignees,    │   already has    │   already stored       │
│   custom fields)│   all job data)  │   by n8n workflow)     │
└────────┬────────┴────────┬─────────┴──────────┬────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│                    SYNC LAYER                                │
│                                                              │
│  Option A: n8n writes to Supabase on every job processed    │
│  Option B: Vercel Cron calls ClickUp API every 15 minutes   │
│  Option C: Both (n8n for writes, cron for status updates)   │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                 SUPABASE (PostgreSQL)                        │
│                                                              │
│  jobs          agents        profiles      sync_log         │
│  proposals     stats_cache   activity      settings         │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              NEXT.JS APP (Vercel)                            │
│                                                              │
│  /app/dashboard    → main stats view                        │
│  /app/agents       → per-agent drilldown                    │
│  /app/profiles     → per-profile drilldown                  │
│  /app/jobs         → job pipeline / kanban                  │
│  /app/settings     → config, thresholds                     │
│                                                              │
│  /api/sync/clickup  → manual or cron sync endpoint         │
│  /api/sync/sheets   → reads job_log from Google Sheets      │
│  /api/webhook/n8n   → receives data from n8n on job create  │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. DATABASE SCHEMA

### Table: `jobs`
```sql
CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            TEXT UNIQUE NOT NULL,        -- Vollna/Upwork job ID
  job_title         TEXT NOT NULL,
  job_url           TEXT,
  job_description   TEXT,
  budget_type       TEXT,                        -- 'fixed' | 'hourly'
  budget_min        DECIMAL(10,2),
  budget_max        DECIMAL(10,2),
  hourly_min        DECIMAL(10,2),
  hourly_max        DECIMAL(10,2),
  skills            TEXT[],                      -- array of skill strings
  client_country    TEXT,
  client_rating     DECIMAL(3,2),
  client_total_spent DECIMAL(12,2),
  client_hires      INTEGER,
  posted_at         TIMESTAMPTZ,
  received_at       TIMESTAMPTZ DEFAULT NOW(),   -- when n8n received it
  profile_id        TEXT REFERENCES profiles(profile_id),
  agent_id          UUID REFERENCES agents(id),
  clickup_task_id   TEXT,
  clickup_task_url  TEXT,
  clickup_status    TEXT DEFAULT 'Proposal Ready',
  proposal_text     TEXT,                        -- generated proposal
  gpt_model         TEXT,
  gpt_tokens_used   INTEGER,
  outcome           TEXT,                        -- 'won' | 'lost' | 'pending' | 'skipped'
  won_value         DECIMAL(10,2),               -- actual contract value if won
  proposal_sent_at  TIMESTAMPTZ,
  outcome_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `agents`
```sql
CREATE TABLE agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_user_id   TEXT UNIQUE NOT NULL,        -- ClickUp user ID
  name              TEXT NOT NULL,
  email             TEXT,
  avatar_url        TEXT,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `profiles`
```sql
CREATE TABLE profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        TEXT UNIQUE NOT NULL,        -- matches Google Sheet profile_id
  profile_name      TEXT NOT NULL,
  stack             TEXT,
  vollna_filter_tag TEXT UNIQUE,
  agent_id          UUID REFERENCES agents(id),
  clickup_list_id   TEXT,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `sync_log`
```sql
CREATE TABLE sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,                 -- 'clickup' | 'sheets' | 'n8n_webhook'
  records_synced  INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  errors          TEXT[],
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          TEXT DEFAULT 'running'         -- 'running' | 'success' | 'failed'
);
```

### Table: `stats_cache`
```sql
-- Materialized stats refreshed every 15 min by cron
-- Avoids expensive aggregation queries on every dashboard load
CREATE TABLE stats_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key       TEXT UNIQUE NOT NULL,          -- e.g., 'agent_stats', 'profile_stats_7d'
  data            JSONB NOT NULL,
  computed_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);
```

### Indexes
```sql
CREATE INDEX idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX idx_jobs_agent_id ON jobs(agent_id);
CREATE INDEX idx_jobs_received_at ON jobs(received_at DESC);
CREATE INDEX idx_jobs_clickup_status ON jobs(clickup_status);
CREATE INDEX idx_jobs_outcome ON jobs(outcome);
CREATE INDEX idx_jobs_job_id ON jobs(job_id);
```

### Key Views
```sql
-- Agent performance summary
CREATE VIEW agent_stats AS
SELECT
  a.id,
  a.name,
  a.clickup_user_id,
  COUNT(j.id) AS total_jobs,
  COUNT(CASE WHEN j.clickup_status = 'Sent' OR j.outcome IS NOT NULL THEN 1 END) AS proposals_sent,
  COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
  COUNT(CASE WHEN j.outcome = 'lost' THEN 1 END) AS lost,
  ROUND(
    COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
    NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
  ) AS win_rate_pct,
  COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue,
  AVG(
    CASE WHEN j.proposal_sent_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.proposal_sent_at - j.received_at)) / 3600
    END
  ) AS avg_response_hours
FROM agents a
LEFT JOIN jobs j ON j.agent_id = a.id
GROUP BY a.id, a.name, a.clickup_user_id;

-- Profile performance summary
CREATE VIEW profile_stats AS
SELECT
  p.id,
  p.profile_id,
  p.profile_name,
  p.stack,
  COUNT(j.id) AS total_jobs,
  COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
  ROUND(
    COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
    NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
  ) AS win_rate_pct,
  AVG(CASE WHEN j.outcome = 'won' THEN j.won_value END) AS avg_won_value,
  COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue
FROM profiles p
LEFT JOIN jobs j ON j.profile_id = p.profile_id
GROUP BY p.id, p.profile_id, p.profile_name, p.stack;
```

---

## 5. DATA SYNC STRATEGY

### Method A — n8n writes to Supabase (RECOMMENDED for job creation)

Add a node to the existing n8n workflow after "Log Success to job_log":

```
Node X: Insert to Supabase
Type: HTTP Request
URL: https://[your-project].supabase.co/rest/v1/jobs
Headers:
  apikey: [SUPABASE_ANON_KEY]
  Authorization: Bearer [SUPABASE_SERVICE_ROLE_KEY]
  Content-Type: application/json
  Prefer: return=representation
Body: {
  "job_id": "...",
  "job_title": "...",
  "profile_id": "...",
  "agent_id": "...",  -- looked up from agents table by agent_clickup_id
  "clickup_task_id": "...",
  "proposal_text": "...",
  ... all fields
}
```

### Method B — Vercel Cron syncs ClickUp status (RECOMMENDED for status updates)

ClickUp task status changes (Proposal Ready → Sent → Won) don't trigger n8n.
A cron job polls ClickUp every 15 minutes for updated task statuses.

```
// vercel.json
{
  "crons": [
    {
      "path": "/api/sync/clickup",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

The `/api/sync/clickup` route:
1. Reads all jobs from DB where outcome IS NULL
2. For each, calls `GET /api/v2/task/{clickup_task_id}` 
3. Maps ClickUp status to outcome: Won → 'won', Lost → 'lost'
4. Updates `jobs` table with new status, outcome, outcome_at

### Method C — ClickUp Webhook (ADVANCED — real-time status sync)

Register a ClickUp webhook for task status changes:
```
POST https://api.clickup.com/api/v2/team/{team_id}/webhook
{
  "endpoint": "https://your-dashboard.vercel.app/api/webhook/clickup",
  "events": ["taskStatusUpdated"]
}
```

The `/api/webhook/clickup` route updates the DB immediately on status change.
Most accurate but requires ClickUp webhook setup.

---

## 6. PROJECT STRUCTURE

```
dashboard/
├── app/
│   ├── layout.tsx              # Root layout with sidebar nav
│   ├── page.tsx                # Redirect to /dashboard
│   ├── dashboard/
│   │   └── page.tsx            # Main overview stats
│   ├── agents/
│   │   ├── page.tsx            # Agent list with stats
│   │   └── [id]/page.tsx       # Individual agent drilldown
│   ├── profiles/
│   │   ├── page.tsx            # Profile list with stats
│   │   └── [id]/page.tsx       # Individual profile drilldown
│   ├── jobs/
│   │   └── page.tsx            # Job pipeline / table
│   ├── settings/
│   │   └── page.tsx            # Config, manual sync
│   └── api/
│       ├── sync/
│       │   ├── clickup/route.ts    # Cron: sync ClickUp statuses
│       │   └── sheets/route.ts     # Manual: import from job_log
│       ├── webhook/
│       │   ├── n8n/route.ts        # Receives data from n8n
│       │   └── clickup/route.ts    # ClickUp status webhooks
│       └── stats/
│           ├── overview/route.ts
│           ├── agents/route.ts
│           └── profiles/route.ts
├── components/
│   ├── ui/
│   │   ├── StatCard.tsx
│   │   ├── AgentCard.tsx
│   │   ├── ProfileCard.tsx
│   │   ├── JobTable.tsx
│   │   ├── PipelineBoard.tsx
│   │   └── ActivityFeed.tsx
│   ├── charts/
│   │   ├── WinRateChart.tsx
│   │   ├── VolumeChart.tsx
│   │   ├── RevenueChart.tsx
│   │   └── StatusFunnel.tsx
│   └── layout/
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       └── DateRangePicker.tsx
├── lib/
│   ├── supabase.ts             # Supabase client
│   ├── clickup.ts              # ClickUp API client
│   ├── sheets.ts               # Google Sheets client
│   └── stats.ts                # Aggregation helpers
├── prisma/
│   └── schema.prisma           # Prisma schema (mirrors SQL above)
├── .env.local                  # Local secrets
├── vercel.json                 # Cron config
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

---

## 7. ENVIRONMENT VARIABLES

```bash
# .env.local (also add to Vercel project settings)

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # Never expose client-side

# Database (Supabase connection string)
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres

# ClickUp
CLICKUP_API_KEY=pk_12345678_...
CLICKUP_TEAM_ID=12345678

# Google Sheets (for job_log import)
GOOGLE_SHEETS_CLIENT_EMAIL=service@project.iam.gserviceaccount.com
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

# Dashboard auth
NEXTAUTH_SECRET=random-32-char-string
NEXTAUTH_URL=https://your-dashboard.vercel.app

# Webhook security
N8N_WEBHOOK_SECRET=random-32-char-string     # n8n signs its webhook calls
CLICKUP_WEBHOOK_SECRET=from-clickup-settings
```

---

## 8. KEY API ROUTES

### POST `/api/webhook/n8n`
Called by n8n after every successful job processing.

```typescript
// app/api/webhook/n8n/route.ts
export async function POST(req: Request) {
  // 1. Verify n8n signature (HMAC)
  const sig = req.headers.get('x-n8n-signature');
  if (!verifySignature(sig, await req.text(), process.env.N8N_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  // 2. Upsert job record
  const { data, error } = await supabase
    .from('jobs')
    .upsert({
      job_id: body.job_id,
      job_title: body.job_title,
      job_url: body.job_url,
      profile_id: body.profile_id,
      agent_id: await resolveAgentId(body.agent_clickup_id),
      clickup_task_id: body.clickup_task_id,
      clickup_task_url: body.clickup_task_url,
      clickup_status: 'Proposal Ready',
      proposal_text: body.generated_proposal,
      budget_type: body.budget_type,
      budget_min: body.budget_min,
      budget_max: body.budget_max,
      skills: body.skills?.split(', '),
      client_country: body.client_country,
      client_rating: body.client_rating,
      posted_at: body.posted_at,
      received_at: new Date().toISOString(),
    }, { onConflict: 'job_id' });

  return Response.json({ ok: true });
}
```

### GET `/api/stats/overview`
Returns aggregated dashboard metrics.

```typescript
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [jobs, agentStats, profileStats] = await Promise.all([
    supabase.from('jobs').select('*').gte('received_at', since),
    supabase.from('agent_stats').select('*'),
    supabase.from('profile_stats').select('*'),
  ]);

  return Response.json({
    total_jobs: jobs.data?.length ?? 0,
    proposals_sent: jobs.data?.filter(j => j.proposal_sent_at).length ?? 0,
    won: jobs.data?.filter(j => j.outcome === 'won').length ?? 0,
    lost: jobs.data?.filter(j => j.outcome === 'lost').length ?? 0,
    win_rate: computeWinRate(jobs.data),
    total_revenue: jobs.data?.reduce((sum, j) => sum + (j.won_value || 0), 0) ?? 0,
    agents: agentStats.data,
    profiles: profileStats.data,
  });
}
```

### GET `/api/sync/clickup` (also called by Vercel Cron)
```typescript
export async function GET(req: Request) {
  // Verify cron secret
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all jobs with ClickUp task IDs that are still open
  const { data: openJobs } = await supabase
    .from('jobs')
    .select('id, clickup_task_id')
    .is('outcome', null)
    .not('clickup_task_id', 'is', null);

  let updated = 0;
  for (const job of openJobs ?? []) {
    const task = await fetchClickUpTask(job.clickup_task_id);
    const newStatus = task.status.status;
    const outcome = mapStatusToOutcome(newStatus); // 'Won' → 'won', 'Lost' → 'lost'

    await supabase.from('jobs').update({
      clickup_status: newStatus,
      outcome: outcome ?? undefined,
      outcome_at: outcome ? new Date().toISOString() : undefined,
    }).eq('id', job.id);

    updated++;
  }

  return Response.json({ updated });
}
```

---

## 9. DASHBOARD PAGES & METRICS

### Page: `/dashboard` (Overview)
- KPI row: Total Jobs (period) | Proposals Sent | Won | Win Rate % | Total Revenue
- Volume chart: jobs received per day (last 30 days, bar chart)
- Status funnel: Received → Sent → Following Up → Won
- Top 3 agents by win rate
- Top 3 profiles by volume
- Recent activity feed (last 10 events)
- System health: last sync time, GPT failure rate

### Page: `/agents`
Per agent:
- Name, avatar, profile assignments
- Stats: Jobs | Sent | Won | Win Rate | Avg Response Time | Revenue
- Trend: win rate over last 12 weeks (sparkline)
- Active tasks count (from ClickUp)

### Page: `/profiles`
Per profile:
- Profile name, stack, assigned agent
- Stats: Total Jobs | Win Rate | Avg Won Value | Total Revenue
- Volume by day (mini chart)
- Top skills in won jobs

### Page: `/jobs`
Full job table with filters:
- Filter by: agent, profile, status, date range, budget type
- Columns: Title | Profile | Agent | Budget | Status | Received | Sent | Outcome
- Click row → see full proposal text, ClickUp link, client details
- Export to CSV

### Page: `/settings`
- Manual sync buttons (ClickUp, Google Sheets)
- Sync log (last 20 sync runs)
- Alert thresholds (e.g., notify if win rate drops below X%)

---

## 10. DEPLOYMENT — STEP BY STEP

### Phase 1: Database
```bash
# 1. Create Supabase project at supabase.com
# 2. Run schema SQL in Supabase SQL editor
# 3. Note: Project URL, anon key, service role key, DB connection string
```

### Phase 2: Local development
```bash
git clone [your-repo]
cd dashboard
npm install
cp .env.example .env.local
# Fill in all env vars
npx prisma db push      # syncs schema to Supabase
npm run dev             # runs at localhost:3000
```

### Phase 3: Seed initial data
```bash
# Import existing jobs from Google Sheets job_log
# Visit http://localhost:3000/settings → "Import from Sheets"
# This reads your job_log tab and populates the jobs table
```

### Phase 4: Connect n8n
Add to existing n8n workflow (after "Log Success to job_log"):
```
Node: HTTP Request
URL: https://your-dashboard.vercel.app/api/webhook/n8n
Method: POST
Headers: x-n8n-signature: [HMAC of body using N8N_WEBHOOK_SECRET]
Body: all job fields + generated_proposal + clickup_task_id
```

### Phase 5: Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel
vercel login
vercel --prod

# Or connect GitHub repo in Vercel dashboard for auto-deploys

# Add all env vars in Vercel Project → Settings → Environment Variables
# Vercel Cron activates automatically from vercel.json
```

### Phase 6: Setup ClickUp sync
Choose one:
- Option A (Simple): Vercel Cron at `*/15 * * * *` polling ClickUp
- Option B (Real-time): Register ClickUp webhook pointing to `/api/webhook/clickup`

---

## 11. SECURITY CHECKLIST

- [ ] Supabase Row Level Security (RLS) enabled on all tables
- [ ] Service role key only used server-side (never in client components)
- [ ] n8n webhook verified with HMAC signature
- [ ] ClickUp webhook verified with signature
- [ ] All API routes protected with auth middleware
- [ ] Cron endpoints protected with CRON_SECRET
- [ ] Rate limiting on webhook endpoints
- [ ] No sensitive data logged in production

---

## 12. PHASE 2 FEATURES (post-launch)

- Agent login portal (agents see their own stats only)
- Slack/email alerts when win rate drops or GPT failures spike
- Proposal A/B testing (track which GPT instructions lead to better win rates)
- Budget intelligence (which budget ranges have best win rates per profile)
- Client country heatmap
- Best time to apply analysis (jobs posted at X time → Y win rate)
- Auto-update won_value from ClickUp custom field when agent marks outcome
- Weekly email report to system admin

---

## 13. GLOSSARY

| Term | Definition |
|------|-----------|
| Job | An Upwork job posting received from Vollna |
| Proposal | The AI-generated text sent to the client via Upwork |
| Profile | One Upwork account targeting a specific tech stack/niche |
| Agent | The human freelancer assigned to manage proposals for 1+ profiles |
| Win Rate | Won jobs ÷ (Won + Lost) jobs × 100% |
| Response Time | Time from job received to proposal sent |
| Outcome | Won / Lost / Pending / Skipped |
| Revenue | won_value of all Won jobs (manually entered or from ClickUp field) |
