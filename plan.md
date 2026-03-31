# Rising Lion — Task Management Module
## Execution Plan v2.0 (Stack-Aligned)

> **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5 · next-auth v5 (beta.30) · @vercel/postgres (raw SQL, no ORM) · Recharts · Radix UI · shadcn/ui · Tailwind CSS v4 · lucide-react · date-fns · react-day-picker · sonner · next-themes · clsx · tailwind-merge · ESLint 9
> **Deployment:** Vercel (serverless) — no local dev workflow; all changes must be production-ready
> **Realtime:** Server-Sent Events (SSE) — Vercel does not support persistent WebSocket connections
> **Background Jobs:** Vercel Cron + QStash (Upstash) for async job processing
> **File Storage:** Vercel Blob for attachments
> **State Management:** Zustand (to be installed)
> **Drag & Drop:** @dnd-kit (to be installed)
> **Rich Text:** TipTap (to be installed)
> **Timeline:** 5 milestones

---

## Prerequisites: New Dependencies

Before starting Milestone 1, install these packages:

- [x] `npm i zustand` (installed; @dnd-kit deferred to Milestone 2)
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

## Milestone 2: Board UX, Drag & Drop & Task Detail (Sprint 2)
> Theme: Interactive drag-drop board, task detail drawer, rich text, file attachments, checklist.

### 2.1 Drag & Drop System (@dnd-kit)

- [ ] Wrap board in `DndContext` with `PointerSensor` (8px activation distance) and `TouchSensor`
- [ ] `SortableContext` per column with `verticalListSortingStrategy`
- [ ] Custom collision detection for cross-column card drops
- [ ] `onDragStart`: set `activeTask` in Zustand store; render `DragOverlay` ghost card (opacity 0.8, z-index 9999)
- [ ] `onDragOver`: optimistic reorder in Zustand store (throttled via `requestAnimationFrame`)
- [ ] `onDragEnd`: call `moveTaskAction` server action; on failure → revert Zustand state + sonner error toast
- [ ] Drop target column: accent border highlight; scroll near column edges
- [ ] Validate 60fps during drag via Chrome DevTools Rendering profiler

### 2.2 Zustand Board Store

> **Pattern:** Client-side store for optimistic UI. Server is source of truth; store syncs on mount and after mutations.

- [ ] Create `src/lib/stores/board-store.ts`
- [ ] State: `columns`, `tasks` (by column), `activeTask`, `filters`, `isLoading`
- [ ] Actions: `initBoard(data)`, `moveTask(taskId, toColumnId, toPosition)`, `revertMove()`, `addTask(task)`, `updateTask(taskId, fields)`, `removeTask(taskId)`, `setFilters(filters)`
- [ ] Hydrate from server component props on mount; optimistic updates on user actions

### 2.3 Undo Drag Action

- [ ] 5-second undo toast (sonner with countdown) after every drag-drop
- [ ] "Undo" button calls `moveTaskAction` with previous column_id + position
- [ ] Store previous state in Zustand for revert

### 2.4 Task Detail Drawer

> **Pattern:** Slide-in sheet using shadcn `Sheet` component (Radix Dialog primitive). URL state via search params.

- [ ] Create `src/components/tasks/task-detail-drawer.tsx` — `"use client"` component
- [ ] Open: click task card → append `?task=:id` to URL (via `router.push` with shallow routing)
- [ ] Close: remove `?task` param; focus returns to triggering card
- [ ] Width: ~40% viewport (min 400px) desktop; full-width on mobile
- [ ] Sections: Header (title + status + priority), Meta (assignees, due date, tags), Description, Custom Fields, Checklist, Attachments, Comments, Activity Log
- [ ] Fetch task detail via `getTaskById` on open (or API call from client)
- [ ] Activity section toggle: "Comments only" / "All activity"; grouped by date

### 2.5 Inline Editing in Drawer

- [ ] Click-to-edit for: title, status, priority, dates, assignees, tags
- [ ] Optimistic UI: immediate Zustand update → `updateTaskAction` server action async
- [ ] On failure: revert to confirmed state + sonner error toast
- [ ] Text fields debounced 500ms; dropdowns/toggles fire immediately
- [ ] Unsaved title shows asterisk (*) indicator

### 2.6 TipTap Rich Text Description

- [ ] Install TipTap extensions (see Prerequisites)
- [ ] Formats: Bold, Italic, Underline, Strikethrough, H1–H3, Bullet/Numbered lists, Code block, Blockquote, Link, @mention
- [ ] @mention: dropdown searches workspace agents; stores `user_id` in mention node
- [ ] Auto-save on blur (debounced 500ms); no manual save button
- [ ] XSS: sanitize with DOMPurify before storing; strip on server side

### 2.7 Checklist (Sub-Tasks)

- [ ] Add/reorder/delete checklist items in task drawer
- [ ] Progress bar: completed/total % shown on task card and in drawer
- [ ] @dnd-kit sortable for reorder within checklist
- [ ] Bulk add: paste newline-separated text (max 50 items)
- [ ] Toggle item: `toggleChecklistItemAction` server action
- [ ] All items checked → subtle confetti micro-animation (CSS only, dismissible)

### 2.8 Activity Log Rendering

- [ ] Relative timestamps via `date-fns` `formatDistanceToNow`; full timestamp on hover (title attribute)
- [ ] Actor name with avatar; webhook-triggered changes show "Automation (n8n)" label
- [ ] Field change format: `[Actor] changed [field] from [old] to [new]`
- [ ] Infinite scroll or "Load more" for long activity lists

### 2.9 File Attachments (Vercel Blob)

> **Pattern:** Use `@vercel/blob` for serverless-compatible file storage. No presigned URLs needed — Vercel Blob handles upload directly.

- [ ] Server action: `uploadAttachmentAction(taskId, formData)` — uses `put()` from `@vercel/blob`
- [ ] Store in Vercel Blob with path: `tasks/{task_id}/{uuid}/{filename}`
- [ ] Upload progress: client-side XHR with `onprogress`; cancel support
- [ ] Allowed MIME types: images, PDFs, docs, spreadsheets — block exe, sh, bat, js (validate magic bytes on server)
- [ ] Max file size: 10MB per file
- [ ] Thumbnail: for images, use `<Image>` with Vercel automatic optimization; generic icon for non-images
- [ ] Delete: `deleteAttachmentAction(attachmentId)` — removes from Vercel Blob + DB record
- [ ] Log attachment add/remove in activity log

### 2.10 Filter Bar (Client-Side)

- [ ] Filter by: assignee, status (column), priority — AND logic
- [ ] Client-side filtering in Zustand store for ≤500 tasks
- [ ] URL params: `?assignee=id&priority=high&column=id` for shareable filtered views
- [ ] Keyboard shortcuts: `N` = new task, `F` = focus filter, `Esc` = close drawer; shown in tooltips

### 2.11 Performance — Board Load

- [ ] Target: initial board render <500ms with 500 tasks
- [ ] Server component data fetch + client hydration
- [ ] Drag-drop round-trip confirmation <300ms (server action latency)

---

## Milestone 3: Custom Fields & n8n Automation (Sprint 3)
> Theme: 6-type custom field system, bidirectional n8n integration, outbound webhooks.

### 3.1 Custom Field Backend

- [ ] `GET /api/projects/[id]/custom-fields` — list field definitions (ordered by position)
- [ ] `POST /api/projects/[id]/custom-fields` — create field definition (admin only)
- [ ] `PATCH /api/projects/[id]/custom-fields/[fid]` — update field (admin only); type cannot change after creation (return 400)
- [ ] `DELETE /api/projects/[id]/custom-fields/[fid]` — archive (not delete); values preserved in task JSONB
- [ ] Store task custom field values in `tasks.custom_fields` JSONB: `{ "field_id": value }`
- [ ] JSONB queries: `WHERE custom_fields @> '{"field_id": "value"}'` (parameterized, no dynamic SQL)

### 3.2 Custom Field Types — All 6

- [ ] **Text** — single-line input; max 1000 chars; HTML stripped; filters: Contains, Equals, Is empty
- [ ] **Number** — numeric input + optional unit label; reject NaN/Infinity; filters: =, >, <, >=, <=, Between
- [ ] **Dropdown** — single-select from admin-configured options; color per option; filters: Equals, Is any of
- [ ] **Multi-select** — checkbox list; admin configures options; deleted options auto-removed from tasks; filters: Contains, Contains all, Contains none
- [ ] **Date** — calendar picker (react-day-picker); stored as UTC ISO string; filters: Before, After, Between, Is empty
- [ ] **Boolean** — toggle/checkbox; null treated as false; filters: Is true, Is false

### 3.3 Custom Field Management UI (Admin)

- [ ] Field Manager in Project Settings > Custom Fields tab (`src/app/(dashboard)/tasks/settings/page.tsx`)
- [ ] Create field form: name, type (locked after creation), options (for dropdown/multi-select), required flag, show on card toggle
- [ ] Drag-to-reorder fields (dnd-kit); position saved via server action
- [ ] Archive field: hidden from task UIs but data preserved; restore option
- [ ] Removing a dropdown option: prompt to bulk-reassign orphaned values

### 3.4 Custom Fields in Task UI

- [ ] Render configured custom fields on task cards (max 3, controlled by `show_on_card` flag)
- [ ] Custom fields section in task detail drawer (below standard fields); inline editable
- [ ] Type-specific renderers: text input, number input, select dropdown, multi-select checkboxes, date picker, boolean toggle
- [ ] Validation: number rejects non-numeric; required fields show inline error on save

### 3.5 Custom Field Filtering

- [ ] Filter operators auto-generated per field type in filter bar UI
- [ ] Server-side filtering for >500 tasks (JSONB query); client-side for ≤500
- [ ] Validate filter type matches field type; return 422 on mismatch

### 3.6 n8n Inbound Webhook (Full)

> **Integration:** Extends the webhook endpoint from Milestone 1.7.

- [ ] Full payload support: `{ title, column_id, priority, assignee_ids[], due_date, tags[], custom_fields: {} }`
- [ ] Field mapping: apply `webhook_configs.field_map` to transform incoming payload keys
- [ ] Unmapped keys silently ignored; logged in `webhook_event_log`
- [ ] Activity log: webhook-created tasks show `actor_label = "Automation (n8n)"`

### 3.7 n8n Field Mapping UI

- [ ] Visual mapper in Project Settings > Webhooks tab
- [ ] Left column: incoming payload keys (editable) → Right column: task field dropdown
- [ ] Test payload: admin pastes sample JSON → preview how fields would map
- [ ] Save mapping to `webhook_configs.field_map` JSONB via server action

### 3.8 Webhook Event Logs (Admin)

- [ ] Admin page: `src/app/(dashboard)/tasks/settings/webhooks/page.tsx`
- [ ] Table: last 100 inbound events per project; columns: timestamp, direction, status code, payload preview, result
- [ ] Expandable row: full payload JSON viewer
- [ ] Export to CSV

### 3.9 Outbound Webhooks (Rising Lion → n8n)

> **Pattern:** Use QStash (Upstash) for reliable async delivery from serverless. No BullMQ.

- [ ] 6 event types: `task.created`, `task.status_changed`, `task.completed`, `task.assigned`, `task.due_soon`, `comment.added`
- [ ] On trigger: publish to QStash with target = outbound URL from `webhook_configs`
- [ ] HMAC-SHA256 signature in `X-Rising-Lion-Signature` header on every outbound request
- [ ] `X-Rising-Lion-Source` header: if inbound webhook contains this header, skip outbound fire (prevent loops)
- [ ] Circuit breaker: if task modified >10 times in 60s via webhooks, pause automation + log warning
- [ ] QStash handles retry (3 attempts, exponential backoff) and dead-letter
- [ ] Log all outbound attempts in `webhook_event_log`

### 3.10 Activity Log Backend (Complete)

- [ ] Capture all field changes: title, description, status (column move), priority, assignees, due date, tags, custom fields, checklist items, attachments
- [ ] Log entry fields: `{ id, task_id, actor_id, actor_label, action_type, field, old_value, new_value, metadata, created_at }`
- [ ] Webhook-triggered changes: `actor_id = null`, `actor_label = "Automation (n8n)"`
- [ ] Bulk operations: one log entry per task affected
- [ ] All timestamps from DB `NOW()`, not application time

---

## Milestone 4: Notifications, Permissions & Advanced Filtering (Sprint 4)
> Theme: Full permission enforcement, notification system, advanced filtering, saved views.

### 4.1 Role-Based Permissions — Full Matrix

| Action | Agent | Admin |
|--------|-------|-------|
| View board / tasks | ✅ Own projects | ✅ All projects |
| Create task | ✅ | ✅ |
| Edit task | ✅ Own + assigned | ✅ Any |
| Delete task | ❌ | ✅ |
| Move task (drag) | ✅ | ✅ |
| Manage columns | ❌ | ✅ |
| Custom field definitions | ❌ | ✅ |
| Webhook config | ❌ | ✅ |
| Saved views (own) | ✅ | ✅ |
| Saved views (shared) | View only | Create/Delete |

- [ ] Backend middleware: enforce all agent vs admin rules on every API route
- [ ] Frontend: conditionally hide (not just disable) unauthorized action buttons based on session role
- [ ] Direct API attempt with wrong role returns 403 with `{ error, required_role }`
- [ ] Workspace isolation: every DB query includes `workspace_id` or `project_id` filter

### 4.2 Notification System — 7 Types

- [ ] **task_assigned** — trigger on assignee change; payload: task title, project, assigning user
- [ ] **task_commented** — notify task creator + all assignees + previous commenters; mute-per-task option
- [ ] **task_mentioned** — parse @mention nodes from TipTap; deduplicate with task_assigned
- [ ] **task_due_soon** — Vercel cron every hour; send once per due-date cycle to assignees
- [ ] **task_overdue** — Vercel cron daily at 8am; re-send daily until completed or date updated
- [ ] **task_status_changed** — notify creator + assignees; exclude the actor who made the change
- [ ] **workspace_invite** — in-app only (email delivery optional future enhancement)
- [ ] In-app delivery: insert into `notifications` table; push to client via SSE or polling
- [ ] Add cron routes to `vercel.json`: `/api/cron/due-soon` (hourly), `/api/cron/overdue` (daily 8am)

### 4.3 Real-Time Notifications (SSE)

> **Pattern:** Server-Sent Events via Next.js Route Handler. Vercel supports SSE with streaming responses (up to 25s on Hobby, 300s on Pro).

- [ ] `GET /api/notifications/stream` — SSE endpoint; streams `notification:new` events
- [ ] Client: `EventSource` connection on board mount; reconnect with exponential backoff
- [ ] Fallback: poll `GET /api/notifications?unread=true` every 30s if SSE fails
- [ ] "Reconnecting…" banner on SSE disconnect
- [ ] Zustand store for notification state: unread count, notification list

### 4.4 User Notification Preferences

- [ ] Settings page: `src/app/(dashboard)/tasks/settings/notifications/page.tsx`
- [ ] Toggle grid: In-App / Email per notification type; default all enabled
- [ ] Store in `notification_preferences` table; server action to update
- [ ] Preferences checked before creating notification records

### 4.5 Notification Panel UI

- [ ] Bell icon in header with unread count badge (from Zustand store, updated via SSE)
- [ ] Dropdown panel: most recent 50 notifications, paginated
- [ ] Click notification → navigate to task + highlight change
- [ ] "Mark as read" on click; "Mark all read" button
- [ ] `PATCH /api/notifications/[id]/read` and `PATCH /api/notifications/read-all`

### 4.6 Advanced Filter System

- [ ] Multi-condition filter groups: AND within group, OR between groups (max 5 groups, 10 conditions each)
- [ ] Condition builder UI: field selector → operator → value input
- [ ] Standard fields: Assignee, Status (column), Priority, Due Date, Tags, Created By, Created At
- [ ] Custom field filters added dynamically per project
- [ ] Real-time preview: matching task count updates as conditions change
- [ ] Server-side filtering for >500 tasks (SQL query builder with parameterized values); client-side for ≤500
- [ ] Filter state stored in URL params for shareability

### 4.7 Stacked Sorting

- [ ] Primary + secondary sort in UI
- [ ] Sortable fields: Due Date, Priority, Created At, Updated At, Assignee Name, Title
- [ ] Priority order: Urgent=5, High=4, Medium=3, Low=2, None=1; NULL always last
- [ ] Custom field sorting for number and date types

### 4.8 Saved Views

- [ ] `GET /api/projects/[id]/saved-views` — list views (own + shared)
- [ ] `POST /api/projects/[id]/saved-views` — create view
- [ ] `DELETE /api/projects/[id]/saved-views/[vid]` — delete (owner or admin)
- [ ] View stores: `{ name, filters, sort, shared, owner_id }`
- [ ] Sidebar section: list saved views per project; click to apply
- [ ] "Unsaved changes" banner when active view is modified; "Save as new" or "Reset" actions

### 4.9 Column Management (Admin)

- [ ] Add column: "+" button at end of board; inline name input; max 15 columns enforced
- [ ] Rename: double-click column header; Enter or blur to save; 1–50 chars
- [ ] Delete: blocked if column has tasks (API returns 409 with task count); confirmation modal with bulk-move option
- [ ] Reorder: drag column header (dnd-kit); position saved via server action
- [ ] `is_done` flag: one per project; moving tasks to this column triggers `task.completed` event
- [ ] WIP limit: admin sets optional integer cap; orange badge at limit, red when exceeded
- [ ] Column color: pick from 12 preset colors; shown as dot in header

---

## Milestone 5: Polish, Performance & Production Hardening (Sprint 5)
> Theme: Mobile responsive, virtualization, security, E2E tests, observability.

### 5.1 Performance — Virtualization

- [ ] Install `@tanstack/react-virtual`; virtualize card lists within columns
- [ ] Benchmark: board with 1000 tasks scrolls at 60fps
- [ ] Column scroll position preserved across store updates

### 5.2 Mobile Responsive

- [ ] Board: horizontal scroll with snap-to-column at <640px viewport
- [ ] Task drawer: full-width slide-up panel on mobile (not side sheet)
- [ ] Touch targets: minimum 44×44px for all interactive elements (WCAG 2.5.5)
- [ ] Touch sensor for drag-drop on mobile

### 5.3 Visual Indicators & UX Polish

- [ ] Due date: red if overdue, orange if within 48h; relative display ("Tomorrow", "Today", "Yesterday") via `date-fns`
- [ ] Priority color chips: Low=blue, Medium=yellow, High=orange, Urgent=red; no chip for none
- [ ] Board header: project name, member avatar cluster (up to 5 + overflow)
- [ ] Column color dot (admin-assigned)
- [ ] Keyboard navigation: arrow keys between cards, Enter to open drawer
- [ ] Empty column state with subtle illustration

### 5.4 Comment Threading

- [ ] Top-level comments (`parent_id = null`); replies max 1 level deep
- [ ] Thread collapsed by default; "N replies" button to expand
- [ ] Comment body: TipTap rich text (same config as description minus headings)
- [ ] Sorted chronologically; newest at bottom

### 5.5 Task Permalink & Deep Linking

- [ ] Task permalink route: `/tasks?task=:id` (opens drawer)
- [ ] Middle-click / Ctrl+click on task card opens in new tab
- [ ] Navigating to URL with `?task=:id` auto-opens drawer on page load

### 5.6 Right-Click Context Menu

- [ ] Radix UI `ContextMenu` on task cards
- [ ] Options: Quick Edit, Copy Link, Move to Column (submenu), Delete (admin only)
- [ ] Closes on Esc or outside click

### 5.7 Security Hardening

- [ ] API key for webhooks: bcrypt hash in DB; shown once at creation
- [ ] Rate limits via Vercel Edge Config or middleware: 1000 req/min per session, 100/min per API key, 10 uploads/min per user; return 429 + Retry-After
- [ ] SQL injection prevention: parameterized queries only (already enforced by `sql` tagged template)
- [ ] File upload: MIME type validation from magic bytes; block dangerous extensions
- [ ] XSS: DOMPurify sanitization on all rich text before storage
- [ ] CSRF: SameSite cookie (already set by NextAuth) + origin header check on mutations

### 5.8 Error Handling & Edge Cases

- [ ] Concurrent drag-drop: if two users move the same task, last write wins; both get updated state via SSE/polling
- [ ] Stale board detection: periodic poll every 60s to check for missed updates; reconcile Zustand store
- [ ] Network failure: retry server actions with exponential backoff (1→2→4s, max 3 attempts); show persistent error banner after max retries
- [ ] Position gaps: if gap-based positions get too close, run rebalance (set positions to 1000, 2000, 3000…)
- [ ] Deleted user handling: preserve activity log entries; show "[Deleted User]" label

### 5.9 Observability

- [ ] Sentry integration for error tracking (if not already configured)
- [ ] Log webhook processing results (already in `webhook_event_log`)
- [ ] QStash delivery dashboard for outbound webhook monitoring
- [ ] Vercel Analytics for page load performance

### 5.10 Testing Strategy

> **Note:** No test framework is currently configured. Tests are a future enhancement.

- [ ] Evaluate adding Vitest for unit tests or Playwright for E2E
- [ ] Priority test scenarios (if framework added):
  - Task CRUD API routes (all status codes)
  - Permission enforcement (agent vs admin)
  - Drag-drop position calculation
  - Custom field validation per type
  - Webhook idempotency
  - Filter/sort query builder

---

## Quick Reference — API Endpoints (Updated)

| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/projects/[id]/tasks` | Agent+ |
| POST | `/api/projects/[id]/tasks` | Agent+ |
| GET | `/api/tasks/[id]` | Agent+ |
| PATCH | `/api/tasks/[id]` | Agent+ (own/assigned) |
| DELETE | `/api/tasks/[id]` | Admin |
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
| GET/POST | `/api/projects/[id]/custom-fields` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| PATCH | `/api/projects/[id]/webhook-config` | Admin |
| GET | `/api/projects/[id]/webhook-logs` | Admin |
| GET | `/api/notifications/stream` | Agent+ (SSE) |
| GET | `/api/notifications` | Agent+ |
| PATCH | `/api/notifications/[id]/read` | Agent+ |
| PATCH | `/api/notifications/read-all` | Agent+ |
| GET/POST/DELETE | `/api/projects/[id]/saved-views` | Agent+ |
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

**State tracking:**
- `plan.md` → checklist progress (this file)
- `cline.md` → execution history/logs

---

*Rising Lion Platform | Task Management Module | Execution Plan v2.0 (Stack-Aligned) | Based on Implementation Plan v2.0*
