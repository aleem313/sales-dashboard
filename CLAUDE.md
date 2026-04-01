# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rising Lions Analytics Dashboard — a real-time analytics platform for Upwork job automation. Tracks proposals, win rates, agent performance, and revenue. Data flows in from n8n webhooks (Upwork jobs), Google Sheets imports, and ClickUp task syncs.

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
```

No test framework is configured. There are no unit/integration tests.

## Deployment

Deployed to Vercel via Git push — there is no local dev workflow. All changes must be production-ready. Vercel handles cron jobs (defined in `vercel.json`).

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Database**: Vercel Postgres (Neon) via `@vercel/postgres` — all queries use **raw SQL** (no ORM)
- **Auth**: NextAuth.js v5 (beta.30) with GitHub OAuth + email/password credentials
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Charts**: Recharts

### Route Groups & Roles

Two user roles control access:
- **`admin`** — full access via `(dashboard)/` route group
- **`agent`** — restricted to `(agent)/` route group (`/my-dashboard`, `/my-jobs`, `/my-performance`)

Middleware (`src/middleware.ts`) enforces auth and redirects agents away from admin routes.

### Key Files

| File | What it does |
|------|-------------|
| `src/lib/data.ts` | All database queries (~1700 lines of raw SQL) |
| `src/lib/actions.ts` | Server actions (mutations + `revalidatePath`) |
| `src/lib/auth.ts` | NextAuth config, session callbacks, role logic |
| `src/lib/types.ts` | TypeScript interfaces for all entities |
| `src/lib/seed.ts` | Database schema DDL + seed data |
| `src/lib/clickup.ts` | ClickUp API client |
| `src/lib/sheets.ts` | Google Sheets API client |
| `src/lib/alerts.ts` | Alert thresholds + Slack webhook integration |

### Data Flow

1. **Ingestion**: Vollna (Upwork scraper) → n8n (6 per-agent webhooks) → Claude AI proposal → ClickUp task → `POST /api/webhook/n8n` (HMAC verified) → `jobs` table
2. **ClickUp sync**: ClickUp webhook → `POST /api/webhook/clickup` (HMAC verified) → updates job status/outcome
3. **Daily sync**: Vercel cron 00:00 UTC → `GET /api/sync/clickup` → bulk status/outcome updates
4. **Import**: Manual trigger → `POST /api/sync/sheets` → bulk import from Google Sheets
5. **Caching**: Stats endpoints cache results in `stats_cache` table (5-min TTL)

### n8n Integration

- **Instance**: ikonicdev.app.n8n.cloud (v2.42.3)
- **MCP Server**: Connected (21 tools — can create/update/execute workflows)
- **Active workflow**: "multiple webhooks" (EWnZg3svZWwcIRs4) — 28 nodes, 6 Vollna webhooks per agent (Sana, Laiba, Khansa, Saim, Shayan, Craig) → Claude AI proposals → **dual output** (ClickUp + Custom Board) → Dashboard webhook
- **Webhook payload**: Nested format with `job`, `client`, `routing`, `scores`, `clickup`, `proposal`, `outcome` fields. Normalized by `/api/webhook/n8n` route.
- **Outcome values from n8n**: `proposal_created`, `gpt_error`, `rejected`, `no_profile`, `weekend`, `inactive`

### Dual-Delivery Architecture (n8n → ClickUp + Custom Board)

The n8n workflow delivers processed jobs to **two systems in parallel** after AI proposal generation:

```
Format ClickUp Task
   ├── Create ClickUp Task (existing) → Format Dashboard Event → Send to Dashboard
   └── Create Board Task (NEW) → POST /api/v1/webhooks/tasks
```

- **Parallel execution**: Both branches run independently from "Format ClickUp Task" output
- **Error isolation**: Each branch has `continueOnFail` enabled — ClickUp failure does NOT affect board, board failure does NOT affect ClickUp
- **Board API**: `POST /api/v1/webhooks/tasks` with Bearer token auth (`n8n-board-sync`). Falls back to default project.
- **Payload mapping**: Task title = `[profile] Job Title`, description = rich formatted proposal + job snapshot. Job metadata stored in `custom_fields` (`_job_id`, `_job_url`, `_budget`, `_skills`, `_proposal`, `_assigned_agent`, `_profile_name`, `_source`, client data)
- **Task-Job linking**: `custom_fields._job_id` links board tasks to the `jobs` table, enabling the 3-column task detail view (task fields | job details | proposal)
- **Future**: ClickUp will be removed; only custom board will remain. System designed for easy switchover.

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

## Migration Version History

| Version | File | Milestone | Description |
|---------|------|-----------|-------------|
| 004 | `004_cyberpunk_schema.sql` | — | connects_used, priority, rejection_reason, niche, connects_budget, bonus_earned |
| 005 | `005_agent_passwords.sql` | — | password_hash column + 4 agent passwords |
| 006 | `006_task_management_schema.sql` | M1 | 18 task management tables, 14 indexes, 3 triggers, default seed |

## Migration Execution

Migrations run via browser URL (no curl needed):

```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v={VERSION}&secret=YOUR_CRON_SECRET
```

**Latest migration:**
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=006&secret=YOUR_CRON_SECRET
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

### Task Management Key Files

| File | What it does |
|------|-------------|
| `src/lib/task-data.ts` | All task management queries. `getDefaultProject()` auto-creates workspace/project/columns if seed was skipped. Board CRUD, member management, cross-board queries. |
| `src/lib/task-actions.ts` | Server actions: task CRUD, board CRUD, member management + revalidatePath |
| `src/components/tasks/board-header.tsx` | Board toolbar: selector, member avatars, members panel, new task button, rename/delete menu (admin) |
| `src/components/tasks/board-view.tsx` | Horizontal scrolling kanban board; groups tasks by column; per-column "+" button |
| `src/components/tasks/board-column.tsx` | Column with header (color dot, name, WIP count), task cards, empty state |
| `src/components/tasks/task-card.tsx` | Task card: priority badge, assignee avatars, due date, tags, checklist %, counts |
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
- **Agent layout**: `(agent)/layout.tsx` does NOT render a `<Header>` — each agent page provides its own inline header. Do not add `<Header>` to agent pages.
- **Auto-seed**: `getDefaultProject()` auto-creates default workspace + project + columns on first access if tables exist but are empty.
- **Board switching**: Admin uses `?board=<id>` URL param + localStorage; agent currently sees only first assigned board (FN-1 audit item).
- **Task creation**: Modal supports external trigger via `triggerOpen` prop + `defaultColumnId` for per-column "+" buttons.
- **Member removal**: Uses browser `confirm()` instead of styled dialog (UX-5 audit item); auto-unassigns from tasks.

## Key Reference Files

| File | Purpose |
|------|---------|
| `plan.md` | Execution plan with milestones and checklists |
| `cline.md` | Project history, progress tracking, resume instructions |
| `task_board_cases.md` | All cases, subcases & edge cases for Task Board (3 levels deep) — dev scoping and QA |
| `task_board_ui_audit.md` | UI component audit: 12 components, issues (P0/P1/P2), role matrix, recommended fixes |

## Conversation Continuity

**Always read `cline.md` first** in every new conversation. It contains:
- Full project history and decisions
- Milestone progress tracking
- What's been built and what's next
- Tech stack decisions and rationale

Update `cline.md` after completing each feature (status table + detail section).

Execution plan lives in `plan.md` (v2.0, stack-aligned). Mark items `[x]` as they're completed.

## Git Commits

Do not add `Co-Authored-By` lines to commit messages.
