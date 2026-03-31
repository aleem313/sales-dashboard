# Rising Lion Task Management — Project History & Context

> **Purpose:** Single source of truth for conversation continuity. Read this file first in every new conversation to avoid re-exploring the codebase.
> **Last Updated:** 2026-03-31

---

## Project Overview

Adding a **Task Management Module** (ClickUp-parity Kanban board) to the existing Rising Lions Analytics Dashboard. Full execution plan in `plan.md` (v2.0, stack-aligned).

The existing dashboard is a production Upwork job automation analytics platform. It tracks proposals, win rates, agent performance, and revenue. Data flows from n8n webhooks (Vollna → job scraping), Google Sheets imports, and ClickUp task syncs.

---

## Tech Stack (Actual — from package.json)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5 | |
| Database | Vercel Postgres (Neon) via `@vercel/postgres` | **Raw SQL only, no ORM** |
| Auth | NextAuth v5 (beta.30) | GitHub OAuth + email/password (PBKDF2-SHA256) |
| Styling | Tailwind CSS 4 + shadcn/ui 3.8.5 (Radix 1.4.3) + lucide-react | |
| Charts | Recharts 3.7.0 | |
| Dates | date-fns 4.1.0 | |
| Toasts | sonner 2.0.7 | |
| Themes | next-themes 0.4.6 | |
| External APIs | googleapis 171.4.0 (Google Sheets) | |
| Deployment | Vercel (serverless) — Git push deploys | No local dev workflow |

### NOT yet installed (needed for task management)
| Package | Purpose | Milestone |
|---------|---------|-----------|
| zustand | Client-side state (board store) | M1 |
| @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities | Drag & drop | M2 |
| @vercel/blob | File attachments | M2 |
| @tiptap/* + dompurify | Rich text editing | M2 |
| @upstash/qstash | Outbound webhook delivery | M3 |
| @tanstack/react-virtual | Card list virtualization | M5 |

---

## Existing Codebase Architecture

### Key Files
| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/data.ts` | All DB queries (raw SQL) | ~1700 |
| `src/lib/actions.ts` | Server actions (mutations + revalidatePath) | ~133 |
| `src/lib/auth.ts` | NextAuth config, JWT callbacks, role logic | ~143 |
| `src/lib/types.ts` | TypeScript interfaces | ~341 |
| `src/lib/seed.ts` | DB schema DDL + seed data | ~200 |
| `src/lib/clickup.ts` | ClickUp API client | ~114 |
| `src/lib/sheets.ts` | Google Sheets API client | ~83 |
| `src/lib/alerts.ts` | Alert thresholds + Slack webhooks | ~82 |
| `src/lib/date-utils.ts` | Date range parsing | ~142 |
| `src/lib/utils.ts` | cn(), formatCurrency, formatNumber, etc. | ~53 |
| `src/middleware.ts` | Auth middleware — protects routes | |
| `vercel.json` | Cron: daily ClickUp sync at 00:00 UTC | |

### Existing DB Tables
- `agents` — id, clickup_user_id, name, email, avatar_url, active, role, github_email, password_hash
- `profiles` — id, profile_id, profile_name, stack, vollna_filter_tag, agent_id, clickup_list_id, niche, connects_budget
- `jobs` — id, job_id, job_title, job_url, job_description, budget_*, skills[], client_*, clickup_*, proposal_text, gpt_model, outcome, won_value, connects_used, priority, rejection_reason, stage_entered_at
- `sync_log` — id, source, records_synced, records_updated, errors[], status
- `stats_cache` — id, cache_key, data (JSONB), computed_at, expires_at
- `alerts` — id, alert_type, message, current_value, threshold_value, dismissed
- **Views:** `agent_stats`, `profile_stats`

### Existing Migrations
- `004_cyberpunk_schema.sql` — Added connects_used, priority, rejection_reason, niche, connects_budget, bonus_earned
- `005_agent_passwords.sql` — Added password_hash to agents; pre-populated 4 agent passwords

### Route Groups
- `(dashboard)/` — Admin routes: /dashboard, /agents, /profiles, /jobs, /pipeline, /analytics, /connects, /alerts, /settings, /boards
- `(agent)/` — Agent routes: /my-dashboard, /my-jobs, /my-performance
- `/api/` — webhook/n8n, webhook/clickup, sync/clickup, sync/sheets, stats/*, auth/*, jobs/export, settings/thresholds

### Roles
- **admin** — full access via `(dashboard)/`; redirects agents away
- **agent** — restricted to `(agent)/` routes; session.user has agentId

### Auth Flow
- Credentials provider: email/password with PBKDF2-SHA256 (100k iterations)
- GitHub provider: checks ALLOWED_EMAILS env var
- JWT payload: { role, agentId }
- Agent lookup: by email or github_email in agents table

### Code Patterns (MUST follow)
- Raw SQL with `sql` tagged template — **never** string concatenation
- Server components by default; `"use client"` only for interactivity
- Server actions for all mutations (in `src/lib/actions.ts`) + `revalidatePath()`
- URL search params for filter state, not React state
- `@/*` path alias maps to `./src/*`
- No Co-Authored-By lines in git commits

---

## n8n Integration (CRITICAL — fully mapped)

### Instance
- **URL:** ikonicdev.app.n8n.cloud
- **Version:** 2.42.3 (latest)
- **MCP Server:** Connected — 21 tools (7 doc + 14 management)

### Active Workflows

#### 1. "multiple webhooks" (ID: EWnZg3svZWwcIRs4) — ACTIVE, PRODUCTION
The primary production workflow. 27 nodes.

**Flow:**
```
6 Vollna Webhooks (per agent: Sana, Laiba, Khansa, Saim, Shayan, Craig)
  → Respond immediately to Vollna
  → Merge All Webhooks
  → Check Active Hours (time-based gate)
  → Process Job (normalize/parse)
  → Route Job (Switch — 5 outputs):
      ├── Output 0 (valid job):
      │     → Build GPT Input
      │     → AI Agent - Proposal Writer (Claude Anthropic + Structured Output Parser)
      │     → Merge Proposal with Job Data
      │     → Proposal OK? (If)
      │         ├── Yes → Format ClickUp Task → Create ClickUp Task (HTTP) → Format Dashboard Event → Send to Dashboard
      │         └── No  → Extract Error → Format Dashboard Event → Send to Dashboard
      ├── Output 1 (no_profile) → Format Dashboard Event → Send to Dashboard
      ├── Output 2 (inactive)   → Format Dashboard Event → Send to Dashboard
      ├── Output 3 (duplicate)  → Format Dashboard Event → Send to Dashboard
      └── Output 4 (filtered)   → Format Dashboard Event → Send to Dashboard
```

**Key details:**
- AI model: Claude (Anthropic) via LangChain node with structured output parser
- ClickUp tasks created via HTTP Request (ClickUp API)
- Dashboard events sent via HTTP POST to `/api/webhook/n8n` with HMAC signature

#### 2. "Upwork Outbound Machine v3 — Full Pipeline" (ID: ZfwmIaDv8yZOisPx) — ACTIVE
Single-webhook version. 18 nodes. Similar flow but with single Vollna webhook trigger and AI via HTTP Request (not LangChain agent).

### Inactive but Not Archived (reference)

#### 3. "Upwork Outbound Machine v3 — Full Pipeline" (ID: b9ZmcgSs0re73FgA)
Extended version with Google Sheets profile reading, Heuristic Pre-Filter, AI Relevance Filter (score >= 7), and Google Sheets logging. No dashboard integration. 24 nodes.

#### 4. "UW Proposal Agent - SHK" (ID: IAkstJjIiQomeekh)
Legacy v1: Schedule trigger → Google Sheets config → Apify scraping → Dedup → OpenAI proposal → Google Sheets output. 16 nodes.

#### 5. Other non-archived: CodeRabbit-ClickUp integrations (81zsAQvBS2urB2tI, mv4zjUwznL7PyN93), SHK Backup (zrgTCpTC2nIJO238)

### End-to-End Data Flow

```
Vollna (Upwork scraper)
  → n8n webhooks (6 per-agent endpoints)
  → Job processing + routing
  → Claude AI proposal generation
  → ClickUp task creation (via HTTP API)
  → HTTP POST to /api/webhook/n8n (HMAC signed)
  → Dashboard: upsertJob() → jobs table
  → revalidatePath() busts cache
  → Dashboard UI updates

ClickUp task status changes
  → ClickUp webhook → POST /api/webhook/clickup (HMAC signed)
  → Updates job clickup_status, outcome, proposal_sent_at
  → revalidatePath() busts cache

Daily sync (Vercel cron at 00:00 UTC)
  → GET /api/sync/clickup (CRON_SECRET auth)
  → Fetches all ClickUp tasks, updates statuses/outcomes in bulk

Manual import
  → POST /api/sync/sheets (session auth)
  → Google Sheets → bulk insert/update jobs
```

### n8n → Dashboard Webhook Payload Format
The "Format Dashboard Event" node structures data as:
```json
{
  "job": { "id", "title", "url", "description", "budget", "budgetType", "skills[]", "postedDate" },
  "client": { "country", "rating", "spent", "hires" },
  "routing": { "filterName", "profileName", "assignedAgent", "agentClickupId" },
  "scores": { "aiModel", "aiTokens" },
  "clickup": { "taskId", "taskUrl", "status" },
  "proposal": "...",
  "outcome": "proposal_created" | "gpt_error" | "rejected" | "no_profile" | "weekend" | "inactive"
}
```

Dashboard normalizes this nested format to flat fields via `normalizePayload()` in `/api/webhook/n8n`.

---

## Task Management Module — Current State

### NOTHING IS IMPLEMENTED YET

Previous `cline.md` content was **fabricated** by a prior AI session. Verified on 2026-03-31:

### Milestone 1: Core Foundation — COMPLETE (2026-03-31)

| # | Feature | Status |
|---|---------|--------|
| 1.1 | Database Schema & Migrations | DONE |
| 1.2 | Data Layer — Task & Column Queries | DONE |
| 1.3 | REST API — Tasks & Columns | DONE |
| 1.4 | REST API — Comments & Activity | DONE |
| 1.5 | Server Actions — Task Mutations | DONE |
| 1.6 | Auth & Role Extension | DONE |
| 1.7 | Inbound Webhook Endpoint | DONE |
| 1.8 | Board Page — Static Kanban UI | DONE |
| 1.9 | Task Creation Modal | DONE |
| 1.10 | Loading & Skeleton States | DONE |
| 1.11 | Agent Portal — Task Board | DONE |

### Milestone 1: COMPLETE

### Milestone 1B: Multi-Board & Member Management — COMPLETE (2026-03-31)

| # | Feature | Status |
|---|---------|--------|
| 1B.1 | Board CRUD — Backend | DONE |
| 1B.2 | Board Member Management — Backend | DONE |
| 1B.3 | Board Selector UI | DONE |
| 1B.4 | Board Create/Edit Dialog | DONE |
| 1B.5 | Board Members UI (Settings) | DONE |
| 1B.6 | Agent Board Access Enforcement | DONE |
| 1B.7 | Agent My-Tasks Cross-Board View | DONE |

> Full cases & edge cases: `task_board_cases.md`

### Milestones 2–5: NOT STARTED
See `plan.md` for full breakdown.

---

## Decisions & Architecture Notes

1. **No Socket.io** — Vercel serverless doesn't support persistent WebSocket connections. Using SSE + polling fallback.
2. **No BullMQ/Redis** — Using QStash (Upstash) for outbound webhook delivery. Idempotency uses `stats_cache` table.
3. **No R2** — Using Vercel Blob for file attachments (native integration).
4. **No Docker** — Deploys to Vercel only; no local dev workflow.
5. **Extend existing auth** — Don't redesign NextAuth; add workspace/project claims to JWT.
6. **Raw SQL only** — Follow existing pattern. No ORM, no Prisma, no Drizzle.
7. **plan.md v2.0** — Stack-aligned version created 2026-03-31, replacing v1.0 which had incorrect tech assumptions (Socket.io, BullMQ, R2, Docker).

---

## Resume Instructions

When resuming work:
1. Read this file (`cline.md`) for full context
2. Check `plan.md` for the current milestone's next incomplete `- [ ]` item
3. Start from the first NOT STARTED feature in the milestone table above
4. After completing each feature:
   - Mark `- [x]` in `plan.md`
   - Update status in this file's milestone table
   - Add implementation details to the "What Was Built" section below

---

## What Was Built (Implementation Log)

### Milestone 1 — Core Foundation (completed 2026-03-31)

**New packages:** zustand

**New files created:**

| File | Purpose |
|------|---------|
| `src/lib/migrations/006_task_management_schema.sql` | 18 tables, indexes, 3 triggers (append-only activity_log, single is_done column, auto-update timestamps) |
| `src/lib/migrations/006_task_management_schema_down.sql` | Complete rollback script |
| `src/lib/migrations/run-006.ts` | Migration runner + seeds default workspace, project, columns, members |
| `src/lib/task-data.ts` | All task management queries (~550 lines): CRUD for tasks, columns, comments, checklist, tags, activity log |
| `src/lib/task-actions.ts` | Server actions: createTask, updateTask, moveTask, deleteTask, comments, checklist, assignees, tags |
| `src/app/api/projects/[id]/tasks/route.ts` | GET (list+filter) / POST (create) tasks |
| `src/app/api/tasks/[id]/route.ts` | GET / PATCH / DELETE task |
| `src/app/api/tasks/[id]/move/route.ts` | PATCH move task to column |
| `src/app/api/projects/[id]/columns/route.ts` | GET / POST columns |
| `src/app/api/projects/[id]/columns/[cid]/route.ts` | PATCH / DELETE column |
| `src/app/api/projects/[id]/columns/reorder/route.ts` | PATCH reorder columns |
| `src/app/api/tasks/[id]/comments/route.ts` | GET / POST comments |
| `src/app/api/tasks/[id]/comments/[cid]/route.ts` | PATCH (edit, 60min window) / DELETE (soft delete) |
| `src/app/api/tasks/[id]/activity/route.ts` | GET activity log |
| `src/app/api/v1/webhooks/tasks/route.ts` | POST inbound webhook (Bearer auth, idempotency) |
| `src/components/tasks/task-card.tsx` | Task card with priority, assignees, due date, tags, counts |
| `src/components/tasks/board-column.tsx` | Column with header, WIP indicator, card list |
| `src/components/tasks/board-view.tsx` | Horizontal scrollable board grouping tasks by column |
| `src/components/tasks/task-create-modal.tsx` | Modal: title, column, priority, due date, description |
| `src/app/(dashboard)/tasks/page.tsx` | Admin task board page |
| `src/app/(dashboard)/tasks/loading.tsx` | Skeleton loader |
| `src/app/(agent)/my-tasks/page.tsx` | Agent task board (filtered to assigned tasks) |

**Modified files:**
- `src/middleware.ts` — Added `/tasks/*`, `/my-tasks/*`, `/api/projects/*`, `/api/tasks/*` to auth matcher
- `src/components/layout/sidebar.tsx` — Added "Task Board" (admin) and "My Tasks" (agent) nav items

### Post-Deployment Bugfixes (2026-03-31)

**Issues found after M1 deployment:**
1. "No project found" on Task Board — migration seed skipped because no `role='admin'` row in agents table (admins use env var login)
2. Double header on agent `/my-tasks` page
3. Agent sidebar showing full admin menu on `/my-tasks`
4. Agent nav missing My Jobs, My Performance links

**Fixes applied:**

| File | Change |
|------|--------|
| `src/lib/task-data.ts` | `getDefaultProject()` now auto-creates workspace/project/columns/members on first access if seed was skipped. Falls back to any active agent as owner. |
| `src/app/(agent)/layout.tsx` | Removed layout-level `<Header>` — agent pages have their own inline `<h1>` titles |
| `src/app/(agent)/my-tasks/page.tsx` | Removed duplicate `<Header>` import and render; wrapped in `<div>` instead of `<>` + `<main>` |
| `src/components/layout/sidebar.tsx` | `useNavSections()` simplified to `pathname.startsWith("/my-")` to catch all agent routes. Added My Jobs, My Performance, My Tasks to agent nav. |

### Milestone 1B — Multi-Board & Member Management (completed 2026-03-31)

**No new packages. No migration needed — uses existing M1 schema.**

**New files created:**

| File | Purpose |
|------|---------|
| `src/app/api/projects/route.ts` | GET (list boards) / POST (create board) |
| `src/app/api/projects/[id]/route.ts` | GET / PATCH / DELETE board |
| `src/app/api/projects/[id]/members/route.ts` | GET (list members) / POST (add members) |
| `src/app/api/projects/[id]/members/[agentId]/route.ts` | PATCH (change role) / DELETE (remove member) |
| `src/components/tasks/board-selector.tsx` | Board selector dropdown component |
| `src/components/tasks/board-selector-wrapper.tsx` | Wrapper combining selector + create dialog |
| `src/components/tasks/board-create-dialog.tsx` | Create new board dialog |
| `src/components/tasks/board-members-panel.tsx` | Members slide-out panel (add/remove/role) |

**Modified files:**
- `src/lib/task-data.ts` — Added: `ProjectMember`, `ProjectWithMeta` types; `getAllProjects`, `getUserProjectsWithMeta`, `getProjectById`, `createProject`, `updateProject`, `deleteProject`, `getProjectTaskCount`, `getProjectMembers`, `addProjectMembers`, `updateMemberRole`, `removeProjectMember`, `getAvailableAgents`, `getAgentTasksAcrossBoards`; `deleteColumn` now blocks last column
- `src/lib/task-actions.ts` — Added: `createBoardAction`, `updateBoardAction`, `deleteBoardAction`, `addBoardMembersAction`, `updateMemberRoleAction`, `removeBoardMemberAction`
- `src/app/(dashboard)/tasks/page.tsx` — Rewritten: board selector, member panel, URL-based board switching, empty state
- `src/app/(agent)/my-tasks/page.tsx` — Rewritten: cross-board task view with summary counts
- `src/app/api/projects/[id]/columns/[cid]/route.ts` — Added last-column deletion guard

---

## Migration History

| Version | Date | Milestone | Description |
|---------|------|-----------|-------------|
| 004 | pre-existing | — | Cyberpunk schema: connects_used, priority, niche, bonus_earned |
| 005 | pre-existing | — | Agent password_hash column + 4 PBKDF2 passwords |
| **006** | **2026-03-31** | **M1** | **Task management: 18 tables, 14 indexes, 3 triggers + default seed** |

### Migration 006 Details

**Open in browser to execute:**
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=006&secret=YOUR_CRON_SECRET
```

| Detail | Value |
|--------|-------|
| Tables | 18 (workspaces, projects, project_members, columns, tasks, task_assignees, task_tags, task_tag_map, comments, activity_log, checklist_items, file_attachments, webhook_configs, webhook_event_log, notifications, notification_preferences, saved_views, custom_field_definitions) |
| Indexes | 14 (including GIN on tasks.custom_fields) |
| Triggers | 3 (append-only activity_log, single is_done column, auto-update timestamps) |
| Seed | Workspace "Rising Lion" + Project "Task Board" + 4 columns + all agents as members |
| Idempotent | Yes — `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` |
| Rollback | `src/lib/migrations/006_task_management_schema_down.sql` via Vercel Postgres SQL editor |

---

*Current Phase: Milestone 1B complete — multi-board + member management*
*Next Action: Push to Vercel → verify board switching + member management → then "Start milestone2"*
