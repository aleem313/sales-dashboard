# Rising Lion Task Management — Project History & Context

> **Purpose:** Single source of truth for conversation continuity. Read this file first in every new conversation to avoid re-exploring the codebase.
> **Last Updated:** 2026-04-03

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
> UI component audit: `task_board_ui_audit.md`

### UI Audit Results (2026-03-31)

**12 components audited.** Key findings:

| ID | Priority | Issue | Status |
|----|----------|-------|--------|
| FN-1 | P1 | Agent can't switch boards | **FIXED** — board selector with `/my-tasks` basePath |
| FN-2 | P1 | No assignee picker in task create modal | **FIXED** — multi-select from board members |
| FN-3 | P1 | No column management UI | Open — planned in M4 |
| FN-4 | P1 | No task detail drawer | Open — planned in M2 |
| FN-5 | P1 | No task delete button in UI | Open — planned in M2 |
| FN-6 | P1 | No task editing UI | Open — planned in M2 |
| FN-7 | P2 | Board description never shown | Open — nice to have |
| FN-8 | P1 | Per-column modal inside scroll container | **FIXED** — moved outside |
| SEC-2 | P0 | Unused `isAdmin` prop in board-column | **FIXED** — removed |
| UX-3 | P2 | Board create dialog stale form | **FIXED** — useEffect clears on open |
| UX-5 | P2 | Member removal uses `confirm()` | **FIXED** — styled Dialog with spinner |
| UX-6 | P2 | Skeleton doesn't match header | **FIXED** — 4-column skeleton with header |

**7/12 issues fixed.** 5 remaining are planned for M2/M4.

**Verified working:** Board CRUD flow, board selector (admin + agent), members panel with styled confirm, delete confirmation, task cards, per-column creation with correct modal placement, assignee picker in task create, role-based sidebar, empty states, skeleton loaders.

**Security verified:** Agent access to `/tasks` blocked by dashboard layout redirect. All API routes check `isProjectMember`. Admin-only actions enforced server-side.

### Milestone 2: Board UX, Drag & Drop & Task Detail — COMPLETE (2026-03-31)

| # | Feature | Status |
|---|---------|--------|
| 2.1 | Drag & Drop (@dnd-kit) | DONE |
| 2.2 | Zustand Board Store | DONE |
| 2.3 | Undo Drag Action | DONE |
| 2.4 | Task Detail Drawer | DONE |
| 2.5 | Inline Editing in Drawer | DONE |
| 2.6 | TipTap Rich Text | DEFERRED to M3 |
| 2.7 | Checklist (Sub-Tasks) | PARTIAL (add + progress, no reorder) |
| 2.8 | Activity Log Rendering | DONE |
| 2.9 | File Attachments | DEFERRED to M3 |
| 2.10 | Filter Bar | DONE |
| 2.11 | Performance | DONE (optimistic UI, no formal benchmark) |

### Milestone 3: ClickUp Card UI & Column Management — COMPLETE (2026-03-31)

| # | Feature | Status |
|---|---------|--------|
| 3.1 | Task Card Redesign | DONE (most already existed from M1/M2) |
| 3.2 | Card Context Menu | DONE |
| 3.3 | Column Management UI | DONE (drag reorder deferred) |
| 3.4 | Assignee Dropdown | DONE (already existed from M2) |
| 3.5 | Labels/Tags Enhancement | DONE |
| 3.6 | Start Date Field | DONE (already existed from M2) |
| 3.7 | Time Estimate & Tracking | DONE (already existed from M2) |

### Milestone 4: Task Detail Drawer Enhancements — COMPLETE (2026-03-31)

| # | Feature | Status |
|---|---------|--------|
| 4.1 | Checklist Enhancements | DONE (drag reorder deferred) |
| 4.2 | Share Task (Copy Link) | DONE (full permissions deferred) |
| 4.3 | Rich Text Description (TipTap) | DONE |
| 4.4 | File Attachments (Vercel Blob) | DONE |
| 4.5 | Comment Improvements | DONE (rich text comments deferred) |

### Milestone 5: Custom Fields & Grouping — COMPLETE (2026-04-01)

| # | Feature | Status |
|---|---------|--------|
| 5.1 | Custom Field Backend (data layer, server actions, API routes) | DONE |
| 5.2 | Custom Field Management UI (admin slide-out panel) | DONE |
| 5.3 | Custom Fields in Task UI (drawer + card) | DONE |
| 5.4 | Board Grouping (status, assignee, priority, label) | DONE |
| 5.5 | Advanced Filter System ("More Filters" for custom fields) | DONE |
| 5.6 | Saved Views (load/save/delete) | DONE |

### Milestone 8: ClickUp Removal & Task Board Integration — DONE (pending migration run + n8n update)

| # | Feature | Status |
|---|---------|--------|
| 8.1 | Database Migration (rename clickup_status → status) | DONE (code ready, needs deploy + run) |
| 8.2 | Data Layer Refactor (data.ts SQL queries) | DONE |
| 8.3 | Job-Task Status Sync (moveTask → update job) | DONE |
| 8.4 | Remove ClickUp Routes & Client | DONE |
| 8.5 | Remove ClickUp Server Actions | DONE |
| 8.6 | Update n8n Webhook Handler | DONE |
| 8.7 | Update Profile Mapping API | DONE |
| 8.8 | Frontend Updates | DONE |
| 8.9 | n8n Workflow Update (post-deploy) | SKIPPED (user will test first) |
| 8.10 | Cleanup & Documentation | DONE |

### Agent Dashboard Access + Smart Polling — DONE (2026-04-03)

| # | Feature | Status |
|---|---------|--------|
| 1 | AutoRefresh component (smart polling) | DONE |
| 2 | Analytics data functions agentId filtering | DONE |
| 3 | Middleware role enforcement (agent → /my-*) | DONE |
| 4 | Agent Pipeline page (/my-pipeline) | DONE |
| 5 | Agent Connects page (/my-connects) | DONE |
| 6 | Agent Analytics page (/my-analytics) | DONE |
| 7 | Agent sidebar nav update | DONE |
| 8 | AutoRefresh on all dashboard + task board pages | DONE |

### Milestones 6–7: NOT STARTED (after M8)
See `plan.md` for full breakdown.

---

## Decisions & Architecture Notes

1. **No Socket.io** — Vercel serverless doesn't support persistent WebSocket connections. Using smart polling via `router.refresh()` (5s for task boards, 15s for dashboards).
2. **No BullMQ/Redis** — Using QStash (Upstash) for outbound webhook delivery. Idempotency uses `stats_cache` table.
3. **No R2** — Using Vercel Blob for file attachments (native integration).
4. **No Docker** — Deploys to Vercel only; no local dev workflow.
5. **Extend existing auth** — Don't redesign NextAuth; add workspace/project claims to JWT.
6. **Raw SQL only** — Follow existing pattern. No ORM, no Prisma, no Drizzle.
7. **ClickUp removed (M8, 2026-04-03)**
8. **Smart polling over WebSockets** — Vercel serverless can't hold persistent connections. Using `router.refresh()` at 5s (task boards) / 15s (dashboards). Pauses when tab hidden. Zero infrastructure cost.
9. **Agent data isolation** — Agent pages force `agentId = session.user.agentId` at the server component level. No query param override possible. Middleware redirects agents from admin routes to `/my-dashboard`. All data functions filter by agentId in SQL WHERE clauses. — ClickUp integration fully removed. Task Board is single source of truth for job status. `jobs.status` (renamed from `clickup_status`) is updated by `syncJobStatusFromTask()` when tasks move columns. Legacy columns (`clickup_task_id`, `clickup_task_url`, `clickup_user_id`, `clickup_list_id`) kept as nullable for historical data. Profile mapping API returns `agent_id` instead of `agent_clickup_id`.
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

### Milestone 2 — Board UX, Drag & Drop & Task Detail (completed 2026-03-31)

**New packages:** @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities

**New files created:**

| File | Purpose |
|------|---------|
| `src/lib/stores/board-store.ts` | Zustand store: columns, tasks, members, drag state, filters, optimistic mutations |
| `src/components/tasks/task-detail-drawer.tsx` | Slide-out drawer: inline edit title/status/priority/due/assignees/description, checklist, comments, activity log, delete (admin) |
| `src/components/tasks/board-filter-bar.tsx` | Filter bar: search, column, priority, assignee selects with URL param sync |

**Modified files:**
- `src/components/tasks/board-view.tsx` — Full rewrite: DndContext, DragOverlay, optimistic moves, undo toast, Zustand-filtered task grouping
- `src/components/tasks/board-column.tsx` — Added `useDroppable` for column drop targets, `SortableContext` wrapping, drop highlight ring
- `src/components/tasks/task-card.tsx` — Added `useSortable` wrapper (`SortableTaskCard`), `forwardRef` `TaskCardContent`, drag handle grip icon, `isDragging` opacity
- `src/app/(dashboard)/tasks/page.tsx` — Added TaskDetailDrawer + BoardFilterBar
- `src/app/(agent)/my-tasks/page.tsx` — Added TaskDetailDrawer

---

## Migration History

| Version | Date | Milestone | Description |
|---------|------|-----------|-------------|
| 004 | pre-existing | — | Cyberpunk schema: connects_used, priority, niche, bonus_earned |
| 005 | pre-existing | — | Agent password_hash column + 4 PBKDF2 passwords |
| **006** | **2026-03-31** | **M1** | **Task management: 18 tables, 14 indexes, 3 triggers + default seed** |
| **007** | **pending** | **M2B** | **Fix activity_log trigger: allow DELETE, block only UPDATE** |

### Analysis Session — 2026-03-31 (Post-M2 Deployment)

**Bugs identified:**
1. **Board/task deletion failing** — ROOT CAUSE: `trg_activity_log_append_only` trigger raises EXCEPTION on DELETE, blocking CASCADE deletes. Fix: migration 007 (allow DELETE, block only UPDATE).
2. **Admin restriction issue** — System admin (env-var login) has no `agents` row, so can't be in `project_members`. When all project members demoted to "member", operations relying on project-level admin role fail. Fix: always check `session.user.role === "admin"` as universal override.
3. **Drag handle limitation** — Only grip icon triggers drag, not full card. Fix: apply dnd-kit listeners to entire card div.
4. **Assignee dropdown not ClickUp-like** — Using flat chip toggles instead of searchable popover. Fix: new `AssigneePopover` component with avatar list + search.

**Documents produced:**
- `task_board_cases.md` — Rewritten v2.0 with 10 sections, 4 levels deep, ClickUp-parity coverage
- `plan.md` — Upgraded to v3.0 with 8 milestones (M2B urgent fixes, M3–M7 new features)
- `task_board_fixes.md` — Technical fix guide with code samples for all 5 bugs + UI/UX improvement suggestions

**Milestone 3 completed:** Card context menu, column management UI, labels/tags enhancement

### Milestone 2B — Critical Bug Fixes (completed 2026-03-31)

**New files created:**

| File | Purpose |
|------|---------|
| `src/lib/migrations/007_fix_activity_log_trigger.sql` | Fix trigger: allow DELETE (CASCADE), block only UPDATE |

**Modified files:**

| File | Change |
|------|--------|
| `src/app/api/migrate/route.ts` | Added v=007 support with `run007()` function |
| `src/lib/task-data.ts` | `deleteProject()`: explicit activity_log cleanup before CASCADE; `deleteTask()`: same; `createProject()` + `ensureDefaultProject()`: 13 Upwork statuses instead of 4; removed unused `conditions` variable; max columns → 20 |
| `src/lib/task-actions.ts` | `deleteBoardAction()` + `deleteTaskAction()`: return meaningful error messages |
| `src/components/tasks/task-card.tsx` | Removed GripVertical drag handle; entire card is now draggable via dnd-kit listeners; tags show 3 before overflow |
| `src/components/tasks/task-detail-drawer.tsx` | Added confirmation dialog for task deletion; improved error messages |
| `src/components/tasks/board-header.tsx` | Improved delete error toast with server error message |
| `src/components/tasks/board-members-panel.tsx` | Added "no admin members" warning banner |
| `src/app/api/projects/[id]/columns/route.ts` | Max columns raised from 15 to 20 |

**Deployment note:** After deploying, run migration 007:
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=007&secret=YOUR_CRON_SECRET
```

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

### Milestone 3 — ClickUp Card UI & Column Management (completed 2026-03-31)

**New packages:** (none — uses existing shadcn/ui dropdown-menu added)

**New files created:**

| File | Purpose |
|------|---------|
| `src/components/ui/dropdown-menu.tsx` | shadcn/ui dropdown menu component (Radix) |
| `src/app/api/projects/[id]/tags/route.ts` | GET (list) / POST (create) tags for a project |
| `src/app/api/projects/[id]/tags/[tid]/route.ts` | PATCH (update) / DELETE tag |

**Modified files:**

| File | Change |
|------|--------|
| `src/components/tasks/task-card.tsx` | Added "..." context menu (DropdownMenu) on hover: Edit, Move to (submenu), Copy Link, Delete (admin). New props: columns, isAdmin, onMoveTask, onDeleteTask |
| `src/components/tasks/board-column.tsx` | Full rewrite: admin column header "..." menu (Rename, Color, WIP, Done, Delete), inline rename on double-click, color picker dialog (12 presets), WIP limit dialog, delete-with-move dialog |
| `src/components/tasks/board-view.tsx` | Added column management handlers (updateColumnAction, deleteColumnAction, createColumnAction), "Add Status" inline input at end of columns, context menu move/delete handlers |
| `src/components/tasks/task-detail-drawer.tsx` | Added Labels section: tag chips with remove, "+" dropdown with search + create-new-tag inline, project tag fetching |
| `src/components/tasks/board-filter-bar.tsx` | Added "Label" filter dropdown with project tags |
| `src/lib/stores/board-store.ts` | Added `tag` filter support in filters + getFilteredTasks() |
| `src/lib/task-actions.ts` | Added: createColumnAction, updateColumnAction, deleteColumnAction (with bulk move), reorderColumnsAction, createTagAction, updateTagAction, deleteTagAction, getProjectTagsAction |
| `src/app/(dashboard)/tasks/page.tsx` | Load and pass tags to filter bar, pass isAdmin to BoardView |

---

### Milestone 4 — Task Detail Drawer Enhancements (completed 2026-03-31)

**New packages:** @tiptap/react, @tiptap/starter-kit, @tiptap/extension-link, @tiptap/extension-underline, @tiptap/extension-placeholder, @vercel/blob

**New files created:**

| File | Purpose |
|------|---------|
| `src/components/tasks/rich-text-editor.tsx` | TipTap editor with toolbar (Bold, Italic, Underline, Link, Lists) |
| `src/app/api/tasks/[id]/attachments/route.ts` | GET (list) / POST (upload to Blob) / DELETE (remove from Blob + DB) |

**Modified files:**

| File | Change |
|------|--------|
| `src/lib/task-data.ts` | `getTaskById()` now loads `checklist_items` array (not just stats); added `checklist_items` to Task interface |
| `src/components/tasks/task-detail-drawer.tsx` | Checklist: render items as toggleable checkboxes with delete + bulk paste. Comments: proper bubbles with avatar, edit/delete/reply, (edited) badge. Description: replaced textarea with TipTap RichTextEditor. Attachments: upload/list/download/delete section. Added agentId prop for comment permissions. |
| `src/app/(dashboard)/tasks/page.tsx` | Pass agentId to TaskDetailDrawer |
| `src/app/(agent)/my-tasks/page.tsx` | Pass agentId to TaskDetailDrawer |

---

### Milestone 5 — Custom Fields & Grouping (completed 2026-04-01)

**No new packages. No migration needed — uses existing `custom_field_definitions` table and `tasks.custom_fields` JSONB from migration 006.**

**New files created:**

| File | Purpose |
|------|---------|
| `src/components/tasks/custom-field-renderer.tsx` | Type-specific renderers for all 6 field types (text, number, dropdown, multi-select, date, boolean) + compact card display |
| `src/components/tasks/custom-fields-panel.tsx` | Admin slide-out sheet for field CRUD, archive/restore, reorder |
| `src/components/tasks/group-selector.tsx` | Group-by dropdown (status, assignee, priority, label) with URL sync |
| `src/components/tasks/custom-field-filter.tsx` | "More Filters" expandable section with per-type operators |
| `src/components/tasks/views-dropdown.tsx` | Saved views popover with load/save/delete |
| `src/components/tasks/board-store-initializer.tsx` | Server-to-client hydration for customFields, savedViews, groupBy |

**Modified files:**

| File | Change |
|------|--------|
| `src/lib/stores/board-store.ts` | Added customFields, groupBy, customFieldFilters, savedViews, activeViewId state + getGroupedTasks(), getIsViewModified() + extended getFilteredTasks() with custom field filter operators |
| `src/components/tasks/task-detail-drawer.tsx` | Added custom fields section after Labels with type-specific renderers |
| `src/components/tasks/task-card.tsx` | Added customFields prop, show_on_card compact display |
| `src/components/tasks/board-column.tsx` | Added readOnly prop for non-status grouped view |
| `src/components/tasks/board-view.tsx` | Added grouped view rendering with virtual columns |
| `src/components/tasks/board-header.tsx` | Added GroupSelector, ViewsDropdown, CustomFieldsPanel |
| `src/components/tasks/board-filter-bar.tsx` | Added MoreFilters section, clear also clears custom field filters |
| `src/app/(dashboard)/tasks/page.tsx` | Load customFields + savedViews, pass to all components |
| `src/app/(agent)/my-tasks/page.tsx` | Load customFields, pass to BoardView |

---

### n8n Dual-Delivery Integration (2026-04-01)

**Task:** Extend n8n workflow to send processed jobs to custom board system in parallel with ClickUp.

**What was done:**
- Added "Create Board Task" HTTP Request node to workflow "multiple webhooks" (EWnZg3svZWwcIRs4)
- Node POSTs to `https://sales-dashboard-snowy-beta.vercel.app/api/v1/webhooks/tasks` with Bearer token auth
- Connected in parallel from "Format ClickUp Task" (same output feeds both "Create ClickUp Task" and "Create Board Task")
- `onError: continueRegularOutput` — board failure does not affect ClickUp or dashboard event flow
- `neverError: true` in response options — HTTP errors don't break the workflow
- Workflow now has 28 nodes (was 27)

**Payload mapping (n8n → Board API):**
```json
{
  "title": "$json.taskName",           // "[profile] Job Title"
  "description": "$json.taskDescription", // Rich formatted proposal + job snapshot
  "priority": "medium",
  "custom_fields": {
    "_job_id": "$json.job.id",
    "_job_url": "$json.job.url",
    "_budget": "$json.job.budget",
    "_skills": "$json.job.skills",
    "_proposal": "$json.proposal",
    "_assigned_agent": "$json.assigned_agent",
    "_profile_name": "$json.profile_name",
    "_source": "n8n",
    "_client_country": "$json.job.clientCountry",
    "_client_rating": "$json.job.clientRating",
    "_client_spent": "$json.job.clientSpent",
    "_client_hires": "$json.job.clientHires"
  }
}
```

**Flow architecture (parallel):**
```
Format ClickUp Task
   ├── Create ClickUp Task → Format Dashboard Event → Send to Dashboard (unchanged)
   └── Create Board Task (NEW, independent, continueOnFail)
```

**Auth:** Bearer token `n8n-board-sync`. The webhook endpoint falls back to default project when no matching `webhook_configs` row exists. To target a specific board, add a `webhook_configs` row with `inbound_api_key_hash = SHA256('n8n-board-sync')` pointing to the desired project.

**No code changes to the dashboard codebase.** Existing `/api/v1/webhooks/tasks` endpoint handles everything.

**Future:** When ClickUp is removed, simply disconnect "Create ClickUp Task" node and the dashboard event chain. The board task creation is fully independent.

---

### Board UX Overhaul + Webhook Auto-Assignment (2026-04-01)

**Task:** Auto-assign agents/due dates/labels from n8n, card click opens modal, structured job/client/routing sections, ClickUp-style proposal formatting.

**Changes:**

| File | Change |
|------|--------|
| `src/app/api/v1/webhooks/tasks/route.ts` | Auto-assign agent by name lookup (`agents` table + `project_members` join), auto-set 24h due date for n8n tasks, auto-create/find tags (`_profile_name` + `vollna-auto`) |
| `src/components/tasks/task-detail-modal.tsx` (NEW) | Dialog wrapper for TaskFullView — opens as 95vw x 90vh overlay on card click |
| `src/components/tasks/board-view.tsx` | Card click opens `TaskDetailModal` instead of navigating to `/tasks/[id]`; added `agentId` prop; renders modal in both grouped and normal views |
| `src/components/tasks/task-full-view.tsx` | Added `onClose` prop for modal mode; Back button says "Close" and calls onClose in modal; proposal reads from `custom_fields._proposal` fallback; passes `customFields` to `JobDetails` |
| `src/components/tasks/job-details.tsx` | Restructured into 3 sections: Job Details (link, budget, skills, posted), Client Info (location, rating, total spent, past hires), Routing Info (agent, profile, stack, job ID, generated); reads from `custom_fields` when no linked job |
| `src/components/tasks/proposal-box.tsx` | ClickUp-style formatting: hook headers (--- Hook A ---) rendered as centered dividers, bullets as styled list items, emphasis lines (BUT..., P.S:) bolded, section headers detected; copy button copies raw text only |
| `src/app/(dashboard)/tasks/page.tsx` | Pass `agentId` to `BoardView` |
| `src/app/(agent)/my-tasks/page.tsx` | Pass `agentId` to `BoardView` |

**n8n workflow update:** "Create Board Task" node now sends `due_date` (24h from now), `_stack`, and `_generated` timestamp in `custom_fields`.

**Webhook auto-assignment logic:**
1. Agent: `custom_fields._assigned_agent` → look up by name in `agents` (case-insensitive) + verify `project_members` membership → `assignee_ids`
2. Due date: Auto-set to 24h from now if `_source === "n8n"` and no explicit `due_date`
3. Labels: Auto-create/find tags for `_profile_name` value + `"vollna-auto"` if `_source === "n8n"`

---

### Formal Custom Field Definitions for n8n Data (2026-04-01)

**Task:** Create proper `custom_field_definitions` for Job Details, Client Info, and Routing Info fields so they appear as structured fields on task cards, auto-filled from n8n responses.

**Migration 009** creates 14 custom field definitions in the target project:

| # | Field Name | Group | Show on Card |
|---|------------|-------|--------------|
| 1 | Job Link | Job Details | No |
| 2 | Budget | Job Details | Yes |
| 3 | Skills | Job Details | Yes |
| 4 | Posted | Job Details | No |
| 5 | Location | Client Info | No |
| 6 | Rating | Client Info | No |
| 7 | Total Spent | Client Info | No |
| 8 | Past Hires | Client Info | No |
| 9 | Agent | Routing Info | Yes |
| 10 | Profile | Routing Info | Yes |
| 11 | Stack | Routing Info | No |
| 12 | Job ID | Routing Info | No |
| 13 | Generated | Routing Info | No |
| 14 | Proposal | Proposal | No |

**Webhook mapping:** When `_source === "n8n"`, the webhook looks up field definition IDs by name and maps n8n underscore-prefixed data (`_job_url` → "Job Link", `_budget` → "Budget", etc.) to formal field IDs. Values are stored as `custom_fields[fieldDefId] = value` so the existing `CustomFieldRenderer` displays them automatically.

**Run migration:**
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=009&secret=YOUR_CRON_SECRET
```

---

### Boosted Connects Field (2026-04-01)

Added "Boosted Connects" (⚡) field to task detail view, create task form, and migration 009 (position 14, type `number`).

### Full-Width Create Task Modal with All Fields (2026-04-01)

**Task:** Update create task form to show all fields matching task detail view, and open as modal.

| File | Change |
|------|--------|
| `src/components/tasks/task-create-full.tsx` | Added: Start Date, Labels/Tags with create-new, Time Estimate, Time Tracked, Connects, Boosted Connects, assignee search dropdown. Column 2 shows editable Job Snapshot / Client Intel / Routing Info fields. Column 3 shows editable Proposal textarea. All values saved to `custom_fields`. Linking a job auto-fills all fields. Added `onClose` prop for modal mode. |
| `src/components/tasks/task-create-modal.tsx` | Rewritten: full-width 95vw×90vh dialog wrapping `TaskCreateFull` |
| `src/components/tasks/new-task-button.tsx` (NEW) | Client component: "New Task" button + `TaskCreateModal` for server component pages |
| `src/components/tasks/board-view.tsx` | Column "+" opens create modal instead of navigating. Added `TaskCreateModal` to both grouped and normal views. |
| `src/components/tasks/board-header.tsx` | "New Task" button opens create modal via internal state + `TaskCreateModal` |
| `src/app/(agent)/my-tasks/page.tsx` | Uses `NewTaskButton` instead of `<a>` link for "New Task" |

### Agent Header with Scoped Filters (2026-04-01)

Added `<Header>` to agent my-tasks page with agent-scoped data:
- Agent dropdown: only their own name
- Profile dropdown: only profiles assigned to them
- Date range, timezone, dark/light mode all available

| File | Change |
|------|--------|
| `src/app/(agent)/my-tasks/page.tsx` | Added `<Header>` with agent's own data from `getAgentById()`. Agent sees only themselves in agent filter and their assigned profiles. |

### Direct URL → Modal Redirect (2026-04-01)

| File | Change |
|------|--------|
| `src/app/(dashboard)/tasks/[id]/page.tsx` | Replaced full-page view with `redirect('/tasks?board=X&task=id')` |
| `src/app/(agent)/my-tasks/[id]/page.tsx` | Same: redirects to `/my-tasks?board=X&task=id` |
| `src/components/tasks/board-view.tsx` | Reads `?task=` param on mount, auto-opens detail modal, cleans URL |
| `src/components/tasks/task-full-view.tsx` | "Copy link" generates `?task=` URL format instead of `/tasks/[id]` |

### Editable Structured Fields in Task Detail Modal (2026-04-01)

| File | Change |
|------|--------|
| `src/components/tasks/task-full-view.tsx` | Replaced `JobDetails` component in column 2 with editable structured fields (Job Snapshot, Client Intel, Routing Info) reading from/writing to `custom_fields`. Proposal column is now editable with auto-save. |

---

### Agent & Profile Management System (2026-04-02)

**Task:** Full agent creation with auto-credentials, profile management with platform field, one-profile-one-agent enforcement, bulk assignment API.

**New files created:**

| File | Purpose |
|------|---------|
| `src/lib/migrations/010_profile_platform.sql` | Add `platform` column to profiles (default: 'Upwork') |
| `src/app/api/agents/[id]/assign-profiles/route.ts` | PUT bulk profile assignment (admin-only) |

**Modified files:**

| File | Change |
|------|--------|
| `src/lib/data.ts` | `createAgent()` now accepts `password_hash`, auto-generates `clickup_user_id` if not provided. Added `getAgentByEmailExists()` for duplicate check. `createProfile()` accepts `platform` field. |
| `src/lib/actions.ts` | Added `hashPassword()` (PBKDF2-SHA256, 16-byte salt, 64-byte key = 128 hex chars) and `generatePassword()` (12-char random). `createAgentAction()` now generates credentials and returns them once. Added `assignProfilesToAgentAction()` for bulk assignment. Profile assignment revalidates `/agents`. |
| `src/lib/types.ts` | Added `platform` field to `Profile` interface |
| `src/components/settings/agent-management.tsx` | Rewritten: "Create Agent" dialog (name + email only), credentials modal with copy buttons (shown once after creation), agent table shows assigned profiles as badges and login status |
| `src/components/settings/profile-management.tsx` | Rewritten: "Create Profile" dialog with platform selector (Upwork/Freelancer/Fiverr/LinkedIn/Other), unique identifier field, reassignment confirmation dialog. Profile table shows platform badge and profile_id. |
| `src/app/(dashboard)/settings/page.tsx` | Passes `profiles` to `AgentManagement` component |
| `src/app/api/migrate/route.ts` | Added migration v=010 support |

**Password hashing:**
- Algorithm: PBKDF2-SHA256, 100k iterations
- Salt: 16 bytes (32 hex chars)
- Key: 64 bytes (128 hex chars)
- Format: `<salt>:<hash>` (161 chars total)
- Compatible with existing `verifyPassword()` in `auth.ts`

**Agent creation flow:**
1. Admin enters name + email in "Create Agent" dialog
2. Server generates 12-char random password
3. Password hashed with PBKDF2-SHA256 (128 hex char hash)
4. Agent created in DB with hash
5. Credentials modal shown once with email + plain password + copy buttons
6. Plain password never stored

**Profile assignment rules:**
- One agent → many profiles (supported)
- One profile → only one agent (enforced)
- Reassignment shows confirmation dialog before removing from previous agent

**Migration 010:** Run after deploying:
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=010&secret=YOUR_CRON_SECRET
```

### Dynamic n8n Profile Sync (2026-04-02)

**Task:** When admin assigns/reassigns profiles to agents in the dashboard, automatically reflect changes in n8n routing — without manual n8n edits.

**Approach:** Pull model — n8n fetches mapping from dashboard API on every execution.

**New files created:**

| File | Purpose |
|------|---------|
| `src/app/api/profiles/mapping/route.ts` | Public GET endpoint returning profile→agent mapping as JSON. `force-dynamic` (no cache). |
| `src/app/api/profiles/sync-n8n/route.ts` | POST endpoint that auto-creates webhook + respond nodes in n8n when a new profile is created. Requires `N8N_API_URL` + `N8N_API_KEY` env vars. |
| `src/components/agents/create-agent-button.tsx` | Reusable "Create Agent" button with credentials modal (used on /agents page) |
| `src/components/profiles/create-profile-button.tsx` | Reusable "Create Profile" button (used on /profiles page) |

**n8n workflow changes (workflow `EWnZg3svZWwcIRs4`, 30 nodes):**
- Updated "Process Job" node: removed hardcoded `PROFILES` map, now fetches from dashboard API using `this.helpers.httpRequest()` (NOT `fetch()` — n8n Code nodes run in a sandbox without the global `fetch` API)
- `PATH_TO_PROFILE` built dynamically from API response keys (pattern: `<lowercase-name>-profile-webhook`)
- Added "Webhook - Rebekah" + "Respond - Rebekah" nodes
- Merge All Webhooks: `numberInputs: 7`, **must stay on typeVersion 3** (v3.2 breaks multi-input passthrough — waits for ALL inputs instead of passing ANY)
- Respond connections: each on a dedicated index (Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6)
- All webhook nodes have `onError: continueRegularOutput`

**Critical n8n gotchas discovered:**
1. **No `fetch()` in Code nodes** — use `this.helpers.httpRequest()` instead
2. **Merge node v3 vs v3.2** — v3.2 waits for ALL inputs; v3 passes through on ANY input. Do NOT upgrade the Merge node.
3. **Merge `numberInputs` must match webhook count** — if you add a new webhook, increment `numberInputs`
4. **Each Respond node needs a unique Merge input index** — don't share indices

**API response format:**
```json
{
  "Sana": { "assigned_agent": "Mubashir", "agent_clickup_id": "107686249", "profile_id": "sana", "stack": "", "clickup_list_id": "" },
  "Rebekah": { "assigned_agent": "Abu Bakher", ... },
  ...
}
```

**How it works (verified working in production):**
1. Admin changes profile assignment in dashboard → DB updated immediately
2. Next Vollna job triggers n8n webhook → "Process Job" calls `this.helpers.httpRequest()` to `GET /api/profiles/mapping`
3. API returns live DB state (no cache — `force-dynamic`)
4. Job routed to correct agent based on current mapping
5. Full pipeline executes: Process Job → Route Job → Build GPT Input → AI Agent → ClickUp + Dashboard

**Dashboard webhook fix:**
- Non-proposal outcomes (no_profile, rejected, weekend, inactive, duplicate) now return `{ ok: true, skipped: true }` instead of failing with "Missing job_id"
- Settings page shows webhook URL per profile with copy button
- Settings link added to admin sidebar

---

### n8n Debugging Session (2026-04-02)

**Issues found and fixed during n8n integration:**

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | `fetch is not defined` | n8n Code nodes run in sandbox without global `fetch` | Changed to `this.helpers.httpRequest()` |
| 2 | Merge node blocking all data | Autofix upgraded Merge from v3 to v3.2 (different behavior) | Reverted to v3 |
| 3 | Merge input index overflow | Respond nodes connected to indices 2-5, but Merge only had 2 inputs configured | Set `numberInputs: 7`, restored original indices 0-6 |
| 4 | Duplicate Merge connections | Failed partial updates left duplicate connections | Removed duplicates, clean re-add |
| 5 | Dashboard sync showing "failed" | Non-proposal n8n outcomes (no_profile etc.) had no job_id | Skip gracefully with `{ ok: true, skipped: true }` |
| 6 | Profile mapping API returning stale data | `revalidate = 60` ISR cache | Changed to `dynamic = "force-dynamic"` |

---

### Task Board Enhancements — Filters, Visibility & Reason Field (2026-04-03)

**Task:** Improve agent board UX, fix unassigned task visibility, add conditional Reason field for N/A status.

**Modified files:**

| File | Change |
|------|--------|
| `src/app/(agent)/my-tasks/page.tsx` | Added `BoardFilterBar` so agents can use all filters (search, column, priority, assignee, labels, custom fields). Now loads tags + saved views. Uses updated `getAgentTasksAcrossBoards(agentId, projectId)`. |
| `src/lib/task-data.ts` | `getAgentTasksAcrossBoards()` now returns unassigned tasks (no assignees) scoped to current project, in addition to agent's own tasks. New signature: `(agentId, currentProjectId?)`. |
| `src/components/tasks/task-full-view.tsx` | Added conditional `ReasonMultiSelect` field below Boosted Connects — visible only when column name is "N/A". 14 checkbox options stored as `_reason` array in `custom_fields`. Removed duplicate "Custom Fields" section (fields already shown in dedicated sections). |
| `src/components/tasks/custom-field-filter.tsx` | Injected virtual "Reason" field (`_reason`, type `multi_select`) into "More Filters". Added `MultiSelectFilterValue` popover component for proper multi-select value picking. Works with existing `contains_any`/`contains_all` operators. |

**Reason field options:** Old job, Duplicate, Location loc, Low Higher rate, Language barrier, Too many invites, Video Proposal, Client suspended, Portfolio unavailable, Client Low spending, Bad rating client, Job unavailable, Already hired, Out of stack

**Unassigned task logic:** `showTask = task.assignee === currentUser.id || task.assignee === null` — tasks with no assignees visible to all agents on that board.

---

## Architectural Shift: ClickUp → Internal Task Board (2026-04-03)

### Reason for Change

ClickUp was the original external task management system used to track Upwork job proposals through their lifecycle (Proposal Ready → Sent → Following Up → Won/Lost). With the completion of Milestones 1–5, the internal Task Board now provides full ClickUp-parity functionality:

- Kanban board with 13 Upwork-specific columns (matching ClickUp statuses)
- Custom fields for all job metadata (Job Details, Client Info, Routing Info, Proposal)
- n8n dual-delivery already creates tasks on both ClickUp and the internal board
- Drag-and-drop, filters, grouping, saved views, comments, activity log — all built

**ClickUp is now redundant.** Maintaining two parallel systems (ClickUp + Task Board) creates sync complexity, dual-write risks, and unnecessary API dependency. The Task Board is the future.

### High-Level Flow Comparison

**BEFORE (ClickUp-dependent):**
```
Vollna → n8n → Create ClickUp Task → Format Dashboard Event → POST /api/webhook/n8n
                                                                     ↓
                                                            jobs table (clickup_status)
                                                                     ↓
ClickUp status change → POST /api/webhook/clickup → UPDATE jobs.clickup_status
                                                                     ↓
Daily cron → GET /api/sync/clickup → bulk UPDATE jobs.clickup_status
                                                                     ↓
Dashboard metrics ← SQL queries on jobs.clickup_status
```

**AFTER (Task Board only):**
```
Vollna → n8n → Create Board Task → POST /api/v1/webhooks/tasks
                                         ↓
                                   tasks table (column_id)
                                         ↓
Board column move (drag/drop) → moveTaskAction() → syncJobStatusFromTask()
                                                          ↓
                                                   UPDATE jobs.status
                                                          ↓
Dashboard metrics ← SQL queries on jobs.status (same values, renamed column)
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Job status source | `jobs.clickup_status` (from ClickUp API) | `jobs.status` (from Task Board column) |
| Status updates | ClickUp webhook + daily cron sync | Task Board column move → server action |
| n8n output | ClickUp task + Board task (dual) | Board task only |
| API client | `src/lib/clickup.ts` (ClickUp REST API) | Deleted — no external API |
| Sync routes | `/api/sync/clickup`, `/api/webhook/clickup` | Deleted — not needed |
| OAuth | `/api/auth/clickup/*` | Deleted — no ClickUp auth |
| Cron | Daily ClickUp sync at 00:00 UTC | Removed — board is real-time |
| Profile mapping | Returns `clickup_list_id`, `agent_clickup_id` | Returns `agent_id` only |

### What Stays the Same

- `jobs` table structure (column renamed, data preserved)
- KPI calculation logic (same SQL, different column name)
- n8n → Dashboard webhook (`/api/webhook/n8n`) — still works
- Google Sheets sync — completely independent
- Agent stats, profile stats — same queries
- All dashboard pages — same data, same UI

### Impacted Modules

| Module | Impact Level | Changes Required |
|--------|-------------|-----------------|
| `src/lib/data.ts` | High | ~20 SQL replacements (`clickup_status` → `status`) |
| `src/lib/actions.ts` | Medium | Remove 3 ClickUp actions, modify 1 |
| `src/lib/types.ts` | Medium | Rename fields, mark legacy as optional |
| `src/lib/task-actions.ts` | Medium | Add job-status sync to `moveTaskAction()` |
| `src/lib/task-data.ts` | Low | Add `syncJobStatusFromTask()` helper |
| `src/lib/clickup.ts` | Deleted | Entire file removed |
| API routes | High | 5 route files deleted, 3 modified |
| Frontend components | Medium | ~6 components updated (column name change) |
| `vercel.json` | Low | Remove 1 cron entry |
| n8n workflow | Medium | Remove ClickUp node, rewire dashboard event |

### Migration Notes

- **No data migration** — `ALTER TABLE RENAME COLUMN` preserves all historical data
- **Rollback** — Single `git revert` + `ALTER TABLE RENAME COLUMN` back
- **Zero downtime** — Column rename is atomic, no data rewrite
- **Historical ClickUp data** — `clickup_task_id`, `clickup_task_url` columns preserved as nullable legacy
- **n8n timing** — Dashboard code deployed first; n8n workflow updated second. `continueOnFail` on ClickUp node prevents breakage during gap.

### Milestone 8 in plan.md

Full implementation checklist added as Milestone 8 in `plan.md` (10 sub-milestones, ~45 checklist items). Priority order updated: **M8 (ClickUp removal) → M6 → M7**.

---

### n8n Nawal Profile Node (2026-04-03)

**Task:** Add Nawal webhook + respond nodes to n8n workflow.

**n8n workflow update (EWnZg3svZWwcIRs4, now 32 nodes):**
- Added "Webhook - Nawal" (POST, path: `nawal-profile-webhook`, responseMode: responseNode)
- Added "Respond - Nawal" (typeVersion 1.1)
- Connected: Webhook → Respond → Merge All Webhooks (input index 7)
- Updated Merge `numberInputs`: 7 → 8
- Position: [-1408, 1360] (below Rebekah at [-1408, 1136])

**Webhook URL:** `https://ikonicdev.app.n8n.cloud/webhook/nawal-profile-webhook`

**Updated Merge input indices:** Sana=0, Laiba=1, Khansa=2, Saim=3, Shayan=4, Craig=5, Rebekah=6, Nawal=7

---

*Current Phase: Board UX enhancements complete, n8n Nawal profile added*
*Next Action: Create Nawal profile in dashboard Settings and assign to agent*
