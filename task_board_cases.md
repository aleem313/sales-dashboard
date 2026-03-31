# Task Board — Cases, Subcases & Edge Cases (v2.0)

> **Purpose:** Comprehensive requirement/test matrix for ClickUp-parity Task Board.
> **Depth:** 4 levels (Case → Subcase → Sub-subcase → Sub-sub-subcase).
> **Last Updated:** 2026-03-31

---

## 1. Board (Project) Management

### 1.1 Create Board

- **1.1.1 Admin creates board with valid data**
  - Admin provides name + optional description
  - Board created under default workspace ("Rising Lion")
  - Default 13 statuses (columns) auto-created (see §2 — Statuses)
  - Creator auto-added as project admin member
  - Board appears in sidebar board list immediately
  - **1.1.1.1** If no agents exist in DB, block creation with clear error
  - **1.1.1.2** Activity log: "Board created by [Admin]"
  - **1.1.1.3** Board selector dropdown updates without full page reload

- **1.1.2 Create with duplicate name**
  - Should succeed — names are NOT unique (slugs may be)
  - UI shows both boards, distinguishable by description or date

- **1.1.3 Create with empty/whitespace-only name**
  - API returns 422
  - UI shows inline validation error on name field
  - **1.1.3.1** Whitespace-only string trimmed → treated as empty

- **1.1.4 Create with very long name (>100 chars)**
  - API enforces max 100 chars; returns 422 if exceeded
  - Sidebar truncates with ellipsis
  - **1.1.4.1** Board header wraps or truncates with tooltip on hover

- **1.1.5 Board limit per workspace**
  - Soft warning at 50 boards; hard block at 100
  - **1.1.5.1** Clear error message: "Maximum 100 boards per workspace"

- **1.1.6 Agent (non-admin) tries to create board**
  - API returns 403; UI hides "New Board" button for agents

### 1.2 Edit Board

- **1.2.1 Rename board**
  - Update name reflected in sidebar, header, breadcrumbs, board selector
  - Activity log: "Board renamed from X to Y"
  - **1.2.1.1** Inline rename via double-click on board header name
  - **1.2.1.2** Rename via board settings menu → "Rename"
  - **1.2.1.3** Empty name on rename → revert to previous name, show toast error

- **1.2.2 Update description**
  - Optional; shown in board settings, not on board header
  - **1.2.2.1** Supports plain text only (no HTML/Markdown)

- **1.2.3 Agent tries to edit board**
  - API returns 403; UI hides edit option

### 1.3 Delete Board

- **1.3.1 Delete board with no tasks**
  - Confirmation modal: "Delete board X? This cannot be undone."
  - Cascade: columns, tags, webhook configs, members all deleted
  - Board disappears from sidebar
  - **1.3.1.1** If currently viewing this board → redirect to first remaining board or empty state

- **1.3.2 Delete board with active tasks**
  - Modal shows task count: "This board has N active tasks. All will be permanently deleted."
  - Require typing board name to confirm (destructive action guard)
  - Cascade: tasks → assignees, tags, comments, checklist, attachments, activity_log
  - **1.3.2.1** Activity log entries must be manually deleted BEFORE task cascade (trigger bypass required)
  - **1.3.2.2** File attachments: also removed from Vercel Blob storage
  - **1.3.2.3** Notifications referencing deleted tasks: preserved but link becomes dead

- **1.3.3 Delete the last remaining board**
  - Allowed — user sees empty state: "No boards. Create your first board."
  - Auto-seed does NOT re-trigger if boards table has rows (even if 0 for this workspace)
  - **1.3.3.1** `/tasks` route shows empty state with CTA button (admin only)

- **1.3.4 Agent tries to delete board**
  - API returns 403; UI hides delete option

- **1.3.5 Admin deletes board while another user is viewing it**
  - Next API call from other user returns 404
  - UI: show "Board not found" + redirect to default board

### 1.4 Board Listing & Switching

- **1.4.1 Admin sees all boards in workspace**
  - Sidebar lists boards ordered by creation date
  - Active board highlighted
  - Click to switch → board content reloads via URL param `?board=<id>`
  - **1.4.1.1** Board count badge next to "Task Board" nav item

- **1.4.2 Agent sees only assigned boards**
  - Filtered by `project_members` table
  - 0 boards: show "No boards assigned. Contact your admin."
  - **1.4.2.1** If agent removed from all boards mid-session → show access denied message

- **1.4.3 Board selector dropdown**
  - Board name + task count per board
  - "Create New Board" at bottom (admin only)
  - **1.4.3.1** Search/filter boards if >10 boards
  - **1.4.3.2** Active board has checkmark/highlight in dropdown

- **1.4.4 URL-based board selection**
  - Route: `/tasks?board=<project_id>`
  - Direct URL shareable
  - Invalid/unauthorized board ID → redirect to default board or 404
  - **1.4.4.1** Agent accessing board they're not a member of → 403

- **1.4.5 Remember last active board**
  - Store in localStorage
  - On next visit to `/tasks` → load last active board (if still exists)
  - **1.4.5.1** If last board was deleted → fall through to first available board

---

## 2. Status/Column (List/Group) Management

### 2.1 Default Statuses

- **2.1.1 New board gets 13 default columns**
  - Todo (gray), Proposal Submitted (blue), Prototype Required (yellow), Prototype Done (green), Prototype Submitted (teal), In Chat (purple), Meeting Scheduled (indigo), Meeting Done (cyan), Negotiation (orange), Lost (red), On Hold (amber), N/A (gray), Won (emerald)
  - Position-ordered by the sequence above
  - "Won" marked as `is_done = true`
  - **2.1.1.1** Each status has an assigned color and position
  - **2.1.1.2** Colors are customizable by admin after creation

### 2.2 Admin Creates Status/Column

- **2.2.1 Create with valid data**
  - Name + color picker
  - Position = end of board
  - Max 20 columns enforced (raised from 15 for Upwork workflow)
  - **2.2.1.1** New column appears at rightmost position on board
  - **2.2.1.2** "Add Status" button visible at end of column row on board
  - **2.2.1.3** Activity log: "Status [name] added"

- **2.2.2 Duplicate column name**
  - Blocked by UNIQUE(project_id, name) constraint
  - API returns 409; UI shows "Status name already exists"
  - **2.2.2.1** Case-insensitive check: "TODO" == "todo" == "Todo"

- **2.2.3 At column limit (20th)**
  - Show warning on 20th; block 21st
  - **2.2.3.1** "Add Status" button hidden or disabled with tooltip at limit

- **2.2.4 Agent tries to create column**
  - API returns 403; UI hides "Add Status" for agents

### 2.3 Admin Edits Status/Column

- **2.3.1 Rename status**
  - Inline edit (double-click column header)
  - All tasks in this column still show correctly
  - Activity log on each task in column: "Status renamed from X to Y" (debatable — may be noisy)
  - **2.3.1.1** Empty name → revert, show error toast
  - **2.3.1.2** Duplicate name check on rename

- **2.3.2 Change color**
  - Color picker in column settings menu
  - Updated immediately on all cards and board
  - **2.3.2.1** Predefined palette + custom hex input

- **2.3.3 Set WIP limit**
  - Advisory limit; shown as count badge on column header
  - Over-limit: column header turns orange/red
  - Does NOT block task creation/move — only visual warning
  - **2.3.3.1** WIP limit = null means no limit

- **2.3.4 Toggle is_done flag**
  - Only one column per project can be `is_done = true` (trigger enforced)
  - Moving a task to is_done column = task "completed"
  - **2.3.4.1** Changing is_done flag prompts: "Mark tasks in this column as completed?"

### 2.4 Admin Reorders Statuses/Columns

- **2.4.1 Drag column to new position**
  - Columns draggable via header handle
  - Position values recalculated (gap-based step 1000)
  - Persisted via `PATCH /api/projects/[id]/columns/reorder`
  - **2.4.1.1** Optimistic UI — column moves instantly, reverts on server error
  - **2.4.1.2** Mobile: long-press to initiate column drag

- **2.4.2 Reorder conflicts with concurrent edits**
  - Last write wins; no locking
  - **2.4.2.1** Page refresh shows server truth

### 2.5 Admin Deletes Status/Column

- **2.5.1 Delete empty column**
  - Direct delete; brief confirmation
  - **2.5.1.1** Undo via 5s toast (re-create with same name/position)

- **2.5.2 Delete column with tasks**
  - API returns 409 with task count
  - UI modal: "Move N tasks to:" dropdown (select target column) + "Delete" button
  - Bulk move then delete
  - **2.5.2.1** Cannot select same column as target
  - **2.5.2.2** If target column hits WIP limit → show warning but proceed

- **2.5.3 Delete the is_done column**
  - Allowed; prompt: "The 'completed' column will be removed. No column will mark tasks as done until you set another."
  - **2.5.3.1** After deletion, admin should be prompted to designate a new is_done column

- **2.5.4 Delete the last column**
  - Blocked — board must have ≥1 column
  - API returns 422: "Cannot delete the last column"
  - **2.5.4.1** UI hides delete option when only 1 column remains

- **2.5.5 Agent tries to delete column**
  - API returns 403; UI hides delete option

---

## 3. Board Member Management

### 3.1 Admin Adds Agent to Board

- **3.1.1 Add single agent**
  - Search/select agents by name or email
  - Select role: member (default) or admin
  - Agent added to `project_members`
  - Agent can now see board in sidebar
  - **3.1.1.1** Notification: "You were added to board X by Admin"
  - **3.1.1.2** Agent's board selector updates on next page load

- **3.1.2 Add agent already on board (duplicate)**
  - `ON CONFLICT DO NOTHING` — no error
  - UI: show "Already a member" tooltip

- **3.1.3 Add multiple agents at once**
  - Multi-select picker
  - Batch insert; toast: "3 agents added to Board X"
  - **3.1.3.1** All agents get role specified in picker (default: member)

- **3.1.4 Add inactive agent**
  - Blocked — only `agents.active = true` allowed
  - Inactive agents greyed out or hidden in picker

### 3.2 Admin Changes Agent Role

- **3.2.1 Promote member to admin**
  - Update `project_members.role` to 'admin'
  - Agent gains: column management, field management, board settings, task deletion
  - **3.2.1.1** Immediate effect; no page reload needed

- **3.2.2 Demote admin to member**
  - Update role to 'member'
  - Agent loses admin capabilities
  - **3.2.2.1** Cannot demote workspace owner

- **3.2.3 Demote last admin**
  - **BLOCKED** — board must have ≥1 admin in project_members
  - API returns 400: "Cannot demote the last admin"
  - **3.2.3.1** System admin (env-var login) does NOT count as project admin — they have no agent row
  - **3.2.3.2** UI shows warning icon next to last admin's role dropdown
  - **3.2.3.3** If all project members are "member" role and system admin tries to operate → must have fallback logic (see Edge Cases §10.3)

### 3.3 Admin Removes Agent from Board

- **3.3.1 Remove agent with no task assignments**
  - Delete from `project_members`
  - Board disappears from agent's sidebar
  - **3.3.1.1** Agent's open board tab → next API call returns 403

- **3.3.2 Remove agent assigned to tasks**
  - Confirmation: "Agent X is assigned to N tasks. Remove and unassign from all tasks?"
  - Option A: Remove + unassign (default)
  - Option B: Cancel
  - Activity log on each task: "Agent unassigned (removed from board)"
  - **3.3.2.1** Tasks with no remaining assignees show "Unassigned" state

- **3.3.3 Remove workspace owner**
  - Blocked — workspace owner always has implicit access
  - API returns 400: "Cannot remove workspace owner"

- **3.3.4 Admin removes themselves**
  - Allowed if other admins exist on this board
  - Blocked if last admin (same as §3.2.3)
  - **3.3.4.1** After self-removal → redirect to `/tasks` default board

- **3.3.5 Agent tries to remove another agent**
  - API returns 403; UI hides remove button

### 3.4 Member List UI

- **3.4.1 View members**
  - Members panel (slide-out sheet)
  - List: avatar, name, email, role badge (Admin/Member), joined date
  - Sorted: admins first, then alphabetical
  - **3.4.1.1** Member count on board header (avatar cluster max 5 + overflow count)

- **3.4.2 Search members**
  - Filter by name/email in members panel
  - **3.4.2.1** Useful when board has >10 members

---

## 4. Task (Card) Management — Full Lifecycle

### 4.1 Create Task

- **4.1.1 Create with minimum fields (title only)**
  - Title required; column defaults to first column ("Todo")
  - Creator auto-set from session (system admin → uses fallback agent)
  - Position = max_position + 1000 in target column
  - **4.1.1.1** Card appears at bottom of target column with animation
  - **4.1.1.2** Zustand store updated optimistically

- **4.1.2 Create with all fields**
  - Title, description, priority, due date, start date, assignees, labels/tags, custom fields, time estimate
  - All validated; 422 on invalid data
  - **4.1.2.1** Assignees must be current board members
  - **4.1.2.2** Labels/tags must belong to same project
  - **4.1.2.3** Custom field values validated against field definitions

- **4.1.3 Create from column "+" button**
  - Modal opens with column pre-selected
  - **4.1.3.1** Modal rendered outside scroll container to avoid z-index issues

- **4.1.4 Create from board header "+ New Task" button**
  - Modal opens with first column selected by default
  - **4.1.4.1** User can change column in modal dropdown

- **4.1.5 Create task on board user is not a member of**
  - API returns 403; impossible via UI

- **4.1.6 Create task with assignees not on this board**
  - API returns 422: "Agent X is not a member of this board"
  - UI: assignee picker only shows board members

- **4.1.7 Quick-add mode**
  - Press Enter in column header area to quick-add task (title only)
  - **4.1.7.1** Tab into description field for multi-field quick entry

### 4.2 View Task (Detail Drawer)

- **4.2.1 Open task drawer**
  - Click task card → `?task=:id` URL param → drawer opens from right
  - Full-width on mobile; 480px on desktop
  - **4.2.1.1** URL is shareable — direct link to task
  - **4.2.1.2** Multiple drawers NOT stacked — only one at a time

- **4.2.2 Drawer sections**
  - Header: title (click-to-edit), status dropdown, priority dropdown
  - Fields: assignees (toggle chips), due date, start date, time estimate, time tracked
  - Description: rich text area (TipTap in M3, textarea for now)
  - Subtasks/Checklist: add items, progress bar, toggle complete
  - Labels/Tags: colored chips, add/remove
  - Custom Fields: type-specific renderers
  - Comments: threaded, add/edit/delete
  - Activity Log: chronological, filterable (All / Comments)
  - **4.2.2.1** Sections are collapsible
  - **4.2.2.2** Share button in drawer header

- **4.2.3 Close drawer**
  - Click X, press Escape, or click outside
  - Remove `?task` param from URL

### 4.3 Edit Task (Inline in Drawer)

- **4.3.1 Edit title**
  - Click to activate edit mode
  - Enter to save, Escape to cancel
  - Empty title → revert, show error
  - **4.3.1.1** Title also editable inline on the card (double-click)

- **4.3.2 Change status (column)**
  - Dropdown showing all columns with color dots
  - Immediate move — task moves to new column on board
  - Zustand store + server action updated
  - **4.3.2.1** Activity log: "Moved from [old] to [new]"

- **4.3.3 Change priority**
  - Dropdown: Urgent, High, Medium, Low, None
  - Color-coded badges
  - Immediate update
  - **4.3.3.1** Priority also settable from card context menu

- **4.3.4 Change due date**
  - Date picker (calendar popup, not datetime-local input)
  - Clear button to remove due date
  - **4.3.4.1** Overdue: red highlight on card and in drawer
  - **4.3.4.2** Due within 48h: orange highlight
  - **4.3.4.3** Date format: user-friendly ("Mar 31, 2026")

- **4.3.5 Change start date**
  - Same as due date picker
  - **4.3.5.1** Start date must be before or equal to due date; warn if after

- **4.3.6 Edit description**
  - Textarea with save-on-blur
  - **4.3.6.1** Rich text in M3 (TipTap: bold, italic, links, mentions, lists)
  - **4.3.6.2** Auto-save after 2s of inactivity

- **4.3.7 Toggle assignees**
  - Chip-toggle from board members list
  - **4.3.7.1** Search/filter members in assignee picker
  - **4.3.7.2** Assignee dropdown: avatar + name + email
  - **4.3.7.3** ClickUp-style: click "+" to open member dropdown, click avatar to remove

- **4.3.8 Manage labels/tags**
  - Add existing labels (multi-select)
  - Create new label inline (name + color)
  - Remove label from task
  - **4.3.8.1** Labels are project-scoped
  - **4.3.8.2** Admin can manage label definitions (name, color) in project settings
  - **4.3.8.3** Deleting a label definition removes it from all tasks

### 4.4 Task Time Tracking

- **4.4.1 Set time estimate**
  - Input: hours/minutes
  - Shown on card (if >0) as "Est: 2h 30m"
  - Stored in `tasks.custom_fields` as `{ time_estimate_minutes: number }`
  - **4.4.1.1** Time estimate editable in drawer and via card context menu

- **4.4.2 Track time**
  - Manual entry: hours/minutes per session
  - Total tracked time shown alongside estimate
  - Stored in `tasks.custom_fields` as `{ time_tracked_minutes: number }`
  - **4.4.2.1** Simple manual tracking (no live timer in v1)
  - **4.4.2.2** Display: "Tracked: 1h 30m / Est: 2h 30m"

### 4.5 Subtasks (Checklist)

- **4.5.1 Add checklist item**
  - Text input in drawer → adds to bottom
  - **4.5.1.1** Press Enter to add + clear input for next item
  - **4.5.1.2** Paste multi-line text → creates multiple items

- **4.5.2 Toggle complete**
  - Checkbox toggle per item
  - Progress bar updates in drawer and on card
  - **4.5.2.1** Animation on toggle

- **4.5.3 Delete checklist item**
  - X button per item; no confirmation needed
  - **4.5.3.1** Undo via toast (5s window)

- **4.5.4 Reorder checklist items**
  - Drag-to-reorder (dnd-kit nested context)
  - Position recalculated
  - **4.5.4.1** Persisted to server on drop

- **4.5.5 Checklist progress on card**
  - Show "3/5" or "60%" on task card
  - Green progress bar in card
  - **4.5.5.1** If all items checked → card gets subtle "completed" style

### 4.6 Share Task

- **4.6.1 Share dialog (ClickUp-inspired)**
  - "Share this task" modal with:
    - Task title with status color dot
    - "Invite by name or email" input + "Invite" button
    - "Share link with anyone" toggle (public link)
    - "Private link" with "Copy link" button
    - "Default permission" dropdown: Full edit, Can comment, View only
    - "Share with" section: shows board members with toggles
  - **4.6.1.1** Private link = URL with `?task=:id` on the board page
  - **4.6.1.2** Public link generates a UUID token stored in DB (future scope)

- **4.6.2 Copy task link**
  - Button in drawer header → copies `domain/tasks?board=X&task=Y`
  - Toast: "Link copied"
  - **4.6.2.1** Works without share dialog

### 4.7 Delete Task

- **4.7.1 Admin deletes task**
  - Confirmation dialog: "Delete task '[title]'? This cannot be undone."
  - Cascade: assignees, tags, comments, checklist, attachments, activity_log
  - **4.7.1.1** Must delete activity_log entries explicitly BEFORE task delete (append-only trigger)
  - **4.7.1.2** File attachments removed from Vercel Blob
  - **4.7.1.3** Task removed from Zustand store optimistically

- **4.7.2 Agent tries to delete**
  - API returns 403; UI hides delete button for agents

- **4.7.3 Delete from drawer**
  - Trash icon in drawer header → confirmation → close drawer after delete
  - **4.7.3.1** Redirect to board view after deletion

- **4.7.4 Delete from card context menu**
  - Right-click or "..." menu on card → "Delete" option (admin only)

### 4.8 Bulk Operations

- **4.8.1 Bulk select tasks**
  - Checkbox on each card (hover to reveal)
  - Select all in column
  - Bulk action bar appears at bottom of screen
  - **4.8.1.1** Actions: Move to column, Assign, Change priority, Delete (admin)

- **4.8.2 Bulk move**
  - Select tasks → "Move to" dropdown → select column
  - One activity log entry per task

- **4.8.3 Bulk delete (admin only)**
  - Confirmation with count: "Delete N tasks?"

---

## 5. Drag & Drop

### 5.1 Card Drag Within Column (Reorder)

- **5.1.1 Drag card to new position in same column**
  - Entire card is draggable (not just grip handle)
  - 8px activation distance to distinguish from click
  - Optimistic reorder in Zustand
  - Position recalculated (gap-based)
  - **5.1.1.1** Visual feedback: drag ghost (semi-transparent, rotated 2°)
  - **5.1.1.2** Drop placeholder shows target position
  - **5.1.1.3** Undo via 5s toast

- **5.1.2 Drag card with touch (mobile)**
  - 200ms delay + 5px tolerance
  - **5.1.2.1** Haptic feedback on start (where supported)

### 5.2 Card Drag Between Columns (Status Change)

- **5.2.1 Move card to different column**
  - Card appears in new column at drop position
  - Old column count decrements; new column count increments
  - Activity log: "Moved from [old] to [new]"
  - **5.2.1.1** Drop target column: accent border highlight
  - **5.2.1.2** Empty column: full-height drop zone

- **5.2.2 Drop on column header**
  - Task appended to end of that column

- **5.2.3 Cancel drag (Escape or drop outside)**
  - Task reverts to original position
  - Zustand state reverted

### 5.3 Column Drag (Reorder Columns)

- **5.3.1 Admin drags column header**
  - Column-level DnD context (separate from card DnD)
  - Optimistic reorder + server persist
  - **5.3.1.1** Column handle in header (admin only)

- **5.3.2 Agent tries to drag column**
  - Drag disabled — no handle shown

### 5.4 Drag Failure Handling

- **5.4.1 Server action fails**
  - Revert Zustand state to pre-drag snapshot
  - Toast error: "Failed to move task"
  - **5.4.1.1** Retry not automatic — user must drag again

- **5.4.2 Network timeout during drag**
  - Same as 5.4.1 — revert + error toast

- **5.4.3 Concurrent move conflict**
  - Last write wins; no conflict resolution
  - **5.4.3.1** Board refresh on next server-side data fetch shows truth

---

## 6. Labels (Tags) System

### 6.1 Label Management (Admin)

- **6.1.1 Create label**
  - Name + color (predefined palette or custom hex)
  - Labels are project-scoped (per board)
  - **6.1.1.1** Quick-create from task drawer "Add Label" → type new name → create
  - **6.1.1.2** Max 50 labels per project

- **6.1.2 Edit label**
  - Change name and/or color
  - Updated across all tasks that have this label
  - **6.1.2.1** Rename reflected on all cards in real-time (after page refresh)

- **6.1.3 Delete label**
  - Removes from all tasks that have it
  - Confirmation: "This label is used on N tasks. Delete anyway?"
  - **6.1.3.1** Cascade delete from `task_tag_map`

### 6.2 Assign Labels to Tasks

- **6.2.1 Add label(s) to task**
  - Multi-select dropdown in task drawer
  - Labels shown as colored chips on card (first 3 + overflow count)
  - **6.2.1.1** Search/filter labels in dropdown
  - **6.2.1.2** Labels ordered by usage frequency (most used first)

- **6.2.2 Remove label from task**
  - Click X on label chip in drawer
  - **6.2.2.1** Does not delete the label definition — only the mapping

- **6.2.3 Filter by label**
  - Filter bar: select label → show only tasks with that label
  - **6.2.3.1** Multiple labels: AND logic (task must have all selected)

---

## 7. Custom Fields

### 7.1 Built-in Task Fields

- **7.1.1 Standard fields (always present)**
  - Title, Description, Status (column), Priority, Due Date, Start Date, Assignees, Labels
  - Time Estimate, Time Tracked (stored in custom_fields JSONB but treated as first-class)

### 7.2 User-Defined Custom Fields (Admin)

- **7.2.1 Create custom field definition**
  - Types: Text, Number, Dropdown, Multi-select, Date, Boolean
  - Name + type (locked after creation) + options (for dropdown/multi-select)
  - `show_on_card` toggle: whether field value shown on task cards
  - `required` flag: validation on task create/edit
  - **7.2.1.1** E.g., "Connects Used" as Number field, "Niche" as Dropdown

- **7.2.2 Edit custom field**
  - Change name, options, required flag, show_on_card
  - Type CANNOT change after creation
  - **7.2.2.1** Adding dropdown option: available immediately
  - **7.2.2.2** Removing dropdown option: prompt to handle tasks with that value

- **7.2.3 Archive custom field**
  - Hidden from UI but data preserved in JSONB
  - Restorable

### 7.3 Custom Field Values on Tasks

- **7.3.1 Set field value on task**
  - Type-specific input in task drawer (text input, number input, dropdown, etc.)
  - Stored in `tasks.custom_fields` JSONB: `{ "field_id": value }`
  - **7.3.1.1** Validation per type (number rejects NaN, required fields enforced)

- **7.3.2 Show on card**
  - Max 3 custom fields shown on card (controlled by `show_on_card` + position)
  - Compact rendering: label: value

- **7.3.3 Filter by custom field**
  - Type-specific operators (equals, contains, greater than, etc.)

---

## 8. Comments & Activity

### 8.1 Comments

- **8.1.1 Add comment**
  - Text input at bottom of activity section in drawer
  - Author avatar + name + timestamp
  - Activity log entry: "commented"
  - **8.1.1.1** Rich text comments (future: TipTap)
  - **8.1.1.2** @mentions with autocomplete (future)

- **8.1.2 Edit comment**
  - Author only, within 60-minute window
  - Shows "(edited)" badge
  - **8.1.2.1** After 60 min → edit disabled, tooltip: "Edit window expired"

- **8.1.3 Delete comment**
  - Author within 60 min OR admin
  - Soft delete: body replaced with "[deleted]"
  - **8.1.3.1** Replies preserved even if parent deleted

- **8.1.4 Reply to comment**
  - Max 1 level deep (no nested threads beyond parent→reply)
  - Reply shows indented under parent

### 8.2 Activity Log

- **8.2.1 Tracked events**
  - Task created, moved, deleted, field changes (title, priority, due date, description, assignees, labels)
  - Comment added/edited/deleted
  - Checklist item added/toggled/deleted
  - **8.2.1.1** Each entry: actor name, action, old→new values, timestamp

- **8.2.2 Activity display**
  - Chronological, newest first
  - "All" / "Comments" tabs
  - Relative timestamps + full timestamp on hover
  - **8.2.2.1** Pagination if >50 entries (or virtual scroll)

---

## 9. UI Interactions

### 9.1 Task Card UI (ClickUp-Parity — per card.png)

- **9.1.1 Card layout (top to bottom)**
  - Row 1: Labels/tags (colored chips, max 3 + overflow)
  - Row 2: Task title (2-line clamp, bold)
  - Row 3: Custom field values (if show_on_card enabled, max 2-3)
  - Row 4: Meta row — priority badge, due date chip
  - Row 5: Bottom row — assignee avatars (left), checklist/comment/attachment counts (right)
  - **9.1.1.1** Entire card is the drag target (no separate grip handle)
  - **9.1.1.2** Click opens task detail drawer
  - **9.1.1.3** Right-click or "..." reveals context menu: Edit, Move to, Assign, Copy link, Delete (admin)

- **9.1.2 Card hover state**
  - Subtle border highlight
  - Context menu "..." appears on hover (top-right)
  - **9.1.2.1** Checkbox appears on hover (for bulk select)

- **9.1.3 Card drag state**
  - Card becomes semi-transparent at original position
  - Ghost card follows cursor (rotated 2°, elevated shadow)
  - Drop target shows insertion line or placeholder

### 9.2 Board Layout (per board.png)

- **9.2.1 Column layout**
  - Fixed-width columns (280px) with horizontal scroll
  - Column header: color dot + name + task count + WIP indicator + admin menu (...)
  - "+" button at column bottom to add task to that column
  - **9.2.1.1** Column header "..." menu: Rename, Change color, Set WIP limit, Delete (admin only)

- **9.2.2 Board header**
  - Board selector dropdown (left)
  - Member avatars (cluster) + member count button
  - "+ New Task" button (right)
  - Filter bar below header
  - **9.2.2.1** Board name editable inline (double-click, admin)

- **9.2.3 Groups/Lists (ClickUp "Lists")**
  - Boards can have multiple "lists" (grouping views)
  - Default: group by status (current behavior)
  - Future: group by assignee, priority, label, custom field
  - **9.2.3.1** "Add Group" button in board header (admin)
  - **9.2.3.2** Each group is independently collapsible

### 9.3 Dropdowns & Modals

- **9.3.1 Assignee dropdown (ClickUp-style)**
  - Trigger: click "+" button or assignee area
  - Dropdown content: search input + member list with avatars
  - Click member to toggle assign/unassign
  - Checkmark next to assigned members
  - **9.3.1.1** Dropdown closes on click outside
  - **9.3.1.2** Keyboard navigation (arrow keys + Enter)

- **9.3.2 Priority dropdown**
  - Color-coded items with icons (flag icons)
  - Immediate update on select

- **9.3.3 Status/Column dropdown**
  - Color dots next to each status name
  - Current status highlighted

- **9.3.4 Task create/edit modals**
  - Form with all fields
  - Validation on submit
  - Close on Escape or outside click
  - **9.3.4.1** Preserve unsaved changes warning if dirty

- **9.3.5 Confirmation dialogs**
  - Styled dialog (not browser `confirm()`)
  - Cancel + destructive action button
  - Loading spinner on action

### 9.4 Empty States

- **9.4.1 No boards**
  - Admin: "Create your first board" CTA
  - Agent: "No boards assigned. Contact your admin."

- **9.4.2 No tasks on board**
  - Illustration + "Create your first task" CTA button
  - Per-column: "No tasks" with "+" button

- **9.4.3 No results (filtered)**
  - "No tasks match your filters" + "Clear filters" button

- **9.4.4 No members on board**
  - Should never happen (creator always added)
  - If corrupted: "No members. Add team members to get started."

---

## 10. Edge Cases (Critical)

### 10.1 Deletion Edge Cases

- **10.1.1 Delete board with tasks → activity_log trigger blocks cascade**
  - **ROOT CAUSE:** `activity_log` has `BEFORE DELETE` trigger that raises exception
  - **FIX:** Must explicitly delete activity_log rows before deleting tasks, or modify trigger to allow CASCADE deletes
  - **10.1.1.1** Same applies to task deletion — activity_log blocks cascade

- **10.1.2 Delete board while agent is creating task**
  - Task creation API returns 404 (project not found)
  - UI: show error toast, close modal

- **10.1.3 Delete task referenced in notifications**
  - Notification preserved; link becomes dead
  - Click notification → "Task not found" gracefully

- **10.1.4 Delete column that is the default (position=1)**
  - Remaining columns shift; new default = first by position
  - Task creation modal updates default column

### 10.2 Permission Edge Cases

- **10.2.1 System admin (env-var login) has no agent row**
  - `session.user.agentId` is null/undefined
  - Admin can manage boards but cannot be a project_member
  - Task `creator_id` → uses fallback agent or null
  - **10.2.1.1** Board operations that require membership check → skip for system admin role
  - **10.2.1.2** Comments require `agentId` → system admin cannot comment (known limitation)

- **10.2.2 All project_members demoted to "member" role**
  - System admin (env-var) can still perform admin actions (role check is on session, not project_members)
  - But: last-admin guard prevents this from happening via UI
  - **FIX:** If all members are "member", system admin can still add an admin member
  - **10.2.2.1** No project-level admin ≠ no system admin; system admin role comes from session

- **10.2.3 Agent removed from board during active session**
  - Next API call → 403
  - UI: "You no longer have access" toast + redirect

- **10.2.4 Agent's status set to inactive while assigned to tasks**
  - Keep assignments; show "(inactive)" badge
  - Block new assignments to inactive agents

### 10.3 Admin Role Confusion (System Admin vs Project Admin)

- **10.3.1 System admin operations**
  - Determined by `session.user.role === "admin"` (from ADMIN_CREDENTIALS env var)
  - Can: CRUD boards, CRUD columns, delete tasks, manage members
  - Cannot: be assigned to tasks, comment (no agentId), be a project_member

- **10.3.2 Project admin operations**
  - Determined by `project_members.role === "admin"` for that specific board
  - Can: manage columns, fields, webhooks for THEIR board
  - Cannot: create new boards, access boards they're not members of

- **10.3.3 No admins on board (edge case)**
  - System admin can still manage board via API (role check on session)
  - System admin can add a new admin member to fix the state
  - **10.3.3.1** UI should show warning banner: "This board has no admin members"

### 10.4 Drag & Drop Edge Cases

- **10.4.1 Drag while network is offline**
  - Optimistic move happens visually
  - Server call fails → revert + error toast
  - **10.4.1.1** No retry queue; user must drag again

- **10.4.2 Two users drag same task simultaneously**
  - Last write wins
  - Other user's view shows stale position until refresh
  - **10.4.2.1** No real-time sync yet (future: SSE)

- **10.4.3 Drag task to column at WIP limit**
  - Allowed — WIP is advisory
  - Column header shows red/orange warning
  - **10.4.3.1** Toast warning: "Column X is over WIP limit"

- **10.4.4 Position collision (two tasks get same position)**
  - Possible when gap-based positions converge (many inserts between adjacent items)
  - **FIX:** Rebalance positions for column when gap < 10
  - **10.4.4.1** Rebalance: set all positions to 1000, 2000, 3000, ...

- **10.4.5 Drag disabled during pending operation**
  - While a server action is in-flight, prevent new drags
  - **10.4.5.1** Or allow new drags but queue them (complex — defer)

### 10.5 Data Integrity Edge Cases

- **10.5.1 Orphaned tasks (column deleted without moving tasks)**
  - Should never happen (API blocks column deletion with tasks)
  - If DB corruption: board query filters out tasks with invalid column_id

- **10.5.2 Orphaned assignees (agent deleted from agents table)**
  - FK CASCADE deletes task_assignees
  - Comments and activity preserved (author_id set to null or FK allows null)
  - **10.5.2.1** Show "Deleted User" for null author references

- **10.5.3 Workspace owner deleted/deactivated**
  - Block at application level — workspace owner cannot be deactivated
  - **10.5.3.1** Must transfer ownership first

- **10.5.4 Board with 1000+ tasks**
  - Performance: virtualize card lists (Milestone 5 with @tanstack/react-virtual)
  - Server query: paginate beyond 500 tasks
  - **10.5.4.1** Client-side filtering acceptable up to ~500 tasks

### 10.6 Duplicate/Conflict Edge Cases

- **10.6.1 Duplicate label names on same board**
  - Allowed — labels identified by ID, not name
  - **10.6.1.1** UI should warn but not block

- **10.6.2 Duplicate column names**
  - Blocked by UNIQUE constraint (project_id, name)
  - **10.6.2.1** Case-insensitive uniqueness check

- **10.6.3 Duplicate board names**
  - Allowed (names not unique)

### 10.7 Empty/Null Edge Cases

- **10.7.1 Task with no assignees**
  - Valid state; card shows no avatars
  - Assignee filter "unassigned" should catch these

- **10.7.2 Task with no priority**
  - Valid; no priority badge shown on card

- **10.7.3 Task with no due date**
  - Valid; no date chip shown

- **10.7.4 Board with no columns**
  - Can happen if all columns manually deleted from DB
  - Board shows "No columns" state
  - **10.7.4.1** Task creation blocked until columns exist

- **10.7.5 Task with empty description**
  - Valid; drawer shows placeholder "Add a description..."

---

*Reference for: plan.md milestones, QA test plans, API route design, UI component development*
