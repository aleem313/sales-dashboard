# Task Board — Technical Fix Guide

> **Purpose:** Detailed technical fixes for all reported bugs + UI/UX improvements.
> **Last Updated:** 2026-03-31

---

## FIX 1: Board Deletion Failing — "Failed to delete the board"

### Root Cause

The `activity_log` table has a `BEFORE UPDATE OR DELETE` trigger (`trg_activity_log_append_only`) that **raises an EXCEPTION on DELETE**, preventing ANY delete of activity_log rows — including CASCADE deletes triggered when a task or project is deleted.

**Schema (line 286-299 in `006_task_management_schema.sql`):**
```sql
CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only: % operations are not allowed', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_activity_log_mutation();
```

**Delete chain:** `DELETE project` → CASCADE deletes `tasks` → CASCADE deletes `activity_log` → **TRIGGER BLOCKS → entire transaction fails**.

### Fix: Migration 007

```sql
-- 007_fix_activity_log_trigger.sql
-- Fix: Allow DELETE on activity_log (for CASCADE), block only UPDATE (preserves append-only audit)

CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'activity_log is append-only: UPDATE operations are not allowed';
  END IF;
  -- Allow DELETE (needed for CASCADE from tasks/projects)
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger (idempotent)
DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log;
CREATE TRIGGER trg_activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_activity_log_mutation();
```

### Defense-in-Depth: Update `deleteTask()` in `task-data.ts`

Even after the trigger fix, add explicit activity_log cleanup as a safety net:

```typescript
// task-data.ts — deleteTask()
export async function deleteTask(taskId: string, actorId?: string | null): Promise<boolean> {
  const task = await sql`SELECT title FROM tasks WHERE id = ${taskId}`;
  if (task.rows.length === 0) return false;

  // Explicitly delete activity_log entries first (bypass trigger if not yet fixed)
  await sql`DELETE FROM activity_log WHERE task_id = ${taskId}`;
  
  // Now delete the task (other FKs have ON DELETE CASCADE)
  await sql`DELETE FROM tasks WHERE id = ${taskId}`;
  return true;
}
```

### Defense-in-Depth: Update `deleteProject()` in `task-data.ts`

```typescript
export async function deleteProject(projectId: string): Promise<boolean> {
  // Delete activity_log for all tasks in this project first
  await sql`
    DELETE FROM activity_log 
    WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ${projectId})
  `;
  
  // Now CASCADE handles the rest (tasks, columns, members, tags, etc.)
  const result = await sql`DELETE FROM projects WHERE id = ${projectId}`;
  return (result.rowCount ?? 0) > 0;
}
```

---

## FIX 2: Task Deletion Failing

### Root Cause

Same as Fix 1 — activity_log trigger blocks cascade.

### Fix

Apply the same trigger fix (migration 007) + the `deleteTask()` defense-in-depth code above.

### Frontend Fix (task-detail-drawer.tsx)

The `handleDelete` function doesn't show error details:

```typescript
// task-detail-drawer.tsx — handleDelete()
function handleDelete() {
  if (!task) return;
  if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
  startTransition(async () => {
    try {
      await deleteTaskAction(task.id);
      store.removeTask(task.id);
      toast.success("Task deleted");
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete task");
    }
  });
}
```

---

## FIX 3: Admin Restriction — All Members Changed to "member" Breaks System

### Root Cause

The system admin logs in via `ADMIN_CREDENTIALS` env var and has `session.user.role === "admin"` but **no row in the `agents` table**, therefore **no row in `project_members`**. When:

1. All project_members are changed to "member" role → 0 admins in project_members
2. The last-admin guard in `updateMemberRole()` correctly prevents this
3. BUT: system admin can bypass the guard because API checks `session.user.role`, not project_members.role
4. The issue is likely that the frontend code doesn't properly distinguish "system admin" from "project admin"

### Fix: Backend Logic

The `updateMemberRole()` function already prevents demoting the last admin. The issue is likely that the system admin (who has no project_members entry) can change all members' roles and then operations that query project_members for admin status fail.

**Add a system admin bypass to project-level admin checks:**

```typescript
// In routes that check project_members.role, also check session.user.role:
// e.g., in task-data.ts

export async function getProjectMemberRole(projectId: string, agentId: string | null): Promise<string | null> {
  if (!agentId) return null; // System admin has no agentId → role comes from session
  const result = await sql`
    SELECT role FROM project_members
    WHERE project_id = ${projectId} AND agent_id = ${agentId}
    LIMIT 1
  `;
  return result.rows[0]?.role ?? null;
}
```

**Frontend: Board page should check `session.user.role` first, then project_members.role:**

The board page (`tasks/page.tsx` line 26) already does:
```typescript
const isAdmin = session?.user?.role === "admin";
```

This means system admins ARE treated as admin in the UI. The fix is to ensure all API routes ALSO check `session.user.role === "admin"` as a universal override:

```typescript
// In any API route that checks project membership:
const isSystemAdmin = session.user.role === "admin";
if (!isSystemAdmin) {
  const agentId = session.user.agentId;
  if (!agentId || !(await isProjectMember(projectId, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }
}
```

---

## FIX 4: Drag — Entire Card Should Be Draggable

### Root Cause

Currently, `SortableTaskCard` passes `listeners` and `attributes` as `dragHandleProps` to a small `<button>` with `GripVertical` icon. Only that button initiates drag.

### Fix: `task-card.tsx`

```typescript
// SortableTaskCard — apply listeners to entire card
export function SortableTaskCard({ task, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "task", task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskCardContent
      ref={setNodeRef}
      style={style}
      task={task}
      onClick={onClick}
      isDragging={isDragging}
      // Apply drag listeners to entire card, not just handle
      {...attributes}
      {...listeners}
    />
  );
}
```

Then in `TaskCardContent`, remove the `dragHandleProps` prop and the `GripVertical` button. The entire card div becomes the drag target. The `PointerSensor` 8px activation distance already prevents accidental drags when clicking.

**Key change:** Remove `dragHandleProps` prop from `TaskCardContent` signature and remove the `<button {...dragHandleProps}>` with `GripVertical`.

---

## FIX 5: Assignee Dropdown Not Working Like ClickUp

### Root Cause

The task detail drawer shows assignees as flat toggle chips (`<button>` per member). This doesn't look like ClickUp's dropdown with avatars and search.

### Fix: Create Assignee Popover Component

```typescript
// New: src/components/tasks/assignee-popover.tsx
"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectMember } from "@/lib/task-data";

interface AssigneePopoverProps {
  members: ProjectMember[];
  assignedIds: string[];
  onToggle: (agentId: string) => void;
  disabled?: boolean;
}

export function AssigneePopover({ members, assignedIds, onToggle, disabled }: AssigneePopoverProps) {
  const [search, setSearch] = useState("");
  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 hover:border-primary transition-colors" disabled={disabled}>
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-2" align="start">
        <Input
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm mb-2"
          autoFocus
        />
        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
          {filtered.map((m) => {
            const isAssigned = assignedIds.includes(m.agent_id);
            return (
              <button
                key={m.agent_id}
                onClick={() => onToggle(m.agent_id)}
                className={cn(
                  "flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                  isAssigned && "bg-primary/5"
                )}
              >
                {/* Avatar */}
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {m.avatar_url
                    ? <img src={m.avatar_url} className="h-full w-full rounded-full object-cover" />
                    : m.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
                  }
                </div>
                <span className="flex-1 text-left truncate">{m.name}</span>
                {isAssigned && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No members found</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Use this in both `task-detail-drawer.tsx` and `task-create-modal.tsx` to replace the current chip-toggle and multi-select approaches.

---

## UI/UX IMPROVEMENT SUGGESTIONS

### 1. Missing Features Beyond What Was Mentioned

| Feature | Priority | Description |
|---------|----------|-------------|
| **Task Templates** | P2 | Save task structure as template; quick-create from template |
| **Board Templates** | P3 | Predefined board setups (Upwork Pipeline, Sprint Board, etc.) |
| **Task Dependencies** | P3 | "Blocked by" / "Blocks" relationships between tasks |
| **Recurring Tasks** | P3 | Auto-create tasks on schedule (Vercel cron) |
| **Task Watchers** | P2 | "Watch" a task without being assigned — get notifications |
| **Activity Feed (Global)** | P2 | Dashboard-level activity across all boards |
| **Board Analytics** | P2 | Tasks completed per week, avg time in column, cycle time |
| **Batch Import** | P3 | CSV/JSON import of tasks |
| **Task Duplication** | P1 | "Duplicate task" in context menu → copies all fields except assignees |
| **Column Collapse** | P1 | Collapse column to just header (save board space) |
| **Swimlanes** | P3 | Horizontal grouping within columns (e.g., by priority) |

### 2. Card Design Improvements

- **Left color border** instead of grip handle — 3px colored border on left side (column color)
- **Compact mode toggle** — shrink cards to title + priority only (useful for boards with many tasks)
- **Card age indicator** — subtle "Created 5d ago" or "Stale: no activity in 14d" badge
- **Priority as flag icon** — ClickUp uses colored flag icons, not text badges

### 3. Drag & Drop UX Improvements

- **Drop placeholder** — show a colored line or semi-transparent card outline at drop position (currently only column highlights)
- **Scroll on drag** — auto-scroll board horizontally when dragging near edges
- **Multi-drag** — select multiple cards then drag them together (P2)
- **Drag preview** — show task count if multi-dragging ("Moving 3 tasks")

### 4. Board Structure Improvements

- **List view toggle** — switch between Board (kanban) and List (table) view
- **Calendar view** — tasks on a calendar by due date (P3)
- **Column collapse** — click column header to collapse to icon-width (saves space with 13+ columns)
- **"Add Status" at end** — visible "+" button at the rightmost position of the board

### 5. Performance & Usability

- **Stale data indicator** — if board data is >60s old, show subtle "Refresh" button
- **Keyboard shortcuts** — N (new task), / (search), Arrow keys (navigate), Enter (open drawer)
- **Offline indicator** — show "Offline — changes will sync when reconnected" banner
- **Undo history** — beyond just drag undo, support undo for field changes (5s window)

---

## STATE MANAGEMENT IMPROVEMENTS

### Current Issues

1. **Zustand store re-initializes on every server render** — `initBoard()` called in `useEffect` with `[columns, tasks, members, projectId]` deps, but these are new object references each render → store flickers
2. **No optimistic update for task create** — new task only appears after `revalidatePath` server action completes
3. **Filter state in both Zustand AND URL** — can desync; single source of truth needed

### Recommended Fixes

1. **Deep-compare before re-init:** Compare incoming data with store state; skip `initBoard` if data hasn't meaningfully changed (use JSON.stringify or a hash)
2. **Optimistic task create:** `store.addTask(tempTask)` immediately → replace with server-returned task after action completes
3. **URL as source of truth for filters:** Remove filter state from Zustand; read directly from `searchParams` in `getFilteredTasks()`
4. **Persist drag queue:** If a drag is in-flight and another starts, queue the second drag instead of losing it

---

*This document is the implementation reference for Milestone 2B and Milestone 3.*
