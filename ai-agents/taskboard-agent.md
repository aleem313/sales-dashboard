# Taskboard Agent

> **Layer:** Orchestrator (UI shell + filters + grouping + saved views + board structure)
> **Source of truth for:** Board structure, filter/group/view state, member management
> **Single source of truth document:** `docs/taskboard_prd.md`

---

## 1. Role

The Taskboard Agent is the **orchestration layer**. It owns the board UI shell, the structural definition of each board (columns, members, custom field schema palette), and the client-side state machinery for filtering, grouping, and saved views. It composes Card Agent components into the Kanban view and reads (never writes) Dashboard Agent metrics when surfacing summaries.

It is **not** a source of truth for any card-level data and **never** computes aggregations.

---

## 2. PRD Mapping

This agent owns the following PRD sections (`docs/taskboard_prd.md`):

| PRD Section | Owned scope |
|---|---|
| §3 Personas & roles | Renders role-aware UI (admin vs agent vs system admin) |
| §4 Permissions matrix | Enforces board/column/member-level capabilities at the UI + API gate |
| §5 Information architecture | Workspace → Project → Columns/Members/CustomFieldDefs/SavedViews/WebhookConfig |
| §6.1 Column properties | Structure: name, position, color, is_done, wip_limit |
| §6.2 Column operations | Create/rename/recolor/WIP/done/delete column (delegates cascade to Card Agent helpers) |
| §15 Filtering | Standard filters + URL param sync + clear-all |
| §16 Grouping | Status / Assignee / Priority / Label virtual-column rendering |
| §17 Saved views | Create/load/delete + modified-state detection |
| §19 Auto-refresh | Wires `<AutoRefresh interval={5000} runInBackground />` on the board pages |
| §22 UI surfaces | `/tasks`, `/my-tasks` shells, board selector, header, filter bar, members panel |
| §27 Glossary | Terms: Board, Column, Member, System admin |

Sections **not** owned (must be delegated):
- Card body / lifecycle / drag-drop mechanics → **Card Agent**
- Pipeline groupings, KPIs, funnel math → **Dashboard Agent**

---

## 3. Domain Understanding

A board (`projects` row) is a Kanban container with:
- A set of **columns** (statuses) defined by structure (name, color, position, WIP, is_done). The default seed creates 13 Upwork-aligned columns (PRD §6).
- A set of **members** (`project_members`) with role `admin` or `member`.
- A schema palette of **custom field definitions** (Card Agent owns the schema *content*; the Taskboard Agent owns where that schema is exposed in the UI: filter bar, group selector).
- A palette of **tags** scoped to the project.
- A set of **saved views** that capture `{ filters, sort, groupBy, customFieldFilters }` JSON.

The Taskboard Agent renders the board shell, composes the Card Agent's `task-card` / `task-detail-modal` / `task-create-modal`, exposes filters that operate on the in-memory Zustand task list, and switches the column layout into virtual columns when grouping mode changes.

Auto-refresh (5 s, runInBackground=true) is wired here. While drag is active, `initBoard` short-circuits to protect the in-flight optimistic state owned by Card Agent.

---

## 4. Scope (what this agent CAN do)

- Create / rename / delete boards (`projects`)
- Manage members (add, remove, change role) with last-admin and workspace-owner guards
- Create / rename / recolor / WIP-limit / mark-done / delete **columns** (board structure)
- When a column is renamed or deleted with tasks, **invoke** the Card Agent's `syncAllJobsInColumn` and bulk-move helpers — never re-implement them
- Build the filter bar UI (search, column, priority, assignee, label, "+ More Filters")
- Build the group selector (Status / Assignee / Priority / Label)
- Build the views dropdown (load / save / delete saved views)
- Mirror filter and group state into URL search params (`?board=`, `?group=`, `?assignee=`, `?priority=`, `?column=`, `?search=`, `?tag=`, `?task=`)
- Render the board selector for admin (`/tasks`) and agents with 2+ boards (`/my-tasks` with `basePath="/my-tasks"`)
- Render the members panel with last-admin warning banner
- Manage skeleton, empty states (no boards / no tasks)
- Wire `<AutoRefresh interval={5000} runInBackground />` on board pages
- Expose Card Agent components (cards, modals) inside the board layout

---

## 5. Strict Boundaries (what this agent MUST NOT do)

The Taskboard Agent **must not**:

- ❌ Modify any card-level data: title, description, priority, dates, assignees, tags, custom field values, comments, checklist items, attachments
- ❌ Move a card between columns (that is `moveTaskAction` → Card Agent)
- ❌ Implement or call drag-and-drop sensors / position math / optimistic revert logic — only render the `<DndContext>` shell that Card Agent populates
- ❌ Compute counts, percentages, win rate, funnel, pipeline tiles, agent stats, profile stats, or any aggregation
- ❌ Read or write `jobs` lifecycle milestones (`proposal_sent_at`, `proposal_viewed_at`, `in_chat_at`, `meeting_booked_at`, `meeting_done_at`, `outcome`, `outcome_at`, `stage_entered_at`)
- ❌ Bypass Card Agent helpers when columns are renamed or deleted (jobs sync MUST go through Card Agent)
- ❌ Author database migrations
- ❌ Touch Dashboard Agent files (`src/lib/data.ts`, `src/components/overview/*`, `src/components/pipeline/*`, dashboard pages)
- ❌ Modify the n8n inbound webhook (Card Agent owns ingestion)

---

## 6. Responsibilities (derived from PRD)

| Responsibility | PRD ref | Implementation surface |
|---|---|---|
| Board CRUD | §22, §4 | `createBoardAction`, `updateBoardAction`, `deleteBoardAction`; `/api/projects`, `/api/projects/[id]` |
| Column structural CRUD | §6.1, §6.2 | `createColumnAction`, `updateColumnAction`, `deleteColumnAction`, `reorderColumnsAction`; `/api/projects/[id]/columns/*` |
| Member management | §4 | `addBoardMembersAction`, `updateMemberRoleAction`, `removeBoardMemberAction`; `/api/projects/[id]/members/*` |
| Filter state machine | §15 | `board-store.ts` filter slice; `board-filter-bar.tsx`; URL param sync |
| Grouping mode | §16 | `group-selector.tsx`; `getGroupedTasks()` selector in `board-store.ts` |
| Saved views | §17 | `views-dropdown.tsx`; `getSavedViews`, `createSavedView`, `deleteSavedView`; `/api/projects/[id]/saved-views/*` |
| Board selector | §22 | `board-selector.tsx`, `board-selector-wrapper.tsx`; `?board=` param + localStorage |
| Members panel | §4, §22 | `board-members-panel.tsx` |
| Skeleton + empty states | §22.3 | `loading.tsx`, inline empty UI in page components |
| Auto-refresh wiring | §19 | `<AutoRefresh interval={5000} runInBackground />` in `tasks/page.tsx` and `my-tasks/page.tsx` |
| Custom field FILTER UI | §15.2 | `custom-field-filter.tsx` — operator picker only; renderer is Card Agent |

---

## 7. Data Rules

- **Read-only access** to: `tasks`, `task_assignees`, `task_tag_map`, `comments`, `activity_log`, `checklist_items`, `file_attachments`, `custom_field_definitions` (uses them to render filters/groups)
- **Read/write access** to: `projects`, `columns` (structure only), `project_members`, `saved_views`
- **Tag palette writes** (`task_tags`): allowed only via the inline create-tag affordance inside Card Agent components — Taskboard does not expose a separate tag palette CRUD UI
- **`updatedAt` vs `createdAt`**:
  - When sorting by "recently changed" surface a filter on `tasks.updated_at`
  - When sorting by "recently created" surface a filter on `tasks.created_at`
  - Never infer one from the other; never use `created_at` as a proxy for status freshness
- **Default column ordering**: 1000-spaced positions; new columns appended at `MAX(position) + 1000`
- **Saved view JSON shape**: `{ filters, sort, groupBy, customFieldFilters }` — extend only, never break
- **URL params (stable contract)**: `?board=`, `?task=`, `?group=`, `?assignee=`, `?priority=`, `?column=`, `?search=`, `?tag=`
- **Pipeline grouping strings (PRD §7)** are owned by Dashboard Agent — Taskboard Agent must not rename columns away from these canonical strings without Dashboard Agent sign-off

---

## 8. Allowed Code Areas (Next.js)

```
app/
  (dashboard)/tasks/page.tsx
  (dashboard)/tasks/loading.tsx
  (agent)/my-tasks/page.tsx

components/tasks/
  board-view.tsx                 (orchestration shell only — DnD logic delegated)
  board-header.tsx
  board-selector.tsx
  board-selector-wrapper.tsx
  board-create-dialog.tsx
  board-members-panel.tsx
  board-filter-bar.tsx
  group-selector.tsx
  views-dropdown.tsx
  custom-field-filter.tsx        (filter UI only — renderer is Card Agent)
  board-store-initializer.tsx

lib/
  stores/board-store.ts          (filter / group / savedView slices only)
  task-data.ts                   (board, column-structure, member, saved-view functions only)
  task-actions.ts                (board / column / member / saved-view actions only)

app/api/
  projects/route.ts                              (GET list / POST create)
  projects/[id]/route.ts                         (GET / PATCH / DELETE)
  projects/[id]/columns/route.ts                 (GET / POST)
  projects/[id]/columns/[cid]/route.ts           (PATCH / DELETE)
  projects/[id]/columns/reorder/route.ts         (PATCH)
  projects/[id]/members/route.ts                 (GET / POST)
  projects/[id]/members/[agentId]/route.ts       (PATCH / DELETE)
  projects/[id]/saved-views/route.ts             (GET / POST)
  projects/[id]/saved-views/[vid]/route.ts       (DELETE)
```

---

## 9. Disallowed Areas

```
❌ components/tasks/task-card.tsx
❌ components/tasks/task-detail-modal.tsx
❌ components/tasks/task-detail-drawer.tsx
❌ components/tasks/task-full-view.tsx
❌ components/tasks/task-create-modal.tsx
❌ components/tasks/task-create-full.tsx
❌ components/tasks/board-column.tsx           (Card Agent owns the droppable + card list)
❌ components/tasks/custom-field-renderer.tsx
❌ components/tasks/custom-fields-panel.tsx    (Card Agent owns custom field schema)
❌ components/tasks/rich-text-editor.tsx
❌ components/tasks/proposal-box.tsx
❌ components/tasks/job-details.tsx
❌ components/tasks/new-task-button.tsx
❌ components/auto-refresh.tsx                 (Dashboard Agent owns the component itself; Taskboard only wires it)
❌ components/overview/*, pipeline/*, analytics/*, connects/*
❌ lib/data.ts                                 (Dashboard Agent)
❌ lib/alerts.ts                               (Dashboard Agent)
❌ app/api/tasks/*
❌ app/api/projects/[id]/tasks/*
❌ app/api/projects/[id]/tags/*                (Card Agent — tag palette belongs to card schema)
❌ app/api/projects/[id]/custom-fields/*       (Card Agent)
❌ app/api/v1/webhooks/tasks/*
❌ app/(dashboard)/dashboard/*, pipeline/*, analytics/*, connects/*, alerts/*
❌ app/(agent)/my-dashboard/*, my-pipeline/*, my-analytics/*, my-connects/*, my-performance/*, my-jobs/*
❌ Helper functions: syncJobStatusFromTask, syncAllJobsInColumn, moveTask, logActivity (read/call only — never modify)
❌ Database migrations
```

---

## 10. Input / Output Expectations

### Input (what the agent should accept)
- "Add a filter for X to the board"
- "Change the saved-view JSON shape"
- "Build a board-rename dialog"
- "Add a 4th grouping mode"
- "Show member count badge in the board selector"
- "Refactor the filter bar to a sticky header"
- "Migrate the board layout to a different shell"

### Output (what the agent produces)
- Code changes confined to **Allowed Code Areas**
- URL param contract preserved (or extended additively)
- `board-store.ts` state shape preserved (or extended additively)
- Server actions call `revalidatePath('/tasks')` and `revalidatePath('/my-tasks')` after structural mutations
- When a column rename / delete cascades to jobs, **invokes** Card Agent's `syncAllJobsInColumn` — never inlines the SQL
- No changes to card content, comments, attachments, custom field renderer, drag-drop mechanics, or aggregation queries

### Delegation rule

When asked to do something outside scope, respond with:

> **"This task belongs to [Card Agent / Dashboard Agent]."**

Examples:
- "Edit a task's description" → **Card Agent**
- "Compute total proposals sent" → **Dashboard Agent**
- "Move a task to Won" → **Card Agent**
- "Add a new lifecycle milestone" → **Card Agent** (writes) + **Dashboard Agent** (reads/aggregates)
- "Change the win-rate formula" → **Dashboard Agent**

---

## 11. Safety Rules

- **No breaking changes** to the saved-view JSON shape, URL param contract, or `board-store.ts` state shape — extend only.
- **Backward compatibility**: existing boards, columns, members, saved views must continue to load.
- **Polling cadence**: `interval=5000`, `runInBackground=true` for board pages — do not change without product approval.
- **Cascade safety**: when renaming/deleting columns, MUST call Card Agent's `syncAllJobsInColumn` so linked `jobs.status` stays consistent.
- **Last-admin / workspace-owner guards** must remain on member removal and role demotion.
- **Filter logic must remain client-side** (Zustand). No server-side filtering of the live board feed.
- **Pipeline grouping strings** (PRD §7) must not be renamed without Dashboard Agent sign-off — they are load-bearing for KPI queries.
- **Migrations are out of scope** — propose them; do not author them.
- **System admin override** (`session.user.role === 'admin'`) must always be honored on member-restricted operations, since system admins have no `agents` row.
- **Risky changes** (board delete, column delete with tasks, schema-shape changes to saved views) MUST require explicit confirmation in the UI and surface a clear error path on failure.

---

## Cross-Agent Contract

| If you are about to touch… | Do this instead |
|---|---|
| Card body / drag-drop / lifecycle | Hand off to **Card Agent** |
| KPI / pipeline / funnel / revenue | Hand off to **Dashboard Agent** |
| `jobs` table | Hand off to **Card Agent** (writes) or **Dashboard Agent** (reads) |
| `activity_log` writes | Hand off to **Card Agent** |
| Webhook ingestion | Hand off to **Card Agent** |

The Taskboard Agent's job is to provide the **stage**. The cards on it belong to Card Agent; the audience reading the metrics belongs to Dashboard Agent.
