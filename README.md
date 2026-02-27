# Vollna Analytics Dashboard

Real-time analytics dashboard for Upwork job automation — track proposals, win rates, agent performance, and revenue.

Built with Next.js 16, Vercel Postgres (Neon), Recharts, shadcn/ui, and NextAuth.js v5.

## Features

- **KPI Overview** — total jobs, proposals sent, win rate, revenue at a glance
- **Agent Performance** — per-agent stats, win rate trends, response times
- **Profile Analytics** — per-profile volume, budget distribution, skills analysis
- **Jobs Table** — filterable, sortable, with CSV export
- **Charts** — volume over time, status funnel, revenue breakdowns, budget splits
- **Data Sync** — ClickUp status sync (cron), Google Sheets import, n8n/ClickUp webhooks
- **Settings** — manual sync triggers, sync log history, agent/profile management, alert thresholds
- **Authentication** — GitHub OAuth via NextAuth.js v5 with email allowlist
- **Dark Mode** — system-aware theme toggle

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Database | Vercel Postgres (Neon) via `@vercel/postgres` |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Charts | Recharts 3 |
| Auth | NextAuth.js v5 (Auth.js) + GitHub OAuth |
| Deployment | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- A Vercel project with Neon Postgres provisioned
- GitHub OAuth app (for authentication)

### Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

Generate an auth secret:

```bash
npx auth secret
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | Neon Postgres connection string (pooled) |
| `CLICKUP_API_KEY` | ClickUp API token for status sync |
| `CLICKUP_TEAM_ID` | ClickUp team/workspace ID |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Google service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Google service account private key |
| `GOOGLE_SHEET_ID` | Google Sheets spreadsheet ID |
| `N8N_WEBHOOK_SECRET` | HMAC secret for n8n webhook verification |
| `CLICKUP_WEBHOOK_SECRET` | Secret for ClickUp webhook verification |
| `CRON_SECRET` | Vercel cron authorization token |
| `AUTH_SECRET` | NextAuth.js session encryption secret |
| `AUTH_GITHUB_ID` | GitHub OAuth app client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth app client secret |
| `ALLOWED_EMAILS` | Comma-separated email allowlist (empty = allow all) |

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
npm run build
```

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/          # Authenticated dashboard pages
│   │   ├── dashboard/        # Overview with KPIs and charts
│   │   ├── agents/           # Agent list and detail pages
│   │   ├── profiles/         # Profile list and detail pages
│   │   ├── jobs/             # Filterable jobs table
│   │   └── settings/         # Sync controls, management, alerts
│   ├── api/
│   │   ├── auth/             # NextAuth.js route handler
│   │   ├── stats/            # Stats API (overview, agents, profiles)
│   │   ├── sync/             # ClickUp sync, Google Sheets import
│   │   ├── webhook/          # n8n and ClickUp webhooks (public)
│   │   └── jobs/             # Job export (CSV)
│   └── login/                # Login page (GitHub OAuth)
├── components/
│   ├── charts/               # Recharts visualizations
│   ├── layout/               # Sidebar and header
│   ├── settings/             # Settings page components
│   └── ui/                   # shadcn/ui primitives
├── lib/
│   ├── auth.ts               # NextAuth.js config and helpers
│   ├── data.ts               # Database queries
│   ├── clickup.ts            # ClickUp API client
│   ├── sheets.ts             # Google Sheets client
│   └── types.ts              # TypeScript types
└── middleware.ts              # Auth middleware (protects dashboard + API)
```

## Authentication

Authentication uses NextAuth.js v5 with GitHub OAuth. Protected routes:

- All dashboard pages (`/dashboard`, `/agents`, `/profiles`, `/jobs`, `/settings`)
- API routes (`/api/stats/*`, `/api/sync/*`, `/api/jobs/*`)

Public routes (no auth required):

- `/login` — sign-in page
- `/api/webhook/*` — webhook endpoints (use their own HMAC/secret verification)
- `/api/auth/*` — NextAuth.js internals

Set `ALLOWED_EMAILS` to restrict access to specific GitHub accounts by email. Leave empty to allow any GitHub user.

## Deployment

Deploy to Vercel with `vercel deploy` or connect your Git repository. Ensure all environment variables are set in the Vercel dashboard.

The ClickUp status sync runs on a daily cron schedule configured in `vercel.json`.
