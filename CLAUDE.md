# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rising Lions Analytics Dashboard — a real-time analytics platform for Upwork job automation. Tracks proposals, win rates, agent performance, and revenue. Data flows in from n8n webhooks (Upwork jobs), Google Sheets imports, and the internal Task Board system.

> **IMPORTANT**: ClickUp has been fully replaced by the internal Task Board (Milestone 8). The Task Board is the **single source of truth** for job status tracking. Never rely on ClickUp data, APIs, or webhooks. All ClickUp integration code has been removed.

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
```

No test framework is configured. There are no unit/integration tests.

## Deployment

The app is deployed **to two targets simultaneously** from `main`:

1. **Vercel** (primary) — `https://sales-dashboard-snowy-beta.vercel.app`, backed by Neon Postgres. Git push triggers Vercel's own deploy. Vercel handles cron jobs defined in `vercel.json`.
2. **Contabo self-hosted** — `http://157.173.110.62` on a Ubuntu 24.04 VPS, Docker-native, Postgres 17 in a sibling container. Deployed by `.github/workflows/deploy-contabo.yml` on every push to `main`: SSH → `git reset --hard` → `docker compose --env-file .env.production -f docker-compose.server.yml up -d --build` → healthcheck → done. See `docker/DEPLOY-CONTABO.md` for the runbook.

Both deployments receive the same n8n webhook traffic via parallel sink nodes in the workflow (see "n8n Integration" below). No local dev workflow — all changes must be production-ready.

**CI/CD key files:**
- `.github/workflows/deploy-contabo.yml` — **active** auto-deploy pipeline (push to main)
- `docker-compose.server.yml` — lean HTTP-only compose used on Contabo (no nginx, no SSL)
- `docker-compose.prod.yml` — full nginx+certbot stack, intended for post-domain setup

**Contabo gotchas:**
- Compose variable substitution for postgres needs `--env-file .env.production` on every command
- `Dockerfile.prod` healthcheck uses `127.0.0.1` not `localhost` (BusyBox wget resolves localhost to IPv6 ::1 which Next.js standalone doesn't bind)
- `next.config.ts` has `typescript.ignoreBuildErrors: true` to work around pre-existing strict-mode errors in `src/lib/data.ts`

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Database**: Vercel Postgres (Neon) via `@vercel/postgres` — all queries use **raw SQL** (no ORM)
- **Auth**: NextAuth.js v5 (beta.30) with GitHub OAuth + email/password credentials
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Charts**: Recharts

### Route Groups & Roles

Two user roles control access:
- **`admin`** — full access via `(dashboard)/` route group
- **`agent`** — restricted to `(agent)/` route group (`/my-dashboard`, `/my-pipeline`, `/my-connects`, `/my-analytics`, `/my-jobs`, `/my-performance`, `/my-tasks`)

Middleware (`src/middleware.ts`) enforces auth and redirects agents away from admin routes to `/my-dashboard`.

### Key Files

| File | What it does |
|------|-------------|
| `src/lib/data.ts` | All database queries (~1700 lines of raw SQL) |
| `src/lib/actions.ts` | Server actions (mutations + `revalidatePath`) |
| `src/lib/auth.ts` | NextAuth config, session callbacks, role logic |
| `src/lib/types.ts` | TypeScript interfaces for all entities |
| `src/lib/seed.ts` | Database schema DDL + seed data |
| `src/lib/sheets.ts` | Google Sheets API client |
| `src/lib/alerts.ts` | Alert thresholds + Slack webhook integration |

### Data Flow

1. **Ingestion**: Vollna (Upwork scraper) → n8n (8 per-agent webhooks) → Claude AI proposal → Board task (`POST /api/v1/webhooks/tasks`) + Dashboard event (`POST /api/webhook/n8n`, HMAC verified) → `tasks` + `jobs` tables
2. **Status tracking**: Task Board column move → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` + outcome
3. **Import**: Manual trigger → `POST /api/sync/sheets` → bulk import from Google Sheets
4. **Caching**: Stats endpoints cache results in `stats_cache` table (5-min TTL)

> **ClickUp removed (M8)**: ClickUp webhooks, sync routes, OAuth, API client, and cron job have all been deleted. Job status (`jobs.status`) is now driven entirely by Task Board column moves.

### n8n Integration

- **Instance**: ikonicdev.app.n8n.cloud (v2.42.3)
- **MCP Server**: Connected (21 tools — can create/update/execute workflows)
- **Active workflow**: "multiple webhooks" (EWnZg3svZWwcIRs4) — 8 Vollna webhooks per agent (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal) → Claude AI proposals → Board task creation → Dashboard webhook
- **Webhook payload**: Nested format with `job`, `client`, `routing`, `scores`, `proposal`, `outcome` fields. Normalized by `/api/webhook/n8n` route.
- **Outcome values from n8n**: `proposal_created`, `gpt_error`, `rejected`, `no_profile`, `weekend`, `inactive`

### n8n → Task Board Architecture

The n8n workflow delivers processed jobs to the **Task Board** after AI proposal generation. As of 2026-04-11, `Format Dashboard Event` is triggered directly by `Format ClickUp Task` (in parallel with the Create nodes), and fans out to BOTH the Vercel and Contabo dashboards simultaneously:

```
Format ClickUp Task ┬─► Create ClickUp Task          (legacy — removable)
                    ├─► Create Board Task            (legacy — removable)
                    └─► Format Dashboard Event ┬─► Send to Dashboard             → Vercel   POST /api/webhook/n8n
                                                └─► Send to Self-Hosted Dashboard → Contabo POST http://157.173.110.62/api/webhook/n8n
```

Both sinks use `neverError: true` so a down environment never breaks the pipeline. The payload shape is identical between the two — the only difference is that `clickup.taskId` / `clickup.taskUrl` are now always `null` because Format Dashboard Event runs before any ClickUp API response exists. Outcome detection falls back to `item.taskName && item.proposal → 'proposal_created'` which is already coded in the Format Dashboard Event Code node.

When the two Create nodes are eventually deleted, the Format ClickUp Task node will have a single downstream (Format Dashboard Event) and the dashboard fan-out keeps working unchanged.

- **Board API**: `POST /api/v1/webhooks/tasks` with Bearer token auth (`n8n-board-sync`). Falls back to default project.
- **Payload mapping**: Task title = `[profile] Job Title`, description = rich formatted proposal + job snapshot. Job metadata stored in `custom_fields` (`_job_id`, `_job_url`, `_budget`, `_skills`, `_proposal`, `_assigned_agent`, `_profile_name`, `_source`, client data)
- **Task-Job linking**: `custom_fields._job_id` links board tasks to the `jobs` table, enabling the 3-column task detail view (task fields | job details | proposal)
- **Status sync**: When a task moves columns on the board → `moveTaskAction()` → `syncJobStatusFromTask()` → `jobs.status` updated to column name

### Database Tables

**Original tables:** `agents`, `profiles`, `jobs`, `sync_log`, `stats_cache`, `alerts`. Schema in `src/lib/seed.ts` and `src/lib/schema.sql`.

**Task management tables (migration 006):** `workspaces`, `projects`, `project_members`, `columns`, `tasks`, `task_assignees`, `task_tags`, `task_tag_map`, `comments`, `activity_log`, `checklist_items`, `file_attachments`, `webhook_configs`, `webhook_event_log`, `notifications`, `notification_preferences`, `saved_views`, `custom_field_definitions`.

Migrations in `src/lib/migrations/`.

### API Conventions

- **Protected routes** check auth via `getServerSession()` or middleware
- **Webhook routes** are public but verify signatures (HMAC SHA256)
- **Cron routes** require `Authorization: Bearer <CRON_SECRET>` header
- Stats API responses are cached in DB; server actions call `revalidatePath()` to bust cache

## Code Patterns

- **No ORM** — write raw SQL with `sql` tagged template from `@vercel/postgres`
- **Server components by default** — pages fetch data with async/await at the component level
- **`"use client"` only when needed** — for interactivity, charts, or browser APIs
- **Path alias**: `@/*` maps to `./src/*`
- **URL state for filters** — job filters are stored in URL search params, not React state
- **Server actions for mutations** — all writes go through `src/lib/actions.ts`, which revalidates paths after changes
- **Smart polling** — `<AutoRefresh interval={N} />` component calls `router.refresh()` on a timer. 5s for task boards, 15s for dashboards. Pauses when tab is hidden. No WebSockets needed.

### Agent Pages

Agents have full dashboard access scoped to their own data. All agent pages force `agentId = session.user.agentId` at the server component level — no query param override possible.

| Agent Route | Mirrors Admin Route | Data Scope |
|-------------|-------------------|------------|
| `/my-dashboard` | `/dashboard` | Own KPIs, funnel, pipeline, recent jobs |
| `/my-pipeline` | `/pipeline` | Own pipeline stages + active jobs |
| `/my-connects` | `/connects` | Own connects usage, ROI, filter quality |
| `/my-analytics` | `/analytics` | Own proposal models, geography, timing, budget |
| `/my-performance` | — | Own win rate trends, response time |
| `/my-jobs` | `/jobs` | Own job list |
| `/my-tasks` | `/tasks` | Assigned boards only |

## Migration Version History

| Version | File | Milestone | Description |
|---------|------|-----------|-------------|
| 004 | `004_cyberpunk_schema.sql` | — | connects_used, priority, rejection_reason, niche, connects_budget, bonus_earned |
| 005 | `005_agent_passwords.sql` | — | password_hash column + 4 agent passwords |
| 006 | `006_task_management_schema.sql` | M1 | 18 task management tables, 14 indexes, 3 triggers, default seed |
| 008 | (in migrate route) | — | Webhook config: Bearer token `n8n-board-sync` → target project |
| 009 | (in migrate route) | — | 14 custom field definitions for n8n job data (Job Details, Client Info, Routing Info, Proposal) |
| 010 | `010_profile_platform.sql` | — | Add `platform` column to profiles table (default: 'Upwork') |
| 011 | `011_fix_profile_assignments.sql` | — | Fix profile-to-agent assignments to match n8n flow |
| 012 | `012_remove_clickup_dependency.sql` | M8 | Rename `clickup_status` → `status`, add `jobs.task_id` FK, make `clickup_user_id` nullable |
| 013 | `013_lifecycle_milestones.sql` | — | Add `meeting_booked_at` milestone column, backfill from activity_log, partial indexes |
| 014 | (in migrate route) | — | Lifecycle milestone columns extended: `proposal_viewed_at`, `in_chat_at`, `meeting_done_at`; backfill from activity_log + partial indexes |
| 015 | `015_stage_entered_at_filter.sql` | — | Backfill `jobs.stage_entered_at` from `received_at`, set DEFAULT NOW(), add `idx_jobs_stage_entered_at`, wipe `stats_cache`. Enables status-update-date filtering on dashboards/pipeline. |

## Migration Execution

Migrations run via browser URL (no curl needed):

```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v={VERSION}&secret=YOUR_CRON_SECRET
```

**Latest migration:**
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=015&secret=YOUR_CRON_SECRET
```

**Run on BOTH targets** (Vercel + Contabo) — each has its own Postgres:
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=015&secret=YOUR_CRON_SECRET
http://157.173.110.62/api/migrate?v=015&secret=YOUR_CRON_SECRET
```

Replace `YOUR_CRON_SECRET` with the actual value from Vercel Environment Variables. All migrations are idempotent — safe to re-run.

## Task Management API Routes (Milestone 1)

| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/tasks` | Agent+ |
| GET/PATCH/DELETE | `/api/tasks/[id]` | Agent+ / Admin |
| PATCH | `/api/tasks/[id]/move` | Agent+ |
| GET/POST | `/api/tasks/[id]/comments` | Agent+ |
| PATCH/DELETE | `/api/tasks/[id]/comments/[cid]` | Author (60min) / Admin |
| GET | `/api/tasks/[id]/activity` | Agent+ |
| GET/POST | `/api/projects/[id]/columns` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/columns/[cid]` | Admin |
| PATCH | `/api/projects/[id]/columns/reorder` | Admin |
| POST | `/api/v1/webhooks/tasks` | API Key (Bearer) |
| GET/POST | `/api/projects/[id]/custom-fields` | Member+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| PATCH | `/api/projects/[id]/custom-fields/reorder` | Admin |
| GET/POST | `/api/projects/[id]/saved-views` | Member+ / Admin |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Admin |
| GET | `/api/migrate` | CRON_SECRET |
| PUT | `/api/agents/[id]/assign-profiles` | Admin |

### Agent & Profile Management

- **Agent creation**: Admin creates agent via Settings → "Create Agent". Email + random password are auto-generated. Password is hashed with PBKDF2-SHA256 (100k iterations, 16-byte salt, 64-byte key = 128 hex chars). Stored as `salt:hash` in `password_hash` column (TEXT). Plain password shown once in a modal with copy button — never stored.
- **Profile creation**: Admin creates profile via Settings → "Create Profile". Fields: name, unique identifier (used in n8n routing), platform (Upwork/Freelancer/Fiverr/LinkedIn/Other), stack, assigned agent.
- **Agent ↔ Profile assignment**: One agent → many profiles. One profile → only one agent (enforced). Reassignment removes profile from previous agent with confirmation dialog.
- **Bulk assignment**: `PUT /api/agents/[id]/assign-profiles` with `{ profileIds: string[] }` — unassigns profiles not in list, assigns new ones.
- **Dynamic n8n sync**: `GET /api/profiles/mapping` returns profile→agent mapping (`force-dynamic`, no cache). n8n "Process Job" node fetches this via `this.helpers.httpRequest()` on every execution. Admin changes to assignments are reflected in n8n immediately on next job.
- **n8n webhook auto-provisioning**: `POST /api/profiles/sync-n8n` creates webhook + respond nodes in n8n workflow when a new profile is created. Requires `N8N_API_URL` + `N8N_API_KEY` env vars.
- **Webhook URL display**: Settings profile table shows auto-generated webhook URL per profile with copy button (format: `https://ikonicdev.app.n8n.cloud/webhook/<slug>-profile-webhook`).
- **Non-proposal outcome handling**: Dashboard webhook (`/api/webhook/n8n`) gracefully skips non-proposal outcomes (no_profile, rejected, weekend, inactive, duplicate) instead of failing with "Missing job_id".
- **Password hashing**: `hashPassword()` in `actions.ts` uses PBKDF2-SHA256. Format: `<32-hex-salt>:<128-hex-hash>`. Verified by `verifyPassword()` in `auth.ts`.

### n8n Integration Gotchas (CRITICAL)

- **No `fetch()` in Code nodes** — n8n Code nodes run in a sandbox. Use `this.helpers.httpRequest()` instead.
- **Merge node must stay on v3.2** — v3.2 gracefully handles partial inputs (one webhook fires, others ignored); v3 passes through on ANY input causing parallel downstream execution and OOM crashes. Do NOT downgrade to v3.
- **Merge `numberInputs` must equal webhook count** — currently 8 (Sana, Laiba, Khansa, Saim, Shayan, Craig, Rebekah, Nawal).
- **Each Respond node needs a unique Merge input index** — Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6, Nawal=7.
- **`Check Active Hours` weekend + time gate** — the workflow intentionally drops every event outside **Mon–Fri 16:10 → 02:00 Asia/Karachi (PKT)**. On Saturdays and Sundays `getDay()` returns 0 or 6 and the code returns `[]` immediately. Executions with duration <2s that show only `Webhook → Respond → Merge → Check Active Hours` in the preview are **filtered by this gate, not broken**. Do NOT debug "nothing is happening" on weekends without checking this first.
- **Parallel dashboard sinks** — `Format Dashboard Event` fans out to `Send to Dashboard` (Vercel) AND `Send to Self-Hosted Dashboard` (Contabo `157.173.110.62`) in parallel. Both use `neverError: true`. When editing the Format Dashboard Event code, verify both sinks receive the same shape.

### Adding a New Profile/Webhook Node to n8n

When creating a new agent profile webhook in n8n workflow `EWnZg3svZWwcIRs4`, use this blueprint:

**Step 1:** Use `mcp__n8n-mcp__n8n_update_partial_workflow` with these 5 operations:

```
1. addNode: Webhook - {Name}
   - type: n8n-nodes-base.webhook, typeVersion: 2.1
   - parameters: { httpMethod: "POST", path: "{lowercase-name}-profile-webhook", responseMode: "responseNode", options: {} }
   - onError: continueRegularOutput
   - position: [-1408, {previous_y + 224}]  (Rebekah=1136, Nawal=1360, next=1584)

2. addNode: Respond - {Name}
   - type: n8n-nodes-base.respondToWebhook, typeVersion: 1.1
   - parameters: { options: {} }
   - position: [-1216, {same_y_as_webhook}]

3. addConnection: source="Webhook - {Name}", target="Respond - {Name}"

4. addConnection: source="Respond - {Name}", target="Merge All Webhooks", targetIndex={next_index}
   (Current indices: Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6, Nawal=7 → next=8)

5. updateNode: nodeName="Merge All Webhooks", updates: { "parameters.numberInputs": {current + 1} }
   (Currently 8 → next would be 9)
```

**Webhook URL format:** `https://ikonicdev.app.n8n.cloud/webhook/{lowercase-name}-profile-webhook`

**After adding:** Update this section's index list and `numberInputs` count. Also create the profile in dashboard Settings.

### Task Management Key Files

| File | What it does |
|------|-------------|
| `src/lib/task-data.ts` | All task management queries. `getDefaultProject()` auto-creates workspace/project/columns if seed was skipped. Board CRUD, member management, cross-board queries. |
| `src/lib/task-actions.ts` | Server actions: task CRUD, board CRUD, member management + revalidatePath |
| `src/components/tasks/board-header.tsx` | Board toolbar: selector, member avatars, members panel, new task button, rename/delete menu (admin) |
| `src/components/tasks/board-view.tsx` | Horizontal scrolling kanban board; groups tasks by column; per-column "+" button |
| `src/components/tasks/board-column.tsx` | Column with header (color dot, name, WIP count), task cards, empty state |
| `src/components/tasks/task-card.tsx` | Task card: priority badge, assignee avatars, due date, tags, checklist %, counts |
| `src/components/tasks/task-detail-modal.tsx` | Dialog overlay for task detail view — opens on card click instead of navigating |
| `src/components/tasks/task-create-modal.tsx` | Task creation form (title, column, priority, due date, description); supports external trigger from column "+" |
| `src/components/tasks/board-selector.tsx` | Board dropdown with task counts + "New Board" (admin) |
| `src/components/tasks/board-create-dialog.tsx` | Create board dialog (name + description) |
| `src/components/tasks/board-members-panel.tsx` | Slide-out sheet: member list, add/remove/role-change |
| `src/components/tasks/custom-field-renderer.tsx` | Type-specific renderers for 6 field types + compact card display |
| `src/components/tasks/custom-fields-panel.tsx` | Admin slide-out sheet for field CRUD, archive/restore, reorder |
| `src/components/tasks/group-selector.tsx` | Group-by dropdown (status/assignee/priority/label) |
| `src/components/tasks/views-dropdown.tsx` | Saved views popover: load, save, delete |
| `src/components/tasks/custom-field-filter.tsx` | "More Filters" section for custom field conditions |
| `src/app/(dashboard)/tasks/page.tsx` | Admin board page — loads board by `?board=` param, falls back to first/default |
| `src/app/(agent)/my-tasks/page.tsx` | Agent board page — shows first assigned board + cross-board task summary |

### Known Patterns & Gotchas

- **Admin auth**: Admins log in via `ADMIN_CREDENTIALS` env var — they do NOT have a row in `agents` table. Code that queries `agents WHERE role = 'admin'` may find nothing.
- **Agent sidebar detection**: `useNavSections()` uses `pathname.startsWith("/my-")` to show agent nav. All agent routes MUST start with `/my-`.
- **Agent layout**: `(agent)/layout.tsx` renders `<Sidebar>` only. Each agent page includes `<Header title="..." hideFilters />` individually — this shows the top navbar (date picker, theme toggle, user info) without agent/profile filter dropdowns.
- **Auto-seed**: `getDefaultProject()` auto-creates default workspace + project + columns on first access if tables exist but are empty.
- **Board switching**: Admin uses `?board=<id>` URL param + localStorage; agent currently sees only first assigned board (FN-1 audit item).
- **Task creation**: Modal supports external trigger via `triggerOpen` prop + `defaultColumnId` for per-column "+" buttons.
- **Task detail**: Card click opens a modal overlay (`TaskDetailModal`) instead of navigating to `/tasks/[id]`. Direct URL `/tasks/[id]` redirects to `/tasks?task=[id]` which auto-opens the modal.
- **Task create**: "New Task" and column "+" open a full-width create modal with all fields (same layout as detail view).
- **Webhook auto-assignment**: When `_source === "n8n"`, the webhook auto-assigns agent (by name lookup), sets 24h due date, and creates profile + `vollna-auto` tags.
- **Structured fields**: Both create and detail views show editable Job Snapshot (link, budget, skills, posted), Client Intel (location, rating, spent, hires), Routing Info (agent, profile, stack, job ID, generated), and Proposal — all stored in `custom_fields`.
- **Agent header**: All agent pages use `<Header title="..." hideFilters />` — shows date picker, theme toggle, user info, logout. No agent/profile filter dropdowns since data is session-scoped.
- **Member removal**: Uses browser `confirm()` instead of styled dialog (UX-5 audit item); auto-unassigns from tasks.
- **Job-Task status sync**: When a task moves columns → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` to column name. This is the ONLY way job statuses change now.
- **`jobs.status`**: Renamed from `clickup_status` (migration 012). Same values, same queries. Historical data preserved.
- **Legacy ClickUp columns**: `clickup_task_id`, `clickup_task_url` still exist as nullable columns for historical data. Never write to them for new jobs.

### ClickUp Removal (IMPORTANT — for AI/dev agents)

ClickUp integration has been **fully removed** as of Milestone 8. The following no longer exist:

| Removed | Was |
|---------|-----|
| `src/lib/clickup.ts` | ClickUp API client |
| `src/app/api/webhook/clickup/` | ClickUp webhook handler |
| `src/app/api/sync/clickup/` | ClickUp sync endpoint |
| `src/app/api/auth/clickup/` | ClickUp OAuth routes |
| ClickUp cron in `vercel.json` | Daily sync at 00:00 UTC |
| `triggerClickUpSync()` | Server action |
| `triggerClickUpFullSync()` | Server action |

**Rules for future development:**
1. **Never** add ClickUp API calls, webhooks, or sync logic
2. **Never** rely on `clickup_task_id` or `clickup_task_url` for new features — they are legacy
3. **Always** use Task Board as the source of truth for job status
4. Job status changes happen ONLY via Task Board column moves (`moveTaskAction` → `syncJobStatusFromTask`)
5. The `jobs.status` column contains the same values as board column names (e.g., "Proposal Submitted", "In Chat", "Won", "Lost")
6. **Board columns** (14 total): Todo, Proposal Submitted, Proposal Views, Prototype Required, Prototype Done, Prototype Submitted, In Chat, Meeting Scheduled, Meeting Done, Negotiation, Lost, On Hold, N/A, Won
7. **Pipeline Now grouping**: Todo | In Progress (Proposal Submitted, Proposal Views, Prototype Required/Done/Submitted, In Chat, On Hold) | Meetings (Meeting Scheduled/Done) | Negotiation
8. KPI calculations in `data.ts` depend on these exact status strings — if board columns are renamed, update the KPI queries
9. **Dashboard counts derive from the Task Board, not jobs lifecycle milestones.** As of 2026-04-27, `getKPIMetrics`, `getAgentKPIMetrics`, `getPipelineStages`, `getConversionFunnel`, `getEnhancedAgentStats`, and `getEnhancedProfileStats` all count `tasks JOIN columns` (current column = current status), not `jobs.proposal_sent_at IS NOT NULL` style lifecycle milestones. This matches the task board exactly — including manually-created "orphan" tasks that have no job linkage. Date filter uses `COALESCE(j.stage_entered_at, t.updated_at, t.created_at)`. Agent filter uses `task_assignees`. Profile filter uses the linked job's `profile_id`. Win rate is `won / (won + lost)`. Revenue still comes from `jobs.won_value` (orphan tasks have no won_value).

## Key Reference Files

| File | Purpose |
|------|---------|
| `docs/plan.md` | Execution plan with milestones and checklists |
| `docs/cline.md` | Project history, progress tracking, resume instructions |
| `docs/task_board_cases.md` | All cases, subcases & edge cases for Task Board (3 levels deep) — dev scoping and QA |
| `docs/task_board_ui_audit.md` | UI component audit: 12 components, issues (P0/P1/P2), role matrix, recommended fixes |
| `docs/agent-guide/AGENT_USER_GUIDE.md` | End-user guide for agents — features, stats, lifecycle, common misunderstandings |

## Conversation Continuity

**Always read `docs/cline.md` first** in every new conversation. It contains:
- Full project history and decisions
- Milestone progress tracking
- What's been built and what's next
- Tech stack decisions and rationale

Update `docs/cline.md` after completing each feature (status table + detail section).

Execution plan lives in `docs/plan.md` (v3.1, ClickUp removal). Mark items `[x]` as they're completed.

## Git Commits

Do not add `Co-Authored-By` lines to commit messages.
