# Rising Lions Analytics Dashboard

Real-time analytics dashboard for Upwork job automation — track proposals, win rates, agent performance, and revenue.

Built with Next.js 16, Postgres 17, Recharts, shadcn/ui, and NextAuth.js v5. Deployed self-hosted on Contabo via Docker.

## Features

- **KPI Overview** — total jobs, proposals sent, win rate, revenue at a glance
- **Agent Performance** — per-agent stats, win rate trends, response times
- **Profile Analytics** — per-profile volume, budget distribution, skills analysis
- **Jobs Table** — filterable, sortable, with CSV export
- **Charts** — volume over time, status funnel, revenue breakdowns, budget splits
- **Data Sync** — Google Sheets import, n8n webhooks → Task Board
- **Task Board** — single source of truth for job status; kanban with custom fields, comments, attachments
- **Settings** — manual sync triggers, sync log history, agent/profile management, alert thresholds
- **Authentication** — GitHub OAuth (NextAuth.js v5) + email/password credentials
- **Dark Mode** — system-aware theme toggle

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Database | Postgres 17 via `pg` (raw SQL through `src/lib/db.ts` tagged-template wrapper) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Charts | Recharts 3 |
| Auth | NextAuth.js v5 + GitHub OAuth + credentials |
| File storage | Local filesystem (Docker named volume `uploads_data`, served via `/api/files/[...path]` with auth) |
| Deployment | Docker on Contabo VPS (Ubuntu 24.04) |

## Getting Started

### Prerequisites

- Node.js 22+
- Postgres 17 (local instance, or the Docker sibling container from `docker-compose.server.yml`)
- GitHub OAuth app (for authentication)

### Setup

```bash
npm install
cp .env.example .env.local
# fill in POSTGRES_*, AUTH_*, etc. in .env.local
npx auth secret
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` (or `POSTGRES_HOST` + `POSTGRES_USER` + `POSTGRES_PASSWORD` + `POSTGRES_DATABASE`) | Postgres connection |
| `UPLOADS_DIR` | Where task attachments are written. Defaults to `./uploads` in dev; production sets it to `/var/lib/sales-dashboard/uploads` (a Docker volume) |
| `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` / `GOOGLE_SHEET_ID` | Sheets import |
| `N8N_WEBHOOK_SECRET` | HMAC secret for n8n webhook verification |
| `N8N_API_URL` / `N8N_API_KEY` | n8n auto-provisioning of webhook nodes |
| `CRON_SECRET` | Authorization for `/api/migrate` and other cron-style routes |
| `AUTH_SECRET` | NextAuth.js session encryption secret |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app credentials |
| `ALLOWED_EMAILS` | Comma-separated email allowlist (empty = allow any GitHub user) |
| `ADMIN_CREDENTIALS` | `email:password` pairs (comma-separated) for credentials login |
| `SLACK_WEBHOOK_URL` | Optional — Slack alerts |
| `NEXT_PUBLIC_APP_URL` | Public origin (used by server actions that call back into the API) |

See `.env.example` for the full list.

### Development

```bash
npm run dev
```

Open <http://localhost:3000>.

### Build

```bash
npm run build
```

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/          # Admin pages (KPIs, agents, profiles, jobs, settings, tasks)
│   ├── (agent)/              # Agent pages (/my-*)
│   ├── api/
│   │   ├── auth/             # NextAuth.js route handler
│   │   ├── stats/            # Stats API (cached, overview/agents/profiles)
│   │   ├── sync/             # Google Sheets import
│   │   ├── webhook/          # Public n8n endpoint (HMAC verified)
│   │   ├── v1/webhooks/tasks # Bearer-auth board ingestion from n8n
│   │   ├── files/[...path]/  # Auth-gated file serving for task attachments
│   │   └── jobs/             # Job search + CSV export
│   └── login/
├── components/
├── lib/
│   ├── auth.ts               # NextAuth.js config
│   ├── data.ts               # Database queries (~1700 lines raw SQL)
│   ├── actions.ts            # Server actions + revalidatePath
│   ├── db.ts                 # pg pool + tagged-template wrapper
│   ├── uploads.ts            # File storage helpers (path + mime)
│   ├── task-data.ts          # Task board queries
│   ├── task-actions.ts       # Task board mutations
│   ├── sheets.ts             # Google Sheets client
│   └── types.ts
└── middleware.ts             # Auth + admin/agent route guard
```

## Authentication

NextAuth.js v5 with two providers:

- **GitHub OAuth** — restricted by `ALLOWED_EMAILS` allowlist
- **Credentials** — admin via `ADMIN_CREDENTIALS`, agents via DB-stored PBKDF2 hashes

Protected:

- All admin pages (`/dashboard`, `/agents`, `/profiles`, `/jobs`, `/settings`, `/tasks`)
- All agent pages (`/my-*`)
- All API routes except `/api/webhook/*` (which use HMAC) and `/api/auth/*`

## Deployment

Pushed to `main` triggers `.github/workflows/deploy-contabo.yml`, which SSHes into the VPS, fast-forwards the working tree, rebuilds via `docker compose -f docker-compose.server.yml`, and verifies the healthcheck. See `docker/DEPLOY-CONTABO.md` for the full runbook.

For all repo guidance see `CLAUDE.md` (small index) and the topic files under `docs/claude/`.
