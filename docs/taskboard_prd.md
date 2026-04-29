# Rising Lions Task Board — Product Requirements Document (PRD)

| | |
|---|---|
| **Document** | Task Board PRD |
| **Version** | 1.0 |
| **Last updated** | 2026-04-29 |
| **Status** | Living document — reflects shipped behavior (Milestones 1–5, 8) |
| **Audience** | Product, engineering, QA, ops; new agents/admins onboarding to the platform |
| **Companion docs** | `plan.md` (execution plan) · `cline.md` (history log) · `task_board_cases.md` (cases & edge cases) · `task_board_ui_audit.md` (component audit) · `agent-guide/AGENT_USER_GUIDE.md` (end-user guide) |

---

## 1. Product summary

The Task Board is the operational layer of the Rising Lions Analytics platform. It is a multi-board Kanban system that:

1. **Tracks every Upwork job** automatically scraped by Vollna and processed by n8n through its lifecycle — from initial proposal to Won/Lost.
2. **Acts as the single source of truth for job status** since ClickUp was removed in Milestone 8. Every column move propagates to the `jobs` table (`status`, `outcome`, lifecycle milestones).
3. **Drives all dashboard analytics** — KPIs, funnel, pipeline tiles, win rate, agent stats, profile stats are computed from `tasks JOIN columns` (with job-level revenue), not from a separate workflow system.
4. **Supports manual work** — admins and agents can create, comment on, and reorganize tasks that were never sourced from n8n ("orphan" tasks).

It runs in two contexts:

- **Admin board** at `/tasks` — full access to all boards, members, columns, custom fields, and saved views.
- **Agent board** at `/my-tasks` — scoped to boards the agent is a member of; cross-board task summary; same editing surface as admin minus destructive actions.

---

## 2. Goals & non-goals

### 2.1 Goals
- Provide a ClickUp-parity Kanban experience tailored for Upwork sales workflows.
- Eliminate any external dependency for job status (no ClickUp, no spreadsheets).
- Auto-ingest scraped Upwork jobs from n8n with zero manual triage required for the happy path.
- Capture rich proposal context (job snapshot, client intel, routing info, generated proposal) inside each task.
- Preserve cumulative funnel history (proposal sent → viewed → in chat → meeting → outcome) even when cards are reversed.
- Run safely on Vercel serverless (no WebSockets, no long-lived workers) and on a self-hosted Contabo Postgres mirror.

### 2.2 Non-goals
- Real-time collaborative editing (no WebSockets / OT). Updates are propagated via 5-second smart polling.
- Replacing the analytics dashboard surfaces — the board feeds them; it does not duplicate them.
- Cross-workspace sharing or external guest links.
- Mobile-first design (desktop-first; mobile is acceptable but not optimized — see §13 future work).

---

## 3. Personas & roles

| Role | Authentication | Where they work | What they see |
|------|----------------|-----------------|---------------|
| **System admin** | `ADMIN_CREDENTIALS` env var (no row in `agents`) | `(dashboard)/*` route group | All boards, all tasks, all members, settings |
| **Project admin** | Member with `project_members.role = 'admin'` | `(dashboard)/*` route group | Boards they admin: full member/column/field control |
| **Project member (agent)** | Member with `project_members.role = 'member'` | `(agent)/my-*` route group | Only boards they are a member of; their own tasks across boards |

Notes:
- System admins **bypass** `project_members` checks (the agentId is null, membership lookup is skipped). This is the universal override that prevents lockout when no project admin exists.
- Agents are redirected away from `(dashboard)/*` to `/my-dashboard` by middleware (`src/middleware.ts`).
- Agents are forced to operate on `agentId = session.user.agentId`. There is no `?agent=` query-param override for agent pages.

---

## 4. Permissions matrix

| Capability | System admin | Project admin | Member |
|------------|:---:|:---:|:---:|
| View board | ✅ all boards | ✅ admined boards | ✅ member boards |
| Create board | ✅ | ❌ | ❌ |
| Rename board | ✅ | ✅ | ❌ |
| Delete board | ✅ | ✅ | ❌ |
| Add/remove members | ✅ | ✅ | ❌ |
| Change member role | ✅ | ✅ (cannot demote last admin) | ❌ |
| Create/rename/recolor column | ✅ | ✅ | ❌ |
| Set column WIP limit | ✅ | ✅ | ❌ |
| Mark column as Done | ✅ | ✅ | ❌ |
| Delete column (empty) | ✅ | ✅ | ❌ |
| Delete column (with tasks) | ✅ | ✅ (must select target column to receive tasks) | ❌ |
| Reorder columns | ✅ | ✅ | ❌ |
| Create task | ✅ | ✅ | ✅ |
| Edit any task field | ✅ | ✅ | ✅ |
| Move task across columns | ✅ | ✅ | ✅ |
| Delete task | ✅ | ✅ | ❌ |
| Create custom field | ✅ | ✅ | ❌ |
| Edit/archive custom field | ✅ | ✅ | ❌ |
| Reorder custom fields | ✅ | ✅ | ❌ |
| Create tag | ✅ | ✅ | ✅ |
| Edit/delete tag | ✅ | ✅ | ❌ |
| Comment on task | ✅ | ✅ | ✅ |
| Edit own comment (≤60 min) | ✅ | ✅ | ✅ |
| Delete own comment (≤60 min) | ✅ | ✅ | ✅ |
| Delete any comment | ✅ | ✅ | ❌ |
| Toggle checklist items | ✅ | ✅ | ✅ |
| Upload attachment | ✅ | ✅ | ✅ |
| Delete attachment | ✅ (any) | ✅ (any) | ✅ (own only) |
| Save shared view | ✅ | ✅ | ❌ |
| Save private view | ✅ | ✅ | ✅ |
| Receive n8n webhook tasks | n/a (system) | n/a | n/a |

Last-admin guard: cannot demote or remove the last project admin or the workspace owner.

---

## 5. Information architecture

```
Workspace (e.g. "Rising Lion")
└── Project (a.k.a. Board, e.g. "Task Board")
    ├── Columns (statuses)            ←── seeded with 13 Upwork-aligned defaults
    ├── Tasks                         ←── linked to jobs via custom_fields._job_id
    │   ├── Assignees (agents)
    │   ├── Tags (labels)
    │   ├── Custom field values (JSONB)
    │   ├── Checklist items
    │   ├── Comments (threaded, soft-deletable)
    │   ├── Attachments (Vercel Blob)
    │   └── Activity log (append-only)
    ├── Custom field definitions      ←── per-project schema
    ├── Tags                          ←── per-project palette
    ├── Saved views                   ←── filter+sort+group presets
    └── Webhook config                ←── inbound Bearer token, optional outbound URL
```

Each agent belongs to one or more projects via `project_members`. Each profile (e.g. "Sana", "Rebekah") is owned by exactly one agent — that ownership drives n8n routing.

---

## 6. Statuses (columns) — full enumeration

The board is seeded with **13 default columns**. A 14th column, "Proposal Views", is recognized as a lifecycle stage in code but is not seeded; admins may add it manually. Up to **20 columns** are allowed per board.

| # | Default column | Color | `is_done` | Pipeline group | Funnel stage | Description / when used |
|---|----------------|-------|:---:|----------------|--------------|-------------------------|
| 1 | **Todo** | `#6b7280` (gray) | — | Untouched | — | New incoming task that hasn't been actioned. Manually-created or imported tasks land here unless n8n provides a column. Sort: newest-first (overrides priority sort). |
| 2 | **Proposal Submitted** | `#3b82f6` (blue) | — | In Progress | Proposals Sent | Proposal has been sent to the client. n8n auto-creates tasks at this status when proposal generation succeeds. Sets `jobs.proposal_sent_at`. |
| (2.5) | **Proposal Views** *(optional, not seeded)* | — | — | In Progress | Proposals Viewed | Client has opened/viewed the proposal. Recognized by `proposal_viewed_at` lifecycle code (`['proposal views', 'proposal viewed', 'viewed']`). |
| 3 | **Prototype Required** | `#eab308` (amber) | — | In Progress | Proposals Sent | Client requested a prototype/sample before continuing. |
| 4 | **Prototype Done** | `#22c55e` (green) | — | In Progress | Proposals Sent | Prototype built but not yet delivered to client. |
| 5 | **Prototype Submitted** | `#14b8a6` (teal) | — | In Progress | Proposals Sent | Prototype has been delivered to client; awaiting feedback. |
| 6 | **In Chat** | `#8b5cf6` (violet) | — | In Progress | In Chat | Active conversation with client. Sets `jobs.in_chat_at`. Also matches "Following Up". |
| 7 | **Meeting Scheduled** | `#6366f1` (indigo) | — | Meetings | Meetings Booked | Discovery call/intro meeting on the calendar. Sets `jobs.meeting_booked_at`. |
| 8 | **Meeting Done** | `#06b6d4` (cyan) | — | Meetings | Meetings Booked | Meeting completed; awaiting next step. Sets `jobs.meeting_done_at`. |
| 9 | **Negotiation** | `#f97316` (orange) | — | Negotiation | Meetings Booked | Discussing scope, price, or timeline. |
| 10 | **Lost** | `#ef4444` (red) | — | (terminal) | Lost | Client declined or went silent. Sets `jobs.outcome='lost'`, `jobs.outcome_at=NOW()`. |
| 11 | **On Hold** | `#f59e0b` (amber-deep) | — | In Progress | — | Paused by client or internally. Excluded from active funnel calculations. |
| 12 | **N/A** | `#9ca3af` (slate) | — | (bad lead) | Bad Leads | Junk/disqualified. Triggers conditional **Reason** multi-select on the task (see §8.4). |
| 13 | **Won** | `#10b981` (emerald) | ✅ | (terminal) | Won | Deal closed. Sets `jobs.outcome='won'`, `jobs.outcome_at=NOW()`. The `is_done` flag (only one per board) lives here. |

### 6.1 Column properties

Per column:
- `name` (unique within project)
- `position` (1000-spaced gaps)
- `color` (hex; 12 presets in the picker)
- `is_done` (only one column per board can be true)
- `wip_limit` (optional integer; UI badge shows `count/limit`, with red highlight when exceeded)

### 6.2 Column operations

- **Create** ("+ Add Status" at end of row): inline name input → appended.
- **Rename** (admin): double-click header or context menu. On rename, all linked jobs in that column have `jobs.status` bulk-updated via `syncAllJobsInColumn`.
- **Recolor** (admin): 12-preset color picker.
- **Set WIP limit** (admin): integer input; 0/empty disables.
- **Mark/unmark Done** (admin): toggles `is_done`; trigger ensures only one column has it.
- **Delete empty column** (admin): single-click delete.
- **Delete column with tasks** (admin): dialog forces selection of a target column to receive tasks; bulk-moves tasks then deletes; updates linked jobs' status to target column name.
- **Reorder** (admin, planned): drag-to-reorder is deferred — currently exposed via the API only.

---

## 7. Pipeline groupings (computed from columns)

These groupings are used by dashboard surfaces (`/pipeline`, `/dashboard`) and are derived from column names — not stored. **Pipeline groupings affect dashboard math, not board layout.**

| Group | Member columns |
|-------|---------------|
| **Untouched** | Todo |
| **In Progress** | Proposal Submitted, Proposal Views, Prototype Required, Prototype Done, Prototype Submitted, In Chat, On Hold |
| **Meetings** | Meeting Scheduled, Meeting Done |
| **Negotiation** | Negotiation |
| **Won** *(terminal)* | Won |
| **Lost** *(terminal)* | Lost |
| **Bad Leads** *(terminal-ish)* | N/A |

If a board column is renamed away from these strings, the pipeline math will not include it — keep these names stable.

---

## 8. Tasks

### 8.1 Task fields

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `id` | UUID | server | PK |
| `project_id` | UUID FK | server | The board the task lives on |
| `column_id` | UUID FK | user | Current status column |
| `title` | text | required | Format from n8n: `[profile] Job Title` |
| `description` | text (HTML) | optional | Edited via TipTap rich-text editor |
| `priority` | enum | optional | `urgent` · `high` · `medium` · `low` · null |
| `due_date` | timestamptz | optional | Auto-set to NOW + 24h on n8n-sourced tasks |
| `start_date` | timestamptz | optional | Editable in detail view |
| `position` | integer | server | 1000-spaced; midpoint insertion |
| `creator_id` | UUID FK | server | The agent who created (or null for webhook) |
| `custom_fields` | JSONB | mixed | Holds both formal field values keyed by field-def UUID **and** n8n underscore-prefixed metadata (`_job_id`, `_proposal`, etc.) |
| `created_at` | timestamptz | server | |
| `updated_at` | timestamptz | server | Auto-updated by trigger |

### 8.2 Task lifecycle on the board

```
[create]                              [drag]              [drag]
   │   ┌────────────────────────────────┐   ┌──────────────┐
   ▼   ▼                                │   ▼              │
  Todo ───► Proposal Submitted ───► …──┴► Won  (or)  Lost ─┘  (reversal supported)
```

- A task can move freely between any columns. The board enforces no order constraints.
- Moves are **optimistic**: the UI updates instantly; a server failure rolls back via `revertMove()`.
- A 5-second toast offers **Undo** after every successful drag.
- Reversals from terminal Won/Lost are detected: `outcome` and `outcome_at` are cleared on the linked job, but lifecycle milestones (`proposal_sent_at`, etc.) are preserved.

### 8.3 Sort order within a column

Universal sort across all columns:
1. **Priority**: urgent → high → medium → low → none
2. **Last status update** (`last_status_at`) DESC: timestamp of the most recent `task_moved` activity_log row for the task; falls back to `created_at` when the task has never moved
3. **Created at** DESC

This rule replaces the prior Todo-special-case (which was strict `created_at DESC`); under the new rule, a freshly-created Todo task has `last_status_at = created_at` so newest-first behavior is preserved for the common case.

### 8.4 Conditional fields

When a task's column = `N/A`, a multi-select **Reason** field appears in the detail view with these 14 options (stored at `custom_fields._reason`):

> Old job · Duplicate · Location loc · Low Higher rate · Language barrier · Too many invites · Video Proposal · Client suspended · Portfolio unavailable · Client Low spending · Bad rating client · Job unavailable · Already hired · Out of stack

The reason is also exposed as a virtual filter operator (`contains_any`, `contains_all`) in the More Filters panel.

### 8.5 Task card display

Card hover/click is the entry point to the detail view. Card shows:

- Status color stripe (left border, column color)
- Priority flag + title (2-line clamp)
- Up to 3 tag chips ("+N" overflow)
- Custom fields with `show_on_card = true` (max 3, compact `Label: Value` rows)
- Bottom bar: assignee avatars (max 3 + overflow), due date chip (red if overdue, orange if ≤48h), comment count, attachment count, checklist progress (`X/Y`), time tracking
- "..." context menu on hover: **Edit**, **Move to →** (column submenu), **Copy Link**, **Delete** (admin only)

### 8.6 Task detail view

Two equivalent surfaces (modal at 95vw × 90vh on card click; full-page at `/tasks/[id]` which redirects to `?task=` and reopens the modal). Layout:

- **Column 1**: Title (click-to-edit), status (column dropdown), priority, assignees (multi-select with search), tags (chip + create new), due date, start date, time estimate / time tracked, connects used, boosted connects, conditional reason field.
- **Column 2**: Editable structured sections — **Job Snapshot** (link, budget, skills, posted), **Client Intel** (location, rating, total spent, past hires), **Routing Info** (agent, profile, stack, job ID, generated). All read from / write to `custom_fields`.
- **Column 3**: Editable proposal box (ClickUp-style formatting for hooks, bullets, emphasis lines like `BUT…`, `P.S:`).
- **Below the columns**: Description (rich text), Checklist, Attachments, Comments + Activity Log tab toggle.

---

## 9. Custom fields

### 9.1 Field types & operators

| Field type | Storage | UI editor | Filter operators |
|------------|---------|-----------|------------------|
| `text` | string | text input | equals, contains, is_empty, is_not_empty |
| `number` | number | number input (NaN rejected) | equals, gt, lt |
| `dropdown` | string (one option) | single-select | equals |
| `multi_select` | string[] | checkbox list | contains_any, contains_all |
| `date` | ISO date string | date picker | before, after, in_range (with presets) |
| `boolean` | true/false | toggle | is_true, is_false |

Field type is **immutable** after creation (data integrity guarantee).

### 9.2 Field definition properties

- `name` (display label)
- `field_type` (locked after create)
- `options` (JSONB array — required for dropdown / multi-select)
- `required` (boolean — blocks task save if missing)
- `position` (display order; up/down arrow reorder)
- `archived` (hidden from UI, values preserved)
- `show_on_card` (renders compact Label:Value on the card)

Values are stored under `tasks.custom_fields[field_def_uuid] = value`. A GIN index on `tasks.custom_fields` supports server-side JSONB filtering when needed.

### 9.3 Pre-seeded custom field definitions (migration 009)

The default board ships with 14 formal definitions auto-mapped from n8n payloads:

| # | Name | Type | Group | Show on card |
|---|------|------|-------|:---:|
| 1 | Job Link | text | Job Details | — |
| 2 | Budget | text | Job Details | ✅ |
| 3 | Skills | text | Job Details | ✅ |
| 4 | Posted | date | Job Details | — |
| 5 | Location | text | Client Info | — |
| 6 | Rating | number | Client Info | — |
| 7 | Total Spent | text | Client Info | — |
| 8 | Past Hires | number | Client Info | — |
| 9 | Agent | text | Routing Info | ✅ |
| 10 | Profile | text | Routing Info | ✅ |
| 11 | Stack | text | Routing Info | — |
| 12 | Job ID | text | Routing Info | — |
| 13 | Generated | date | Routing Info | — |
| 14 | Proposal | text | Proposal | — |
| 15 | Boosted Connects | number | Connects | — |

### 9.4 Reserved underscore-prefixed keys

The webhook stores raw n8n metadata under `custom_fields` keys prefixed with `_`. These are **not** custom field definitions — they are mapped on read by the formal-field renderer:

- `_job_id` · `_job_url` · `_budget` · `_skills` · `_proposal` · `_assigned_agent` · `_profile_name` · `_source` · `_stack` · `_generated` · `_client_country` · `_client_rating` · `_client_spent` · `_client_hires` · `_reason` · `_time_estimate_minutes` · `_time_tracked_minutes`

---

## 10. Tags (labels)

- Per-project palette (no shared global tags).
- Properties: `name`, `color` (hex; default `#6b7280`).
- Created inline from any tag-picker via "Create new" affordance.
- Card shows up to 3 tag chips, overflow as `+N`.
- The webhook auto-creates two tags on n8n tasks: `<profile_name>` (color `#3b82f6`) and `vollna-auto` (color `#8b5cf6`).

---

## 11. Comments

- Threaded one level deep (`parent_id` on `comments`; replies cannot have replies).
- Edit window: **60 minutes** for the author; admins can edit any comment any time.
- Soft delete: `deleted_at` set, `body` replaced with `[deleted]`. Deleted comments stay in the thread for context.
- "(edited)" badge on edited comments; reply count shown per top-level comment.
- The detail-view tab toggle: **Comments** (bubbles only) / **All** (interleaved with activity log).

---

## 12. Activity log

Every state-changing action creates an append-only entry. Trigger on the table blocks UPDATE; DELETE is allowed only for cascade.

### 12.1 Action types

| `action_type` | Emitted by | Stores |
|---------------|------------|--------|
| `task_created` | createTask | metadata: column id, creator |
| `task_moved` | moveTask | field=`column_id`, old/new = column names |
| `field_changed` | updateTask | field name + old + new value (per field) |
| `assignees_changed` | setTaskAssignees | old/new = comma-joined agent names |
| `tags_changed` | setTaskTags | old/new = comma-joined tag names |
| `comment_added` | createComment | metadata: comment_id, parent_id |
| `checklist_item_added` | createChecklistItem | metadata: item_id, title |
| `checklist_item_toggled` | toggleChecklistItem | metadata: item_id, checked |
| `attachment_added` | upload route | metadata: filename, size |
| `attachment_deleted` | delete route | metadata: filename |

Actor is recorded as `actor_id` (FK → agents) or `actor_label` (e.g. `"Automation (n8n)"`) when triggered by a webhook.

### 12.2 Cumulative funnel impact

The activity log is the **substrate for cumulative funnel KPIs**. `getKPIMetrics` and `getPipelineStages` build an `activity_history` CTE that aggregates every column name visited per task (from `task_moved` rows) and tests stage-by-stage overlap. This is what makes the funnel history-accurate even when cards are dragged through columns out of order. **Any tooling that mutates a task without going through `moveTask` will be invisible to the funnel.**

---

## 13. Checklist (sub-tasks)

- Items are inline children of a task: title + checkbox + optional position.
- Bulk add via paste (each newline becomes one item).
- Card shows `checked/total` progress with a thin progress bar.
- Drag-to-reorder is deferred (M7 polish).

---

## 14. Attachments

- Stored in **Vercel Blob**; metadata in `file_attachments` (filename, blob_path, size_bytes, mime_type, uploader_id).
- Max **10 MB** per file (validated client + server).
- Image vs file icon by MIME; image attachments render an inline thumbnail when one is generated.
- Delete: uploader (always) or admin (any).

---

## 15. Filtering

Filters are evaluated client-side from the Zustand board store (`getFilteredTasks()`). State is mirrored in the URL search params for shareable links.

### 15.1 Standard filters

| Filter | Type | URL param | Operators |
|--------|------|-----------|-----------|
| Search | text | `search=` | substring (ILIKE-style, case-insensitive) — matches title and description |
| Column (status) | single | `column=` | equals |
| Priority | single | `priority=` | equals (`urgent` / `high` / `medium` / `low`) |
| Assignee | single | `assignee=` | equals (agent id, or `unassigned`) |
| Label / Tag | single | `tag=` | equals |

All standard filters combine with **AND** logic.

### 15.2 More Filters (custom fields)

A second-tier expandable section adds per-custom-field conditions, each as a `{ fieldId, operator, value }` triple. Conditions combine with **AND**.

The virtual `_reason` field is injected into this list so reasons can be filtered without a formal field definition.

### 15.3 Clear filters

A "Clear all" affordance resets every dimension and removes URL params.

---

## 16. Grouping (board view modes)

The Group selector switches the column layout from status-by-default to virtual columns:

| Group by | URL param | Virtual columns |
|----------|-----------|-----------------|
| Status (default) | `group=status` | Real columns from the board |
| Assignee | `group=assignee` | One per project member + "Unassigned" |
| Priority | `group=priority` | Urgent · High · Medium · Low · None |
| Label | `group=label` | One per tag + "No label" |

Drag-and-drop is disabled on non-status grouping (cards are read-only-positioned within virtual columns) — re-grouping by status restores DnD.

---

## 17. Saved views

A view is `{ name, filters, sort, group_by, custom_field_filters }` stored as JSONB on `saved_views`. Views can be private (default) or shared with the project (admin only).

- Load: select from the views dropdown → board state replaced.
- Save: capture current state under a name.
- Modified indicator: when the active view's stored filters/group don't match current state, a "Modified" badge appears.
- Delete: admin only for shared views; owner-only for private views.

---

## 18. Drag-and-drop

- Library: `@dnd-kit/core` + `@dnd-kit/sortable`.
- Sensors: `PointerSensor` (8 px activation distance) + `TouchSensor` (200 ms delay).
- Collision detection: `closestCorners` so cards drop cleanly across columns.
- The **entire card** is draggable (no separate grip handle).
- Drag overlay: ghost card at 90% opacity, slight rotation.
- Drop target column gets a primary-color ring highlight via `useDroppable`.
- On `onDragStart` → `savePreviousState`. On `onDragEnd` → `moveTaskAction`. On failure → `revertMove()` + sonner error toast.
- Position math: 1000-spaced; midpoint insertion `floor((before + after) / 2)`. ~10 deep insertions before precision strain (rare in practice; rebalancing planned for M7).

---

## 19. Auto-refresh & smart polling

The board uses `<AutoRefresh interval={5000} runInBackground />` (every 5 seconds) which calls `router.refresh()`. This triggers Next.js to re-fetch server-component data without a full reload.

- Behavior: with `runInBackground=true`, polls even when the tab is hidden (so n8n-created tasks appear quickly when the user returns).
- Drag-and-drop is **immune** — the board store's `initBoard` short-circuits while `isDragging` is true, preventing stale server data from clobbering an in-flight optimistic move.
- Other dashboard pages poll at 15 s; only the task board polls at 5 s.

No WebSockets, no SSE (M7 work).

---

## 20. n8n inbound webhook

`POST /api/v1/webhooks/tasks` is the single ingestion path for automated jobs.

### 20.1 Authentication

- `Authorization: Bearer <token>`
- Server hashes the token with SHA-256 and looks it up in `webhook_configs.inbound_api_key_hash`. Default token in production is `n8n-board-sync`.
- If no config matches, the webhook **falls back to the default project** so onboarding works before explicit config exists.
- Returns 401 if neither match.

### 20.2 Idempotency

- Optional `Idempotency-Key` header.
- Stored in `stats_cache` with 24 h TTL; replays return the cached response.

### 20.3 Accepted payload

```jsonc
{
  "title": "[Sana] Build a SaaS dashboard with Next.js",   // required
  "description": "<html>…</html>",                          // optional, rich
  "column_id": "uuid",                                      // optional; defaults to first column
  "priority": "medium",                                     // urgent|high|medium|low
  "due_date": "2026-04-30T17:00:00Z",                       // optional; auto +24h on n8n
  "assignee_ids": ["uuid"],                                 // optional; auto-resolved from _assigned_agent
  "tag_ids": ["uuid"],                                      // optional; auto-created on n8n
  "custom_fields": {
    "_source": "n8n",
    "_job_id": "1234567890",
    "_job_url": "https://www.upwork.com/jobs/~012345",
    "_budget": "$1000–$3000",
    "_skills": ["Next.js", "TypeScript"],
    "_proposal": "Hi there, …",
    "_assigned_agent": "Sana",
    "_profile_name": "Sana",
    "_stack": "Next.js + Postgres",
    "_generated": "2026-04-29T14:00:00Z",
    "_client_country": "United States",
    "_client_rating": 4.95,
    "_client_spent": "12500",
    "_client_hires": 7
  }
}
```

### 20.4 Behavior on n8n source

When `custom_fields._source === "n8n"`:

1. **Dedup check** — if a task with the same `(_job_id, _profile_name)` already exists in this project, return `200 { duplicate: true }` without creating.
2. **Auto-assignee** — if no `assignee_ids` and `_assigned_agent` is set, look up the agent by name (case-insensitive) in `agents`, verify they're in `project_members`, and assign.
3. **Auto due date** — if no `due_date`, set NOW + 24h.
4. **Auto tags** — if no `tag_ids`, find/create two tags: `<_profile_name>` (blue) and `vollna-auto` (purple).
5. **Custom field mapping** — map underscore keys to formal `custom_field_definitions` by name (e.g. `_job_url` → "Job Link"). Unmapped keys remain as raw underscore values for the structured detail view.
6. **Logging** — append to `webhook_event_log` with status_code and full payload.

### 20.5 Validation errors (422)

Returned with `{ error, fields: { fieldName: message } }`:
- `title` missing or empty
- `priority` not in enum
- `column_id` references a non-existent column (response includes valid column ids)
- `assignee_ids` references non-members

### 20.6 Parallel deployment

Both the Vercel and Contabo dashboards receive the same payload simultaneously from the n8n workflow (`Send to Dashboard` + `Send to Self-Hosted Dashboard`). Both sinks use `neverError: true` so a down environment never breaks the pipeline.

---

## 21. Job ↔ Task linkage and lifecycle

### 21.1 Linkage

Each n8n-sourced task carries `custom_fields._job_id` (Vollna's Upwork job id). A nullable `jobs.task_id` FK exists from migration 012 but is rarely written; **the canonical lookup is the JSONB key**:

```sql
SELECT * FROM jobs
WHERE task_id = ${taskId}
   OR job_id = (SELECT custom_fields->>'_job_id' FROM tasks WHERE id = ${taskId})
```

### 21.2 Sync on column move

`syncJobStatusFromTask(taskId, newColumnName, oldColumnName?)` fires from `moveTaskAction` after every drag-drop. It updates the linked job atomically:

| Trigger | Effect on the linked job |
|---------|---------------------------|
| Always | `status = newColumnName`, `stage_entered_at = NOW()` |
| New column = `Won` | `outcome='won'`, `outcome_at=NOW()` |
| New column = `Lost` | `outcome='lost'`, `outcome_at=NOW()` |
| Old column was Won/Lost, new column isn't | `outcome=NULL`, `outcome_at=NULL` (reversal) |
| Entering Proposal Submitted (or beyond) | `proposal_sent_at = COALESCE(proposal_sent_at, NOW())` |
| Entering Proposal Views/Viewed | `proposal_viewed_at = COALESCE(...)` |
| Entering In Chat / Following Up | `in_chat_at = COALESCE(...)` |
| Entering Meeting Scheduled | `meeting_booked_at = COALESCE(...)` |
| Entering Meeting Done | `meeting_done_at = COALESCE(...)` |

The `COALESCE` pattern guarantees **first-reach preservation**: even if a card is reversed from Won back to Negotiation, the original `proposal_sent_at` (and every other milestone reached) stays intact. This is what powers the cumulative funnel.

### 21.3 Sync on column rename

`syncAllJobsInColumn(columnId, newColumnName)` bulk-updates `jobs.status` for every linked task in the renamed column. Without this, dashboards would show stale status text after an admin rename.

### 21.4 Critical caveat

External API calls to `PATCH /api/tasks/[id]/move` move the task but **do not** sync the job. Only the server action path (`moveTaskAction`, used by the UI) propagates to `jobs`. Any future API consumer that moves tasks must call sync explicitly.

---

## 22. UI surfaces

### 22.1 Admin (`/tasks`)

- Top bar: project title, board selector (with task counts), member avatars (with members panel), settings/custom-fields/views buttons, "+ New Task" button.
- Filter bar: search · column · priority · assignee · label · "+ More Filters" expandable.
- Group selector: Status / Assignee / Priority / Label.
- Board: horizontal flex of columns, 280 px wide each, per-column "+" button.
- Detail: modal at 95vw × 90vh on click; deep-linkable via `?task=<id>`.

### 22.2 Agent (`/my-tasks`)

- Same layout as admin, minus board CRUD and member management.
- Board selector shown only when agent has 2+ boards (URL param + `basePath="/my-tasks"`).
- Cross-board summary: "X tasks total across Y boards" when applicable.
- Header includes self-only agent dropdown and own-profile dropdown for date/timezone scoping.
- Unassigned-task visibility: agents see unassigned tasks scoped to their current board only (so they can pick up work) but never see unassigned tasks on other boards.

### 22.3 Loading skeleton

Skeleton mirrors the real header (icon + selector + avatars) and 4 ghost columns with varied card counts. Used by both Suspense boundaries and `loading.tsx`. After hydration, each column shows up to 5 cards and a sentinel that loads 10 more on scroll.

---

## 23. Data model summary

```
workspaces ──< projects ──< project_members
                         ├──< columns ──< tasks ──< task_assignees
                         │                        ├──< task_tag_map >── task_tags
                         │                        ├──< comments
                         │                        ├──< checklist_items
                         │                        ├──< file_attachments
                         │                        └──< activity_log     (append-only)
                         ├──< custom_field_definitions
                         ├──< saved_views
                         ├──< webhook_configs ──< webhook_event_log
                         └──< notifications
                                                    
jobs ── (linked via tasks.custom_fields->>'_job_id' OR jobs.task_id)
```

### 23.1 Migration history affecting the board

| # | File | What it adds |
|---|------|--------------|
| 006 | `006_task_management_schema.sql` | 18 task tables, 14 indexes, 3 triggers, default seed |
| 007 | `007_fix_activity_log_trigger.sql` | Allows DELETE on activity_log (for cascade); blocks UPDATE only |
| 009 | (in migrate route) | 14 default custom field definitions |
| 010 | `010_profile_platform.sql` | `profiles.platform` column |
| 012 | `012_remove_clickup_dependency.sql` | `clickup_status → status`, `jobs.task_id` FK, nullable `clickup_user_id` |
| 013 | `013_lifecycle_milestones.sql` | `jobs.meeting_booked_at` + backfill |
| 014 | (in migrate route) | `jobs.proposal_viewed_at`, `in_chat_at`, `meeting_done_at` + backfill |
| 015 | `015_stage_entered_at_filter.sql` | `jobs.stage_entered_at` default + index, wipes `stats_cache` |

---

## 24. API surface

### 24.1 Project / board

| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/projects` | Member |
| POST | `/api/projects` | Admin |
| GET / PATCH / DELETE | `/api/projects/[id]` | Member / Admin / Admin |
| GET | `/api/projects/[id]/members` | Member |
| POST | `/api/projects/[id]/members` | Admin |
| PATCH / DELETE | `/api/projects/[id]/members/[agentId]` | Admin |

### 24.2 Columns

| Method | Endpoint | Access |
|--------|----------|--------|
| GET / POST | `/api/projects/[id]/columns` | Member / Admin |
| PATCH / DELETE | `/api/projects/[id]/columns/[cid]` | Admin |
| PATCH | `/api/projects/[id]/columns/reorder` | Admin |

### 24.3 Tasks

| Method | Endpoint | Access |
|--------|----------|--------|
| GET / POST | `/api/projects/[id]/tasks` | Member |
| GET / PATCH / DELETE | `/api/tasks/[id]` | Member / Member / Admin |
| PATCH | `/api/tasks/[id]/move` | Member (does **not** sync jobs) |
| GET / POST / DELETE | `/api/tasks/[id]/attachments` | Member |
| GET / POST | `/api/tasks/[id]/comments` | Member |
| PATCH / DELETE | `/api/tasks/[id]/comments/[cid]` | Author ≤60 min / Admin |
| GET | `/api/tasks/[id]/activity` | Member |

### 24.4 Tags / custom fields / saved views

| Method | Endpoint | Access |
|--------|----------|--------|
| GET / POST | `/api/projects/[id]/tags` | Member / Member |
| PATCH / DELETE | `/api/projects/[id]/tags/[tid]` | Admin |
| GET / POST | `/api/projects/[id]/custom-fields` | Member / Admin |
| PATCH / DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| PATCH | `/api/projects/[id]/custom-fields/reorder` | Admin |
| GET / POST | `/api/projects/[id]/saved-views` | Member / Member |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Owner / Admin |

### 24.5 Webhooks

| Method | Endpoint | Access |
|--------|----------|--------|
| POST | `/api/v1/webhooks/tasks` | Bearer token |

---

## 25. Non-functional requirements

### 25.1 Performance

- Initial board load target: < 1.5 s for 200 tasks across 13 columns on a typical broadband connection.
- Drag-drop: visually instant (optimistic). Server round-trip for `moveTaskAction` should complete < 400 ms p95.
- Polling: 5 s interval is acceptable load on Vercel serverless.
- Per-task batch loading (`getProjectTasks` does N+1 queries for assignees/tags). Acceptable up to ~10 k tasks per board; future work: virtualization (`@tanstack/react-virtual`) and consolidated queries.
- Per-column pagination: each column initially renders 5 cards and loads 10 more on scroll via `IntersectionObserver` rooted on the column's own scroll container. Total counts come from a separate filter-aware aggregate query so column badges always reflect the full filtered total independent of the loaded slice. Drag-and-drop adjusts counts optimistically and falls back to server-side position computation (`MAX(position) + 1000`) when dropping past a column's loaded tail. Polling refresh (`BoardAutoRefresh`, 5 s) re-fetches each column's loaded window with `includeCount=1` so counts stay live and scroll-loaded tails are preserved across ticks.

### 25.2 Reliability

- Webhook idempotency via `stats_cache` (24 h TTL).
- Webhook dedup on `(_job_id, _profile_name)` tuple.
- Vercel + Contabo dual deploy; both receive every webhook.
- All migrations idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).

### 25.3 Security

- All non-webhook API routes gated by NextAuth session (`auth()`).
- All data-mutating routes call `isProjectMember(projectId, agentId)` (system admin bypasses).
- Webhook tokens hashed (SHA-256, future: bcrypt — M7 hardening).
- Bearer secret in env vars, never in source.
- Rich text sanitized by TipTap on the editor side; future hardening: DOMPurify on the render side (M7).
- File uploads: 10 MB limit, server- and client-validated MIME (M7 hardening: extension blocklist).

### 25.4 Auditability

- `activity_log` is append-only and the substrate for all funnel/historical reporting.
- `webhook_event_log` retains every inbound payload.

---

## 26. Out of scope / future work

These are tracked in `plan.md` as Milestones 6 and 7.

### 26.1 M6 — Outbound automation
- Outbound webhooks via QStash (6 event types: `task.created`, `task.status_changed`, `task.completed`, `task.assigned`, `task.due_soon`, `comment.added`)
- HMAC-SHA256 outbound signatures
- Loop-prevention via `X-Rising-Lion-Source` header
- Visual webhook field mapper UI
- Webhook event log viewer with payload expand + CSV export

### 26.2 M7 — Notifications, performance, polish
- 7 in-app notification types (assignment, mention, due-soon, overdue, status changed, comment, workspace invite)
- SSE streaming endpoint with poll fallback
- `@tanstack/react-virtual` for column virtualization (> 1 000 cards)
- Position rebalancing when gaps converge
- Mobile responsive (snap-to-column scroll, full-width slide-up drawer, ≥ 44 px touch targets)
- Keyboard nav (arrow keys between cards, `/` for search, Esc to close)
- Cron routes: `/api/cron/due-soon` (hourly), `/api/cron/overdue` (daily 8am)
- Security hardening: bcrypt webhook keys, rate limits (1000/min session, 100/min API), DOMPurify, MIME validation

### 26.3 Other deferred items
- Drag-to-reorder columns (currently API-only)
- Drag-to-reorder checklist items
- Rich-text comments (reuse TipTap)
- Permission-based public task sharing (`is_public` flag)
- Real WebSocket transport (blocked by Vercel serverless)

---

## 27. Glossary

| Term | Definition |
|------|------------|
| **Board** | A `project` row. The Kanban container holding columns, tasks, members, custom fields, tags, saved views. |
| **Column / Status** | A `columns` row. A vertical lane on the board with a name and color. |
| **Task / Card** | A `tasks` row. A unit of work that moves through columns. |
| **Lifecycle milestone** | A timestamp on `jobs` recording the first time a card reached a stage (proposal_sent_at, proposal_viewed_at, in_chat_at, meeting_booked_at, meeting_done_at). Preserved via COALESCE on every move. |
| **Funnel** | The cumulative view of lifecycle milestones, computed via the `activity_history` CTE on `activity_log`. |
| **Profile** | A `profiles` row representing one Upwork (or Freelancer/Fiverr/LinkedIn) workstream owned by exactly one agent. Drives n8n routing. |
| **Vollna** | The third-party Upwork scraper that feeds n8n. |
| **n8n** | The automation platform (`ikonicdev.app.n8n.cloud`) that processes Vollna events and POSTs into `/api/v1/webhooks/tasks`. |
| **vollna-auto** | The default tag applied to all n8n-created tasks. |
| **Orphan task** | A task with no linked job (manually created, no `_job_id`). Counted in the funnel by current state but has no `won_value` for revenue. |
| **Reversal** | Moving a card out of a terminal column (Won/Lost) back to an active column. Clears outcome but preserves milestones. |
| **Member / Agent** | An entry in `agents` plus a row in `project_members`. The terms are used interchangeably in the UI. |
| **System admin** | A login via `ADMIN_CREDENTIALS` env var. Has no `agents` row but bypasses all `project_members` checks. |

---

## Appendix A — Default columns at a glance

```
1.  Todo                      gray    #6b7280
2.  Proposal Submitted        blue    #3b82f6   ← proposal_sent_at
3.  Prototype Required        amber   #eab308
4.  Prototype Done            green   #22c55e
5.  Prototype Submitted       teal    #14b8a6
6.  In Chat                   violet  #8b5cf6   ← in_chat_at
7.  Meeting Scheduled         indigo  #6366f1   ← meeting_booked_at
8.  Meeting Done              cyan    #06b6d4   ← meeting_done_at
9.  Negotiation               orange  #f97316
10. Lost                      red     #ef4444   ← outcome='lost' (terminal)
11. On Hold                   amber+  #f59e0b
12. N/A                       slate   #9ca3af   ← shows Reason field
13. Won                       emerald #10b981   ← outcome='won', is_done=true (terminal)

(optional, not seeded)
2.5 Proposal Views                              ← proposal_viewed_at
```

## Appendix B — Filter operator cheat sheet

```
text          equals · contains · is_empty · is_not_empty
number        equals · gt · lt
dropdown      equals
multi_select  contains_any · contains_all
date          before · after · in_range
boolean       is_true · is_false

reason (virtual multi_select)  contains_any · contains_all
```

## Appendix C — Webhook minimum viable payload

```json
{
  "title": "[Sana] Need a Next.js dashboard developer",
  "custom_fields": {
    "_source": "n8n",
    "_job_id": "1234567890",
    "_profile_name": "Sana",
    "_assigned_agent": "Sana"
  }
}
```

This minimal call will: create a task in the first column, auto-assign Sana, set due date NOW+24h, auto-create the `Sana` and `vollna-auto` tags, and dedupe against any existing task with the same `_job_id` + `_profile_name`.

---

*End of document.*
