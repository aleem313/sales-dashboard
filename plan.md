# Rising Lion — Task Management Module
## Execution Plan v3.0 (ClickUp-Parity Restructure)

> **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5 · next-auth v5 (beta.30) · @vercel/postgres (raw SQL, no ORM) · Recharts · Radix UI · shadcn/ui · Tailwind CSS v4 · lucide-react · date-fns · react-day-picker · sonner · next-themes · clsx · tailwind-merge · ESLint 9
> **Deployment:** Vercel (serverless) — no local dev workflow; all changes must be production-ready
> **Realtime:** Server-Sent Events (SSE) — Vercel does not support persistent WebSocket connections
> **Background Jobs:** Vercel Cron + QStash (Upstash) for async job processing
> **File Storage:** Vercel Blob for attachments
> **State Management:** Zustand (installed)
> **Drag & Drop:** @dnd-kit (installed)
> **Rich Text:** TipTap (to be installed)
> **Timeline:** 8 milestones (M1–M2 complete, M2B–M7 new)
> **Cases & Edge Cases:** `task_board_cases.md` v2.0

---

## Prerequisites: New Dependencies

Before starting Milestone 1, install these packages:

- [x] `npm i zustand @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` (installed)
- [ ] `npm i @vercel/blob` (file attachments — Milestone 2)
- [ ] `npm i @tiptap/react @tiptap/starter-kit @tiptap/extension-mention @tiptap/extension-link @tiptap/extension-underline @tiptap/extension-placeholder dompurify` (rich text — Milestone 2)
- [ ] `npm i @upstash/qstash` (outbound webhooks — Milestone 3)
- [ ] `npm i @tanstack/react-virtual` (virtualization — Milestone 4)

---

## Milestone 1: Core Foundation (Sprint 1)
> Theme: Database schema, REST API routes, auth extension, webhook intake, static board UI.

### 1.1 Database Schema & Migrations

> **Pattern:** Raw SQL migrations in `src/lib/migrations/`. Use `@vercel/postgres` `sql` tagged template. No ORM.
> **Integration:** New tables coexist with existing `agents`, `profiles`, `jobs`, `sync_log`, `stats_cache`, `alerts` tables. The `agents` table is reused for user identity (already has `id`, `name`, `email`, `role`).

- [x] Create migration `006_task_management_schema.sql` with all new tables:
  - `workspaces` — id (UUID PK), name, slug (UNIQUE), owner_id (FK→agents), created_at
  - `projects` — id (UUID PK), workspace_id (FK→workspaces), name, description, created_at, updated_at
  - `project_members` — project_id + agent_id composite PK, role ('admin'|'member'), joined_at
  - `columns` — id (UUID PK), project_id (FK→projects), name, position (INTEGER, gap-based step 1000), color (VARCHAR 7, hex), is_done (BOOLEAN default false), wip_limit (INTEGER nullable), created_at
  - `tasks` — id (UUID PK), project_id (FK→projects), column_id (FK→columns), title (TEXT NOT NULL), description (TEXT), priority ('urgent'|'high'|'medium'|'low'|NULL), position (INTEGER, gap-based step 1000), creator_id (FK→agents), custom_fields (JSONB default '{}'), created_at, updated_at
  - `task_assignees` — task_id + agent_id composite PK (many-to-many)
  - `task_tags` — id (UUID PK), project_id (FK→projects), name (TEXT), color (VARCHAR 7)
  - `task_tag_map` — task_id + tag_id composite PK
  - `comments` — id (UUID PK), task_id (FK→tasks), author_id (FK→agents), parent_id (FK→comments, nullable, max 1 level deep), body (TEXT), created_at, updated_at, deleted_at (TIMESTAMPTZ nullable, soft delete)
  - `activity_log` — id (UUID PK), task_id (FK→tasks), actor_id (FK→agents, nullable), actor_label (TEXT default 'System'), action_type (TEXT), field (TEXT nullable), old_value (TEXT nullable), new_value (TEXT nullable), metadata (JSONB), created_at (TIMESTAMPTZ default NOW())
  - `checklist_items` — id (UUID PK), task_id (FK→tasks), title (TEXT), is_checked (BOOLEAN default false), position (INTEGER), created_at
  - `file_attachments` — id (UUID PK), task_id (FK→tasks), filename (TEXT), url (TEXT), blob_path (TEXT), size_bytes (INTEGER), mime_type (TEXT), thumbnail_url (TEXT nullable), uploader_id (FK→agents), created_at
  - `webhook_configs` — id (UUID PK), project_id (FK→projects), inbound_api_key_hash (TEXT), field_map (JSONB default '{}'), outbound_url (TEXT nullable), outbound_secret (TEXT nullable), outbound_events (TEXT[] default '{}'), active (BOOLEAN default true), created_at
  - `webhook_event_log` — id (UUID PK), project_id (FK→projects), direction ('inbound'|'outbound'), event_type (TEXT), status_code (INTEGER), payload (JSONB), error (TEXT nullable), created_at
  - `notifications` — id (UUID PK), user_id (FK→agents), type (TEXT), title (TEXT), body (TEXT), link (TEXT nullable), read (BOOLEAN default false), created_at
  - `notification_preferences` — user_id + notification_type composite PK, in_app (BOOLEAN default true), email (BOOLEAN default true)
  - `saved_views` — id (UUID PK), project_id (FK→projects), owner_id (FK→agents), name (TEXT), filters (JSONB), sort (JSONB), shared (BOOLEAN default false), created_at
  - `custom_field_definitions` — id (UUID PK), project_id (FK→projects), name (TEXT), field_type ('text'|'number'|'dropdown'|'multi_select'|'date'|'boolean'), options (JSONB nullable), required (BOOLEAN default false), position (INTEGER), archived (BOOLEAN default false), show_on_card (BOOLEAN default false), created_at
- [x] Add JSONB GIN index on `tasks.custom_fields`
- [x] Add index on `tasks(column_id, position)`, `tasks(project_id)`, `activity_log(task_id, created_at DESC)`, `notifications(user_id, read, created_at DESC)`, `comments(task_id, created_at)`
- [x] Add UNIQUE constraint on `columns(project_id, name)`
- [x] Add CHECK constraint: only one `is_done` column per project (enforced via trigger or application logic)
- [x] Enforce append-only on `activity_log` via `BEFORE UPDATE OR DELETE` trigger returning `NULL`
- [x] Write `006_task_management_schema_down.sql` rollback script
- [x] Create migration runner `src/lib/migrations/run-006.ts` (pattern from existing `run-004.ts`)

### 1.2 Data Layer — Task & Column Queries

> **Pattern:** Add functions to `src/lib/data.ts` (or create `src/lib/task-data.ts` if data.ts is too large). Raw SQL with `sql` tagged template.

- [x] `getProjectColumns(projectId)` → Column[] ordered by position
- [x] `getProjectTasks(projectId, filters?)` → Task[] with assignees, tags, checklist progress; supports filter/sort query params
- [x] `getTaskById(taskId)` → full task with assignees, tags, checklist items, custom fields
- [x] `createTask(data)` → Task (auto-assign position = max_position + 1000 in target column)
- [x] `updateTask(taskId, fields)` → Task (partial update)
- [x] `moveTask(taskId, columnId, position)` → Task (status change + activity log entry)
- [x] `deleteTask(taskId)` → void (admin only check at route level)
- [x] `createColumn(projectId, name)` / `updateColumn(columnId, fields)` / `deleteColumn(columnId)` / `reorderColumns(projectId, orderedIds[])`
- [x] `getTaskActivity(taskId)` → ActivityLog[]
- [x] `logActivity(taskId, actorId, actionType, field?, oldValue?, newValue?, metadata?)` — helper used by all mutations

### 1.3 REST API — Tasks & Columns (Route Handlers)

> **Pattern:** Next.js Route Handlers in `src/app/api/tasks/` and `src/app/api/projects/`. Auth via `getServerSession()` or `auth()` from NextAuth. Return JSON. Validate with inline checks (Zod optional).

- [x] `GET /api/projects/[id]/tasks` — list with filter/sort query params; auth required
- [x] `POST /api/projects/[id]/tasks` — create task; validate required fields; return 422 on violations
- [x] `GET /api/tasks/[id]` — full task detail with assignees, tags, checklist, custom fields
- [x] `PATCH /api/tasks/[id]` — update task fields; log activity for each changed field
- [x] `DELETE /api/tasks/[id]` — admin only; return 403 for agent role
- [x] `PATCH /api/tasks/[id]/move` — move task to column + position; log status change
- [x] `GET /api/projects/[id]/columns` — list columns
- [x] `POST /api/projects/[id]/columns` — create column (admin only); enforce max 15
- [x] `PATCH /api/projects/[id]/columns/[cid]` — update column name/color/wip_limit
- [x] `PATCH /api/projects/[id]/columns/reorder` — reorder columns; body: `{ orderedIds: string[] }`
- [x] `DELETE /api/projects/[id]/columns/[cid]` — blocked if column has tasks (409); admin only

### 1.4 REST API — Comments & Activity

- [x] `GET /api/tasks/[id]/comments` — list comments with author info, ordered chronologically
- [x] `POST /api/tasks/[id]/comments` — create comment (top-level or reply via `parent_id`); log activity
- [x] `DELETE /api/tasks/[id]/comments/[cid]` — soft delete (author within 60min or admin); replace body with "[deleted]"
- [x] `PATCH /api/tasks/[id]/comments/[cid]` — edit comment (author within 60min only); mark `(edited)`
- [x] `GET /api/tasks/[id]/activity` — append-only activity log; supports "comments only" filter

### 1.5 Server Actions — Task Mutations

> **Pattern:** Add to `src/lib/actions.ts` or create `src/lib/task-actions.ts`. Use `revalidatePath()` after mutations. These are used by UI components directly.

- [x] `createTaskAction(formData)` — server action for task creation form
- [x] `updateTaskAction(taskId, fields)` — server action for inline edits
- [x] `moveTaskAction(taskId, columnId, position)` — server action for drag-drop
- [x] `deleteTaskAction(taskId)` — server action with admin check
- [x] `createCommentAction(taskId, body, parentId?)` — server action for comments
- [x] `toggleChecklistItemAction(itemId, checked)` — server action for checklist

### 1.6 Authentication & Role Extension

> **Integration:** Extend existing NextAuth config in `src/lib/auth.ts`. Do NOT redesign auth — the current JWT + session callback pattern works.

- [x] Extend JWT payload with `workspaceId` claim (default workspace assigned on first login)
- [x] Add project-level role check helper: `requireProjectAccess(projectId, session)` — verifies membership in `project_members` (implemented as `isProjectMember()` + `getProjectMemberRole()` in task-data.ts)
- [x] Extend middleware matcher in `src/middleware.ts` to protect `/tasks/*`, `/projects/*`, `/api/projects/*`, `/api/tasks/*`
- [x] Return 401 for unauthenticated; 403 with `{ error, required_role }` for insufficient permissions
- [x] Auto-create default workspace + project for existing agents on first access (migration seed in run-006.ts)

### 1.7 Inbound Webhook Endpoint

> **Pattern:** Public route with API key auth (like existing `/api/webhook/n8n` HMAC pattern).

- [x] `POST /api/v1/webhooks/tasks` — Bearer token auth (API key from `webhook_configs.inbound_api_key_hash`, SHA256 verified)
- [x] Accept payload: `{ title, column_id?, priority?, assignee_ids[]?, due_date?, tags[]?, custom_fields?: {} }`
- [x] Idempotency: `Idempotency-Key` header; store in `stats_cache` table with 24h TTL (reuse existing cache pattern, no Redis needed)
- [x] Validate payload; return 422 with field-level errors; log to `webhook_event_log`
- [x] Title required; column_id defaults to first column if omitted; invalid column_id returns 422 with valid options

### 1.8 Board Page — Static Kanban UI

> **Pattern:** Server component page at `src/app/(dashboard)/tasks/page.tsx`. Board shell fetches data server-side. Card components are client where needed.

- [x] Create route group: `src/app/(dashboard)/tasks/` with `page.tsx` and `loading.tsx`
- [x] Board shell (server component): fetch columns + tasks from API; render horizontal flex layout (280px columns, overflow-x-auto)
- [x] Task card component (`src/components/tasks/task-card.tsx`): title (2-line clamp), priority badge (color-coded), assignee avatars (max 3 + overflow count), due date chip (red if overdue, orange if ≤48h), tag chips (first 2), comment count, attachment count, checklist progress bar
- [x] Avatar fallback: initials on colored circle (hash agent ID for deterministic color)
- [x] Column header: name, task count, color dot, WIP indicator
- [x] Empty state: illustration + "Create First Task" CTA button
- [x] Add "Tasks" link to admin sidebar in `src/components/layout/sidebar.tsx`

### 1.9 Task Creation Modal

- [x] Modal component (`src/components/tasks/task-create-modal.tsx`): triggered by "+" button on column or board header
- [x] Form fields: title (required), column (pre-selected if clicked from column), priority dropdown, due date picker, description textarea
- [x] Client component with `"use client"`; form submission via server action `createTaskAction`
- [x] Inline validation: required field highlight on submit; sonner toast on success/error
- [x] On success: close modal, board refreshes via `revalidatePath('/tasks')`

### 1.10 Loading & Skeleton States

- [x] `src/app/(dashboard)/tasks/loading.tsx`: 3 columns × 3 ghost cards with shimmer animation (Tailwind `animate-pulse`)
- [x] Suspense boundaries around board content for streaming

### 1.11 Agent Portal — Task Board

> **Integration:** Agents get a filtered view of tasks assigned to them.

- [x] Create `src/app/(agent)/my-tasks/page.tsx` — board filtered to current agent's assigned tasks
- [x] Add "My Tasks" link to agent sidebar
- [x] Agent can create tasks (assigned to self by default), move tasks, comment
- [x] Agent cannot delete tasks, manage columns, or access project settings (enforced at API level)

---

### ✅ Milestone 1 Completed

**Features:**
- [x] Database schema (18 tables, 14 indexes, 3 triggers)
- [x] Data layer (task-data.ts — CRUD for tasks, columns, comments, checklist, tags, activity)
- [x] REST API (11 route handlers — tasks, columns, comments, activity, move)
- [x] Server actions (10 actions — create, update, move, delete, comments, checklist, assignees, tags)
- [x] Auth extension (middleware + project-level access control)
- [x] Inbound webhook (`/api/v1/webhooks/tasks` — Bearer auth, idempotency)
- [x] Board UI (admin `/tasks` + agent `/my-tasks` + task cards + create modal + skeleton)

**Post-deployment fixes (no migration needed):**
- [x] Auto-create default workspace/project/columns on first access if migration seed was skipped (admins via env var have no agents row)
- [x] Fix double header on agent `/my-tasks` — removed layout-level `<Header>`, page uses own content
- [x] Fix agent sidebar showing admin menu on `/my-tasks` — detection now uses `pathname.startsWith("/my-")`
- [x] Add My Jobs, My Performance, My Tasks to agent sidebar nav

## Migration Execution

**Migration v=006** — Task Management Schema

Open in browser:
```
https://sales-dashboard-snowy-beta.vercel.app/api/migrate?v=006&secret=YOUR_CRON_SECRET
```

| Detail | Value |
|--------|-------|
| Version | `006` |
| Idempotent | Yes — safe to re-run |
| Tables | 18 new tables (workspaces, projects, columns, tasks, comments, activity_log, etc.) |
| Indexes | 14 (including GIN on `tasks.custom_fields`) |
| Triggers | 3 (append-only activity_log, single is_done column, auto-update timestamps) |
| Seed data | Workspace "Rising Lion" + Project "Task Board" + 4 columns + all agents as members |
| Response | JSON with step-by-step execution log |
| Rollback | Run `src/lib/migrations/006_task_management_schema_down.sql` in Vercel Postgres SQL editor |

---

## Milestone 1B: Multi-Board & Member Management
> Theme: Multiple boards, board CRUD, agent membership, board switching UI. Ref: `task_board_cases.md` sections 1–2.

### 1B.1 Board CRUD — Backend

- [x] `POST /api/projects` — create board (admin only): name (required, max 100 chars), description (optional); auto-create 4 default columns; add creator as admin member
- [x] `GET /api/projects` — list boards: admin sees all in workspace, agent sees only boards they're a member of
- [x] `PATCH /api/projects/[id]` — update board name/description (admin only)
- [x] `DELETE /api/projects/[id]` — delete board (admin only); if board has tasks, require `confirm=true` query param; cascade delete all tasks, columns, tags, configs
- [x] Server actions: `createBoardAction`, `updateBoardAction`, `deleteBoardAction` with `revalidatePath`
- [x] Data layer: `getAllProjects()`, `getUserProjectsWithMeta(agentId)`, `createProject(data)`, `updateProject(id, fields)`, `deleteProject(id)`
- [x] Prevent deleting the last column on a board (API returns 422)

### 1B.2 Board Member Management — Backend

- [x] `GET /api/projects/[id]/members` — list members with role, name, email, avatar, joined_at
- [x] `POST /api/projects/[id]/members` — add agent(s) to board (admin only); validate: agent exists, is active, not already member; body: `{ agent_ids: string[], role?: 'admin'|'member' }`
- [x] `PATCH /api/projects/[id]/members/[agentId]` — change member role (admin only); block if last admin
- [x] `DELETE /api/projects/[id]/members/[agentId]` — remove agent from board (admin only); block removing workspace owner; if agent has task assignments, requires `unassign=true` or returns 409
- [x] Server actions: `addBoardMembersAction`, `updateMemberRoleAction`, `removeBoardMemberAction`
- [x] Available agents query: `getAvailableAgents(projectId)` returns active agents not yet on board

### 1B.3 Board Selector UI

- [x] Board selector dropdown in board page header — lists accessible boards
- [x] Route change: `/tasks?board=<project_id>` (URL-based board selection)
- [x] "Create New Board" button in selector (admin only) — opens create board dialog
- [x] Agent sees only boards they're members of
- [x] Remember last active board in localStorage; load on next visit
- [x] Empty state: no boards → "Create your first board." (admin) / "No boards assigned." (agent)

### 1B.4 Board Create/Edit Dialog

- [x] Create board dialog: name (required, max 100), description (optional)
- [x] Edit board: `PATCH /api/projects/[id]` + `updateBoardAction` (UI inline rename deferred to M2 drawer)
- [x] Delete board: `DELETE /api/projects/[id]?confirm=true` + `deleteBoardAction`

### 1B.5 Board Members UI (Board Settings)

- [x] Members slide-out panel (`board-members-panel.tsx`) triggered from board header
- [x] Members list: avatar, name, email, role dropdown, remove button
- [x] Add member: agent picker (active agents not already on board)
- [x] Change role: dropdown per member (admin only); last-admin demotion blocked
- [x] Remove member: confirmation + auto-unassign from tasks
- [x] Member count button on board header

### 1B.6 Agent Board Access Enforcement

- [x] All task/column/comment API routes: `isProjectMember` check present on all routes
- [x] Agent removed from board: next API call returns 403
- [x] Available agents for assignment: `getAvailableAgents()` scoped to board members
- [x] Workspace owner removal blocked in `removeProjectMember()`

### 1B.7 Agent My-Tasks Cross-Board View

- [x] `/my-tasks` shows tasks assigned to agent across ALL boards via `getAgentTasksAcrossBoards()`
- [x] Shows task count and board count summary
- [x] Board view filtered to primary board's columns

---

### ✅ Milestone 1B Completed

**Features:**
- [x] Board CRUD: create/edit/delete boards with default columns, cascade delete
- [x] Member management: add/remove agents, role changes, last-admin guard, workspace owner protection
- [x] Board selector dropdown with URL-based switching + localStorage persistence
- [x] Create board dialog (name + description)
- [x] Members slide-out panel with add/remove/role-change
- [x] Agent access enforcement on all routes + available agents scoping
- [x] Cross-board My Tasks view for agents

**No migration needed** — uses existing schema (workspaces, projects, project_members tables from M1).

### UI Audit (2026-03-31) — see `task_board_ui_audit.md`

**Must-fix before Milestone 2:**
- [x] FN-1: Add board selector for agents on `/my-tasks` — agents with 2+ boards get dropdown, URL-based switching via `?board=` param with `/my-tasks` basePath
- [x] FN-2: Add assignee picker to task create modal — multi-select from board members, chip display with remove
- [x] FN-8: Fix per-column task creation modal — moved outside scroll container, rendered as sibling to board div
- [x] SEC-2: Remove unused `isAdmin` prop from `board-column.tsx`
- [x] UX-3: Clear board create dialog form on re-open — useEffect clears name/description when dialog opens
- [x] UX-5: Replace browser `confirm()` in member removal with styled Dialog — shows name, warns about task unassignment, has Cancel/Remove buttons with loading spinner
- [x] UX-6: Update `tasks/loading.tsx` skeleton — now shows board header bar (icon + selector + avatars) + 4 columns with varied card counts

---

## Milestone 2: Board UX, Drag & Drop & Task Detail (Sprint 2)
> Theme: Interactive drag-drop board, task detail drawer, rich text, file attachments, checklist.
> **Ref:** `task_board_ui_audit.md` — addresses FN-3, FN-4, FN-5, FN-6 from audit.

### 2.1 Drag & Drop System (@dnd-kit)

- [x] Wrap board in `DndContext` with `PointerSensor` (8px activation distance) and `TouchSensor`
- [x] `SortableContext` per column with `verticalListSortingStrategy`
- [x] `closestCorners` collision detection for cross-column card drops
- [x] `onDragStart`: set `activeTask` in Zustand store; render `DragOverlay` ghost card (opacity 0.9, rotated 2deg)
- [x] `onDragOver`: optimistic reorder in Zustand store
- [x] `onDragEnd`: call `moveTaskAction` server action; on failure → revert Zustand state + sonner error toast
- [x] Drop target column: accent border + primary/20 ring highlight via `useDroppable`
- [x] Drag handle (grip icon) on each task card

### 2.2 Zustand Board Store

- [x] Create `src/lib/stores/board-store.ts`
- [x] State: `columns`, `tasks`, `members`, `projectId`, `activeTaskId`, `previousState`, `filters`
- [x] Actions: `initBoard`, `moveTask`, `revertMove`, `addTask`, `updateTask`, `removeTask`, `setActiveTask`, `savePreviousState`, `setFilters`, `clearFilters`
- [x] `getTasksByColumn(columnId)` and `getFilteredTasks()` computed selectors
- [x] Hydrate from server component props on mount via `useEffect`

### 2.3 Undo Drag Action

- [x] 5-second undo toast (sonner) after every successful drag-drop with column name
- [x] "Undo" action calls `moveTaskAction` with previous column_id + position
- [x] Previous state saved in Zustand before each drag

### 2.4 Task Detail Drawer

- [x] `src/components/tasks/task-detail-drawer.tsx` — client component
- [x] Open: click task card → `?task=:id` URL param
- [x] Close: remove `?task` param
- [x] Full-width sheet on mobile, 480px on desktop
- [x] Sections: Header (click-to-edit title + status + priority), Assignees (toggle chips), Due Date, Description (textarea), Checklist (add items + progress bar), Comments + Activity Log
- [x] Fetch task detail via `GET /api/tasks/:id` on open
- [x] Activity toggle: "All" / "Comments" tabs
- [x] Delete button (admin only) with confirmation

### 2.5 Inline Editing in Drawer

- [x] Click-to-edit title (Enter to save, Esc to cancel)
- [x] Status (column) dropdown — updates column_id via `updateTaskAction`
- [x] Priority dropdown — immediate update
- [x] Due date — datetime-local input, immediate update on change
- [x] Assignees — toggle chips from board members list
- [x] Description — textarea with save on blur
- [x] Zustand store updated optimistically on all edits

### 2.6 TipTap Rich Text Description

- [ ] Deferred to Milestone 3 — currently using plain textarea
- [ ] TipTap packages not yet installed to keep bundle size down

### 2.7 Checklist (Sub-Tasks)

- [x] Add checklist items via input in drawer
- [x] Progress bar (completed/total %) shown in drawer + on task cards
- [ ] Drag-to-reorder within checklist (deferred — needs dnd-kit nested context)
- [ ] Bulk add via paste (deferred)
- [ ] Toggle items from drawer (server action exists, UI wiring needed for individual toggles)

### 2.8 Activity Log Rendering

- [x] Relative timestamps via `formatDistanceToNow`; full timestamp on hover (title attr)
- [x] Actor name; automation label for webhook-triggered changes
- [x] Field change format: actor + action + old→new
- [x] "All" / "Comments" tab filter in drawer

### 2.9 File Attachments (Vercel Blob)

- [ ] Deferred to Milestone 3 — `@vercel/blob` not yet installed
- [ ] Attachment count shown on cards (data layer ready)

### 2.10 Filter Bar (Client-Side)

- [x] Filter by: assignee, status (column), priority, search text — AND logic
- [x] Client-side filtering via Zustand `getFilteredTasks()` selector
- [x] URL params: `?assignee=id&priority=high&column=id&search=text` for shareable views
- [x] Clear filters button
- [ ] Keyboard shortcuts deferred

### 2.11 Performance — Board Load

- [x] Server component data fetch + client hydration via Zustand
- [x] Drag-drop uses optimistic UI (no round-trip wait for visual feedback)
- [ ] Formal benchmark with 500 tasks (deferred — requires seed data)

---

### ✅ Milestone 2 Completed

**Features delivered:**
- [x] Full drag-and-drop with @dnd-kit (cross-column, ghost overlay, drop highlights)
- [x] Zustand board store for optimistic UI + client-side filtering
- [x] Undo drag via 5-second toast
- [x] Task detail drawer with inline editing (title, status, priority, due date, assignees, description)
- [x] Checklist add + progress bar
- [x] Activity log with comments + field changes
- [x] Filter bar (search, column, priority, assignee) with URL params
- [x] Delete task from drawer (admin only)

**Deferred to Milestone 3:**
- TipTap rich text editor (2.6)
- File attachments via Vercel Blob (2.9)
- Checklist drag-to-reorder (2.7 partial)
- Keyboard shortcuts (2.10 partial)

**No migration needed.**

---

## Milestone 2B: Critical Bug Fixes & Foundation Repair (Sprint 2B — URGENT)
> Theme: Fix all broken functionality before adding new features. Must be done first.
> **Ref:** `task_board_cases.md` v2.0 — Edge Cases §10

### 2B.1 Fix Activity Log Append-Only Trigger Blocking Deletes

> **ROOT CAUSE:** `trg_activity_log_append_only` raises EXCEPTION on DELETE, blocking CASCADE deletes for tasks and boards.

- [x] Create migration `007_fix_activity_log_trigger.sql`:
  - Replace trigger function `prevent_activity_log_mutation()` to ONLY block UPDATE (not DELETE)
  - Allow DELETE on activity_log rows (needed for CASCADE from tasks and projects)
  - Keep UPDATE blocked (append-only semantics preserved for audit integrity)
- [ ] Run migration via browser URL `/api/migrate?v=007`
- [ ] Verify: delete a test task → succeeds without error
- [ ] Verify: delete a board with tasks → full cascade works

### 2B.2 Fix Board Deletion (API + Frontend)

- [x] Update `deleteProject()` in `task-data.ts` — add explicit pre-delete of activity_log entries via tasks in project (defense-in-depth)
- [x] Update `deleteBoardAction()` — return meaningful error
- [x] Frontend: board header delete flow shows error messages from server
- [ ] Test: delete board with 0 tasks → succeeds
- [ ] Test: delete board with N tasks → confirmation modal → succeeds

### 2B.3 Fix Task Deletion (API + Frontend)

- [x] Update `deleteTask()` in `task-data.ts` — explicitly delete activity_log WHERE task_id before deleting task (defense-in-depth)
- [x] Update `deleteTaskAction()` — return error message on failure
- [x] Frontend: task detail drawer delete button → confirmation dialog + proper error toast on failure
- [ ] Test: delete task from drawer → succeeds, card removed from board

### 2B.4 Fix Admin Role Logic (System Admin vs Project Admin)

- [x] Verified: system admin (env-var login, `session.user.role === "admin"`) bypasses project_members checks (agentId is null → membership check skipped in all API routes)
- [x] `updateMemberRole()` last-admin guard already prevents demoting last admin
- [x] Added warning banner in members panel: "This board has no admin members"
- [ ] Test: demote all project members to "member" → system admin can still manage board

### 2B.5 Update Default Columns to Upwork Statuses

- [x] Update `createProject()` in `task-data.ts` — changed from 4 to 13 default columns
- [x] Update `ensureDefaultProject()` with same 13 columns
- [x] Existing boards unaffected — only new boards get new defaults
- [x] Max columns raised from 15 to 20 in API route validation

### 2B.6 Fix Drag — Make Entire Card Draggable

- [x] Modified `SortableTaskCard` — dnd-kit `listeners` and `attributes` applied to entire card div
- [x] Removed `GripVertical` drag handle icon and `dragHandleProps` pattern
- [x] 8px activation distance preserved (PointerSensor config in board-view.tsx)
- [x] Tags now show 3 (up from 2) before overflow count

---

## Milestone 3: ClickUp Card UI & Column Management (Sprint 3)
> Theme: Redesign task cards to match card.png, add column CRUD UI, fix assignee dropdown.
> **Ref:** `task_board_cases.md` v2.0 — §4 (Tasks), §9.1 (Card UI)

### 3.1 Task Card Redesign (Match card.png)

- [ ] Redesign `TaskCardContent` in `task-card.tsx` to match ClickUp card layout:
  - Row 1: Status color bar (left border, 3px, column color)
  - Row 2: Priority flag icon (colored) + Task title (2-line clamp)
  - Row 3: Labels/tags as colored rounded chips (max 3 + "+N")
  - Row 4: Custom field values (max 2, if `show_on_card` enabled) — e.g., "Connects Used: 5"
  - Row 5: Metadata icons row — due date, start date, time estimate, subtask count
  - Row 6: Bottom bar — assignee avatars (left, max 3 + overflow), comment + attachment counts (right)
- [ ] Remove drag grip icon (card is fully draggable per 2B.6)
- [ ] Add "..." context menu button on hover (top-right)
- [ ] Card hover: elevated shadow + border highlight
- [ ] Card colors: subtle priority-based left border OR status color bar

### 3.2 Card Context Menu

- [ ] Use Radix `DropdownMenu` on "..." button (not ContextMenu — more mobile-friendly)
- [ ] Options: Edit (opens drawer), Move to → (submenu with columns), Copy Link, Assign →, Delete (admin only, red)
- [ ] "Copy Link" copies `{domain}/tasks?board={id}&task={taskId}` to clipboard + toast
- [ ] "Delete" shows confirmation dialog

### 3.3 Column Management UI (Admin)

- [ ] Column header "..." menu (admin only): Rename, Change Color, Set WIP Limit, Mark as Done, Delete
- [ ] Inline rename: double-click column name → inline input → Enter/blur to save
- [ ] Color picker: 12 preset colors + custom hex input → updates column dot + card left border
- [ ] WIP limit input: number field; 0 = no limit; badge on column header shows "5/10"
- [ ] Delete column: if has tasks → modal with "Move N tasks to:" dropdown → bulk move → delete
- [ ] "Add Status" button: "+" at end of column row → inline name input → creates new column at end
- [ ] Column reorder: admin can drag column headers to reorder (dnd-kit column-level context)

### 3.4 Fix Assignee Dropdown (ClickUp-Style)

- [ ] Redesign assignee selection in task drawer and task create modal:
  - Trigger: click "+" button next to assignee avatars
  - Dropdown: search input + scrollable member list with avatars + names
  - Checkmark on assigned members; click to toggle
  - Close on outside click
- [ ] Use Radix `Popover` + custom content (not shadcn Select)
- [ ] Keyboard navigation: arrow keys + Enter to toggle + Escape to close
- [ ] Show in both task create modal AND task detail drawer

### 3.5 Labels (Tags) Enhancement

- [ ] Label management in project settings (or inline from task drawer):
  - Create label: name + color picker (12 presets + custom hex)
  - Edit label: change name/color → reflected across all tasks
  - Delete label: confirmation + cascade remove from tasks
- [ ] Task drawer: "Add Label" → dropdown with existing labels + "Create new" option at bottom
- [ ] Card: show label chips (max 3 + "+N") — colored background, white/dark text
- [ ] Filter bar: add "Label" filter dropdown
- [ ] API: `GET/POST /api/projects/[id]/labels`, `PATCH/DELETE /api/projects/[id]/labels/[lid]`

### 3.6 Start Date Field

- [ ] Add start_date to task create modal (calendar picker, optional)
- [ ] Show in task detail drawer next to due date
- [ ] Show on card if set (small calendar icon + date)
- [ ] Validation: start_date ≤ due_date (warn if violated, don't block)
- [ ] DB: column already exists (`tasks.start_date`)

### 3.7 Time Estimate & Time Tracking Fields

- [ ] Time estimate: hours/minutes input in task drawer
  - Stored in `tasks.custom_fields` as `{ "_time_estimate_minutes": number }`
  - Card shows "Est: 2h 30m" if set and show_on_card
- [ ] Time tracked: manual hours/minutes entry per session
  - Stored in `tasks.custom_fields` as `{ "_time_tracked_minutes": number }`
  - Card shows "1h 30m / 2h 30m" (tracked / estimate)
- [ ] No live timer in v1 — manual entry only

---

## Milestone 4: Task Detail Drawer Enhancements (Sprint 4)
> Theme: Subtasks, share task, checklist improvements, rich text.
> **Ref:** `task_board_cases.md` v2.0 — §4.5 (Subtasks), §4.6 (Share), §8 (Comments)

### 4.1 Subtasks / Checklist Enhancements

- [ ] Display checklist items as toggleable checkboxes in drawer (currently only add + progress bar)
- [ ] Each item: checkbox + title + delete (X) button
- [ ] Toggle individual items via `toggleChecklistItemAction`
- [ ] Drag-to-reorder items (dnd-kit nested sortable context within drawer)
- [ ] Bulk add: paste multi-line text → each line becomes a checklist item
- [ ] Card: show "3/5" subtask count with progress bar

### 4.2 Share Task Dialog (Match share-task.png)

- [ ] "Share" button in task drawer header (Share2 icon)
- [ ] Dialog content:
  - Task title with status color dot
  - "Invite by name or email" input + "Invite" button (adds as board member if not already)
  - "Share link with anyone" toggle (stores `is_public` flag on task)
  - "Private link" with "Copy link" button
  - "Default permission" dropdown: Full edit, Can comment, View only
  - "Share with" section: board members list with toggles
- [ ] "Copy link" → copies `{domain}/tasks?board={projectId}&task={taskId}`
- [ ] DB: add `is_public BOOLEAN DEFAULT false` to tasks table (migration 008)

### 4.3 Rich Text Description (TipTap)

- [ ] Install `@tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-underline @tiptap/extension-placeholder dompurify`
- [ ] Replace description `<textarea>` with TipTap editor in task drawer
- [ ] Toolbar: Bold, Italic, Underline, Link, Bullet List, Numbered List
- [ ] Sanitize HTML with DOMPurify before storing
- [ ] Render HTML safely in activity log previews

### 4.4 File Attachments

- [ ] Install `@vercel/blob`
- [ ] Upload button in task drawer → select file → upload to Vercel Blob
- [ ] Store metadata in `file_attachments` table (filename, url, size, mime_type, uploader)
- [ ] Display: file list with icons, download links, delete (uploader or admin)
- [ ] Max file size: 10MB; allowed types: images, PDFs, docs, spreadsheets
- [ ] Attachment count shown on card

### 4.5 Comment Improvements

- [ ] Show individual comment bubbles (not just activity log entries)
- [ ] Edit button (pencil icon, author only, 60min window)
- [ ] Delete button (trash icon, author 60min or admin, soft delete)
- [ ] Reply button → indented reply under parent comment
- [ ] "(edited)" badge on edited comments
- [ ] Rich text comments (TipTap, reusing 4.3 editor)

---

## Milestone 5: Custom Fields & Grouping (Sprint 5)
> Theme: User-defined custom fields, board grouping views, advanced filtering.
> **Ref:** `task_board_cases.md` v2.0 — §7 (Custom Fields), §9.2.3 (Groups)

### 5.1 Custom Field Backend

- [ ] `GET /api/projects/[id]/custom-fields` — list field definitions (ordered by position)
- [ ] `POST /api/projects/[id]/custom-fields` — create field definition (admin only)
- [ ] `PATCH /api/projects/[id]/custom-fields/[fid]` — update (admin); type locked after creation
- [ ] `DELETE /api/projects/[id]/custom-fields/[fid]` — archive (not delete); values preserved in JSONB
- [ ] 6 types: Text, Number, Dropdown, Multi-select, Date, Boolean
- [ ] Values stored in `tasks.custom_fields` JSONB: `{ "field_id": value }`

### 5.2 Custom Field Management UI (Admin)

- [ ] Project Settings > Custom Fields tab
- [ ] Create form: name, type (locked), options (dropdown/multi-select), required flag, show_on_card toggle
- [ ] Edit: change name, options, required, show_on_card (type immutable)
- [ ] Archive: hidden from UI, data preserved, restorable
- [ ] Drag-to-reorder field position

### 5.3 Custom Fields in Task UI

- [ ] Type-specific renderers in task drawer (text input, number input, select, checkboxes, date picker, toggle)
- [ ] Show on card: max 3 fields controlled by `show_on_card` + position (compact "Label: Value" format)
- [ ] Validation: required fields, number rejects NaN, etc.
- [ ] Pre-built field: "Connects Used" (Number type) as first custom field example

### 5.4 Board Grouping / List View

- [ ] Group selector in board header: "Group by: Status (default) | Assignee | Priority | Label"
- [ ] Group by Status = current board view (columns)
- [ ] Group by Assignee = one column per assignee + "Unassigned" column
- [ ] Group by Priority = columns: Urgent, High, Medium, Low, None
- [ ] Group by Label = one column per label + "No label" column
- [ ] Persisted in URL param: `?group=status|assignee|priority|label`

### 5.5 Advanced Filter System

- [ ] Multi-condition filters: field → operator → value
- [ ] Standard fields: Assignee, Status, Priority, Due Date, Labels, Created By
- [ ] Custom field filters: type-specific operators
- [ ] Server-side filtering for >500 tasks; client-side for ≤500
- [ ] Filter state in URL params

### 5.6 Saved Views

- [ ] Save current filter + sort + group as named view
- [ ] `GET/POST/DELETE /api/projects/[id]/saved-views`
- [ ] Sidebar section listing saved views
- [ ] "Unsaved changes" indicator when view modified

---

## Milestone 6: n8n Automation & Webhooks (Sprint 6)
> Theme: Bidirectional n8n integration, webhook management, outbound events.

### 6.1 n8n Inbound Webhook (Full)

- [ ] Full payload: `{ title, column_id, priority, assignee_ids[], due_date, tags[], custom_fields: {} }`
- [ ] Field mapping via `webhook_configs.field_map`
- [ ] Activity log: `actor_label = "Automation (n8n)"`
- [ ] Unmapped keys silently ignored; logged in `webhook_event_log`

### 6.2 Webhook Field Mapping UI

- [ ] Visual mapper in Project Settings > Webhooks
- [ ] Test payload: paste JSON → preview mapped fields
- [ ] Save to `webhook_configs.field_map` JSONB

### 6.3 Webhook Event Logs

- [ ] Admin page: last 100 events, expandable payload viewer, export CSV

### 6.4 Outbound Webhooks (via QStash)

- [ ] Install `@upstash/qstash`
- [ ] 6 event types: `task.created`, `task.status_changed`, `task.completed`, `task.assigned`, `task.due_soon`, `comment.added`
- [ ] HMAC-SHA256 signature; loop prevention via `X-Rising-Lion-Source` header
- [ ] Circuit breaker: 10+ modifications in 60s → pause automation

---

## Milestone 7: Notifications, Performance & Polish (Sprint 7)
> Theme: Notification system, mobile UX, performance, security.

### 7.1 Notification System

- [ ] 7 types: task_assigned, task_commented, task_mentioned, task_due_soon, task_overdue, task_status_changed, workspace_invite
- [ ] In-app delivery via `notifications` table
- [ ] Bell icon in header with unread count
- [ ] Notification panel: click to navigate, mark read, mark all read
- [ ] Cron routes: `/api/cron/due-soon` (hourly), `/api/cron/overdue` (daily 8am)

### 7.2 Real-Time Updates (SSE)

- [ ] `GET /api/notifications/stream` — SSE endpoint
- [ ] Fallback: poll every 30s if SSE fails
- [ ] Zustand store for notification state

### 7.3 Performance — Virtualization

- [ ] Install `@tanstack/react-virtual`
- [ ] Virtualize card lists within columns (handle 1000+ tasks)
- [ ] Position rebalancing when gaps converge

### 7.4 Mobile Responsive

- [ ] Horizontal snap-to-column scroll at <640px
- [ ] Full-width slide-up drawer on mobile
- [ ] Touch targets ≥ 44×44px

### 7.5 Keyboard Navigation

- [ ] Arrow keys between cards, Enter to open drawer
- [ ] Escape to close drawer/modal
- [ ] / to focus search filter

### 7.6 Security Hardening

- [ ] Webhook API key: bcrypt hash in DB
- [ ] Rate limits: 1000 req/min session, 100/min API key
- [ ] XSS: DOMPurify on all rich text
- [ ] File upload: MIME validation, block dangerous extensions

---

## Quick Reference — API Endpoints (Updated v3.0)

### Board & Member Management (M1B)
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/projects` | Agent+ |
| POST | `/api/projects` | Admin |
| PATCH | `/api/projects/[id]` | Admin |
| DELETE | `/api/projects/[id]` | Admin |
| GET | `/api/projects/[id]/members` | Agent+ |
| POST | `/api/projects/[id]/members` | Admin |
| PATCH | `/api/projects/[id]/members/[agentId]` | Admin |
| DELETE | `/api/projects/[id]/members/[agentId]` | Admin |

### Tasks, Columns & Comments (M1, M2)
| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/tasks` | Agent+ |
| GET/PATCH/DELETE | `/api/tasks/[id]` | Agent+ / Admin |
| PATCH | `/api/tasks/[id]/move` | Agent+ |
| GET/POST | `/api/tasks/[id]/comments` | Agent+ |
| PATCH/DELETE | `/api/tasks/[id]/comments/[cid]` | Author (60min) / Admin |
| GET | `/api/tasks/[id]/activity` | Agent+ |
| POST/DELETE | `/api/tasks/[id]/attachments` | Agent+ |
| POST | `/api/v1/webhooks/tasks` | API Key |
| GET/POST | `/api/projects/[id]/columns` | Agent+ / Admin |
| PATCH | `/api/projects/[id]/columns/[cid]` | Admin |
| PATCH | `/api/projects/[id]/columns/reorder` | Admin |
| DELETE | `/api/projects/[id]/columns/[cid]` | Admin |

### Labels (M3)
| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/labels` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/labels/[lid]` | Admin |

### Custom Fields, Views (M5)
| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/custom-fields` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| GET/POST/DELETE | `/api/projects/[id]/saved-views` | Agent+ |

### Webhooks (M6)
| Method | Endpoint | Access |
|--------|----------|--------|
| PATCH | `/api/projects/[id]/webhook-config` | Admin |
| GET | `/api/projects/[id]/webhook-logs` | Admin |

### Notifications (M7)
| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/notifications/stream` | Agent+ (SSE) |
| GET | `/api/notifications` | Agent+ |
| PATCH | `/api/notifications/[id]/read` | Agent+ |
| PATCH | `/api/notifications/read-all` | Agent+ |
| GET | `/api/cron/due-soon` | CRON_SECRET |
| GET | `/api/cron/overdue` | CRON_SECRET |

---

## Definition of Done (per feature)
1. Code works on Vercel production (no localhost-only features)
2. Raw SQL queries use parameterized `sql` tagged template (no string concatenation)
3. Server actions call `revalidatePath()` after mutations
4. Optimistic UI reverts on server action failure
5. Admin-only actions enforced at both API and UI layer
6. Activity log entry created for all state changes
7. No P0 bugs; edge cases addressed

---

## Execution Protocol

When instructed to **"Start milestone N"**:
1. Execute features **one by one** in order
2. After completing each feature: mark `- [x]` in this file
3. Keep all code production-ready (deployed to Vercel)
4. If stopped: resume from last incomplete `- [ ]` item

**Priority order:** 2B (critical fixes) → 3 → 4 → 5 → 6 → 7

**State tracking:**
- `plan.md` → checklist progress (this file)
- `cline.md` → execution history/logs
- `task_board_cases.md` → cases/edge cases (v2.0)

---

*Rising Lion Platform | Task Management Module | Execution Plan v2.0 (Stack-Aligned) | Based on Implementation Plan v2.0*
