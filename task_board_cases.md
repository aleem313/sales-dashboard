# Task Board — Cases, Subcases & Edge Cases

> **Purpose:** Comprehensive test/requirement matrix for the Task Board module.
> **Audience:** Development (feature scoping) + QA (test coverage).
> **Depth:** 3 levels (Case → Subcase → Sub-subcase).
> **Last Updated:** 2026-03-31

---

## 1. Board (Project) Management

### 1.1 Admin Creates a Board

- **1.1.1 Create with valid data**
  - Admin provides name + optional description
  - Board is created under the default workspace
  - Default 4 columns created automatically (To Do, In Progress, In Review, Done)
  - Creator automatically added as project admin member
  - Board appears in sidebar board list immediately
  - Activity log: "Board created"

- **1.1.2 Create with duplicate name**
  - Admin creates board with same name as existing board
  - Should succeed — names are NOT unique (only slugs are unique at workspace level)
  - UI shows both boards in list, distinguishable by description or creation date

- **1.1.3 Create with empty/whitespace name**
  - Return 422 validation error
  - UI shows inline error on name field

- **1.1.4 Create with very long name**
  - Enforce max 100 characters at API + UI
  - Truncate display in sidebar with ellipsis

- **1.1.5 Board limit per workspace**
  - No hard limit initially, but consider soft limit of 50 boards per workspace
  - Show warning at 50; block at 100

### 1.2 Admin Edits a Board

- **1.2.1 Rename board**
  - Update name; reflected in sidebar, board header, and breadcrumbs
  - Activity log: "Board renamed from X to Y"

- **1.2.2 Update description**
  - Optional field; shown in board settings, not on board header

- **1.2.3 No permission (agent tries to edit)**
  - API returns 403
  - UI hides edit option for agents

### 1.3 Admin Deletes a Board

- **1.3.1 Delete board with no tasks**
  - Confirmation modal: "Delete board X? This cannot be undone."
  - Board removed; all columns, tags, webhook configs cascade-deleted
  - Members removed (cascade from project_members)
  - Board disappears from sidebar

- **1.3.2 Delete board with active tasks**
  - Confirmation modal shows task count: "This board has N active tasks. All tasks, comments, and attachments will be permanently deleted."
  - Require typing board name to confirm (destructive action guard)
  - Cascade delete: tasks → assignees, tags, comments, activity_log, checklist_items, file_attachments
  - Log: "Board X deleted with N tasks by Admin"

- **1.3.3 Delete board with only archived/done tasks**
  - Same flow as 1.3.2 — no special treatment for done tasks

- **1.3.4 Delete the last remaining board**
  - Allowed — user sees empty state: "No boards. Create your first board."
  - Default board auto-creation (from getDefaultProject) does NOT re-trigger if boards table is non-empty but has 0 rows for this workspace

- **1.3.5 Agent tries to delete board**
  - API returns 403
  - UI hides delete option

### 1.4 Board Listing & Switching

- **1.4.1 Admin sees all boards**
  - Sidebar lists all boards in workspace, ordered by creation date
  - Active board highlighted
  - Click to switch; board content reloads

- **1.4.2 Agent sees only assigned boards**
  - Sidebar lists only boards where agent is a member (project_members)
  - If agent is member of 0 boards: show "No boards assigned. Contact your admin."

- **1.4.3 Board selector dropdown**
  - Show on board page header (next to board name)
  - Lists all accessible boards
  - "Create New Board" option at bottom (admin only)

- **1.4.4 URL-based board selection**
  - Route: `/tasks?board=<project_id>` or `/tasks/[project_id]`
  - Direct URL to board is shareable
  - Invalid/unauthorized board ID: show 404 or redirect to default board

- **1.4.5 Remember last active board**
  - Store last visited board ID in localStorage or URL
  - On next visit to `/tasks`, load last active board (or default if deleted)

---

## 2. Board Member Management

### 2.1 Admin Adds Agent to Board

- **2.1.1 Add single agent**
  - Search agents by name/email
  - Select role: member (default) or admin
  - Agent added to project_members; appears in board member list
  - Agent can now see this board in their sidebar

- **2.1.2 Add agent already on board (duplicate)**
  - API: `ON CONFLICT DO NOTHING` — no error, no duplicate
  - UI: agent already shown as member; show tooltip "Already a member"

- **2.1.3 Add multiple agents at once**
  - Multi-select agent picker
  - Batch insert into project_members
  - Toast: "3 agents added to Board X"

- **2.1.4 Add inactive agent**
  - Should be blocked — only active agents can be added
  - API: validate `agents.active = true` before insert
  - UI: inactive agents hidden or greyed out in picker

- **2.1.5 Agent notification on add**
  - Create notification: "You were added to board X by Admin"
  - Board immediately appears in agent's sidebar on next page load

### 2.2 Admin Changes Agent Role on Board

- **2.2.1 Promote member to admin**
  - Update project_members.role to 'admin'
  - Agent gains column management, field management, etc.

- **2.2.2 Demote admin to member**
  - Update project_members.role to 'member'
  - Agent loses admin-only capabilities
  - Cannot demote the workspace owner

- **2.2.3 Last admin demotion**
  - Block if this would leave the board with 0 admins
  - API: check count of admins before allowing role change
  - UI: show warning "Cannot demote — board must have at least one admin"

### 2.3 Admin Removes Agent from Board

- **2.3.1 Remove agent with no task assignments**
  - Delete from project_members
  - Agent loses access immediately
  - Board disappears from agent's sidebar

- **2.3.2 Remove agent who is assigned to tasks**
  - Confirmation modal: "Agent X is assigned to N tasks on this board. Choose:"
    - Option A: "Remove from board AND unassign from all tasks" (recommended)
    - Option B: "Remove from board but keep task assignments" (orphaned — tasks show "[Removed member]")
  - Activity log on each affected task: "Agent unassigned (removed from board)"

- **2.3.3 Remove agent who is the only assignee on tasks**
  - Same as 2.3.2 — tasks become unassigned
  - Warning: "N tasks will have no assignee after removal"

- **2.3.4 Remove agent who has comments/activity**
  - Comments and activity log preserved — show agent name (not "[Deleted]" since agent still exists, just not a member)
  - No data deletion

- **2.3.5 Agent tries to remove another agent**
  - API returns 403
  - UI hides remove button for non-admins

- **2.3.6 Admin removes themselves**
  - Allowed if other admins exist
  - Blocked if they're the last admin (same as 2.2.3)

- **2.3.7 Remove workspace owner from board**
  - Blocked — workspace owner always has implicit access
  - API: check if agent_id == workspace.owner_id; if so, return 400

### 2.4 Member List UI

- **2.4.1 View members**
  - Board Settings > Members tab
  - List: avatar, name, email, role badge (Admin/Member), joined date
  - Sort by role (admins first), then name

- **2.4.2 Invite link / bulk invite**
  - Future enhancement — not in current scope
  - Placeholder: "Invite by link (coming soon)"

- **2.4.3 Member count on board header**
  - Avatar cluster (max 5) + overflow count
  - Click to open members panel

---

## 3. Task Management Within Boards

### 3.1 Create Task

- **3.1.1 Create with minimum fields (title only)**
  - Title required; column defaults to first column
  - Creator auto-set from session
  - Position = max_position + 1000 in target column

- **3.1.2 Create with all fields**
  - Title, description, priority, due date, start date, assignees, tags, custom fields
  - All validated; 422 on invalid data

- **3.1.3 Create task on a board the user is not a member of**
  - API returns 403
  - UI: board not visible, so impossible via UI

- **3.1.4 Create task with assignees not on this board**
  - API: validate each assignee_id is in project_members
  - Reject with 422: "Agent X is not a member of this board"

- **3.1.5 Create task when column is at WIP limit**
  - Allow creation but show warning badge on column (orange/red)
  - Do NOT block creation — WIP limits are advisory

### 3.2 Move Task Between Boards

- **3.2.1 Admin moves task to another board**
  - Select target board → select target column
  - Task re-parented: update project_id and column_id
  - Assignees NOT on target board: prompt to unassign or add them to target board
  - Tags: project-scoped, so tags don't transfer — stripped on move
  - Custom fields: project-scoped, so values preserved in JSONB but definitions may not match — show warning
  - Activity log on both source and target: "Task moved from Board A to Board B"

- **3.2.2 Agent tries to move task to another board**
  - API returns 403 — cross-board move is admin only
  - UI: option hidden for agents

- **3.2.3 Move task to board with no columns**
  - Block with 422: "Target board has no columns"

### 3.3 Task Assignment

- **3.3.1 Assign agent who is a board member**
  - Normal flow — add to task_assignees

- **3.3.2 Assign agent who is NOT a board member**
  - API rejects with 422
  - UI: agent picker only shows board members

- **3.3.3 Assign deactivated agent**
  - Block — only active agents can be assigned
  - If agent deactivated AFTER assignment: keep assignment, show visual indicator "(inactive)"

- **3.3.4 Self-assign (agent assigns themselves)**
  - Allowed for any board member

- **3.3.5 Unassign all agents from task**
  - Allowed — task becomes unassigned
  - Card shows no avatars

### 3.4 Task Deletion

- **3.4.1 Admin deletes task**
  - Cascade: assignees, tags, comments, activity_log, checklist, attachments
  - File attachments: remove from Vercel Blob as well

- **3.4.2 Agent tries to delete task**
  - API returns 403
  - UI hides delete option

- **3.4.3 Delete task that is referenced in notifications**
  - Notifications preserved but link becomes dead
  - Click on notification: show "Task not found" gracefully

### 3.5 Bulk Operations

- **3.5.1 Bulk move tasks to column**
  - Select multiple tasks → "Move to Column" action
  - All tasks moved; one activity log entry per task

- **3.5.2 Bulk assign/unassign**
  - Select multiple tasks → "Assign to Agent" / "Unassign Agent"
  - Apply to all selected

- **3.5.3 Bulk delete (admin only)**
  - Select multiple → "Delete Selected"
  - Confirmation with count

---

## 4. Column Management

### 4.1 Admin Creates Column

- **4.1.1 Normal creation**
  - Name + optional color
  - Position = end of board
  - Max 15 columns enforced

- **4.1.2 Duplicate column name**
  - Blocked by UNIQUE(project_id, name) constraint
  - API returns 409; UI shows "Column name already exists"

- **4.1.3 15th column (at limit)**
  - Show warning: "This is the maximum number of columns"
  - Block 16th creation

### 4.2 Admin Deletes Column

- **4.2.1 Delete empty column**
  - Direct delete; no confirmation needed

- **4.2.2 Delete column with tasks**
  - API returns 409 with task count
  - UI: modal with "Move N tasks to:" dropdown (select target column) + "Delete" button
  - Bulk move then delete

- **4.2.3 Delete the "Done" (is_done) column**
  - Same as 4.2.2 — allowed but warn about losing the is_done flag
  - After deletion, no column is marked is_done until admin sets another

- **4.2.4 Delete the only remaining column**
  - Block — board must have at least 1 column
  - API returns 422: "Cannot delete the last column"

---

## 5. Agent-Specific Scenarios

### 5.1 Agent Visibility

- **5.1.1 Agent sees only their boards**
  - Board list filtered by project_members
  - No leakage of other boards' data

- **5.1.2 Agent sees only their assigned tasks (My Tasks)**
  - `/my-tasks` filters by session.user.agentId in task_assignees

- **5.1.3 Agent sees all tasks on boards they're members of (Board View)**
  - `/tasks?board=X` shows all tasks if agent is a member, not just assigned tasks

### 5.2 Agent Permissions

- **5.2.1 Agent creates task on their board**
  - Allowed; creator_id set to agent

- **5.2.2 Agent edits task they created**
  - Allowed

- **5.2.3 Agent edits task created by someone else**
  - Allowed if on same board (member access)

- **5.2.4 Agent cannot manage columns, custom fields, webhooks, or board settings**
  - All return 403; UI hides controls

### 5.3 Agent Removed Mid-Session

- **5.3.1 Agent is viewing board when removed by admin**
  - Next API call returns 403
  - UI: show "You no longer have access to this board" + redirect to `/my-tasks`

---

## 6. Cross-Cutting Edge Cases

### 6.1 Concurrent Operations

- **6.1.1 Two admins edit same board settings simultaneously**
  - Last write wins (no locking)

- **6.1.2 Admin deletes board while agent is creating task**
  - Task creation fails with 404 (project not found)
  - Show error toast

### 6.2 Data Integrity

- **6.2.1 Orphaned tasks (column deleted without moving tasks)**
  - Should never happen — API blocks column deletion if tasks exist
  - If data corruption: tasks with invalid column_id — board query filters them out, admin tool to reassign

- **6.2.2 Agent deactivated in agents table**
  - Keep all assignments, comments, activity
  - Show "(inactive)" badge on their avatar
  - Block new assignments to deactivated agents

- **6.2.3 Workspace owner deleted from agents table**
  - CASCADE on agents(id) would destroy workspace — block this
  - Add application-level check before deactivating/deleting an agent

### 6.3 Performance

- **6.3.1 Board with 1000+ tasks**
  - Virtualize card lists (Milestone 5)
  - Paginate or lazy-load beyond 500

- **6.3.2 Board with 15 columns, 200 tasks each**
  - Horizontal scroll performance
  - Only render visible columns (intersection observer)

- **6.3.3 Agent is member of 20+ boards**
  - Sidebar scrollable section for board list
  - Search/filter boards in selector

---

## 7. Workspace-Level Operations

### 7.1 Single Workspace (Current)

- **7.1.1 Default workspace auto-created**
  - "Rising Lion" workspace created on first access
  - All boards belong to this workspace

### 7.2 Multi-Workspace (Future Scope)

- **7.2.1 Not in current scope**
  - Schema supports it (workspace_id on projects)
  - UI and API assume single workspace for now
  - Documented for future expansion

---

*Reference for: plan.md milestones, QA test plans, API route design*
