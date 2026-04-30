# Admin-Only Activity Delete (move entries) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins delete a single `task_moved` activity-log entry from a task's activity feed so cumulative dashboard funnel KPIs no longer count an accidental status move.

**Architecture:** Thin DELETE API route → server action (cache invalidation) → data-layer function (constrained DELETE on `activity_log`). UI: hover-only trash button on `task_moved` rows in the activity feed, gated on `isAdmin`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, NextAuth.js v5, `@vercel/postgres` raw SQL, sonner toasts, lucide-react icons.

**Design spec:** `docs/superpowers/specs/2026-04-30-admin-delete-activity-move-design.md`

**Note on testing:** This repo has no test framework (per `CLAUDE.md`). Each task verifies via `npm run lint`, `npm run build`, and the manual smoke checks in Task 5.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lib/task-data.ts` | Modify | Add `deleteActivityMoveEntry()` — constrained DELETE on `activity_log` |
| `src/lib/task-actions.ts` | Modify | Add `deleteActivityMoveAction()` — admin check + cache bust + delegate |
| `src/app/api/tasks/[id]/activity/[activityId]/route.ts` | Create | Thin DELETE handler that delegates to the action |
| `src/components/tasks/task-full-view.tsx` | Modify | Render hover-only trash button on `task_moved` activity rows when `isAdmin`, wire delete handler |

No migration. No new env vars. No new dependencies.

---

## Task 1: Data layer — `deleteActivityMoveEntry`

**Files:**
- Modify: `src/lib/task-data.ts` (add new function next to `getTaskActivity` near line 1417)

- [ ] **Step 1: Read current state**

Open `src/lib/task-data.ts` and locate `getTaskActivity` (~line 1417). The new function will go immediately before it, after `addActivityLog` (~line 1380-1415). Note that `fixActivityLogTrigger` already exists at the top of the file (~line 5-22) and is used by `deleteTask` and `deleteProject` — reuse it.

- [ ] **Step 2: Add the new function**

Insert the following code in `src/lib/task-data.ts` immediately after the closing `}` of `addActivityLog` and before `getTaskActivity`:

```ts
/**
 * Admin-only: delete a single `task_moved` activity-log entry.
 *
 * Returns:
 *   "deleted"     — row removed
 *   "not_found"   — no row matched (taskId, activityId)
 *   "wrong_type"  — row exists but action_type !== 'task_moved'
 *
 * Falls back to `fixActivityLogTrigger()` + retry if migration 007 was not
 * applied on this database (same pattern as deleteTask / deleteProject).
 */
export async function deleteActivityMoveEntry(
  taskId: string,
  activityId: string
): Promise<"deleted" | "not_found" | "wrong_type"> {
  const existing = await sql`
    SELECT action_type
    FROM activity_log
    WHERE id = ${activityId} AND task_id = ${taskId}
    LIMIT 1
  `;
  if (existing.rows.length === 0) return "not_found";
  if (existing.rows[0].action_type !== "task_moved") return "wrong_type";

  try {
    await sql`
      DELETE FROM activity_log
      WHERE id = ${activityId}
        AND task_id = ${taskId}
        AND action_type = 'task_moved'
    `;
  } catch {
    await fixActivityLogTrigger();
    await sql`
      DELETE FROM activity_log
      WHERE id = ${activityId}
        AND task_id = ${taskId}
        AND action_type = 'task_moved'
    `;
  }

  return "deleted";
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: No errors in `task-data.ts`. (Existing warnings unrelated to this file are fine.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/task-data.ts
git commit -m "feat(activity): add deleteActivityMoveEntry data-layer fn"
```

---

## Task 2: Server action — `deleteActivityMoveAction`

**Files:**
- Modify: `src/lib/task-actions.ts` (add to imports and after `deleteTaskAction` near line 122)

- [ ] **Step 1: Add import**

In `src/lib/task-actions.ts`, locate the multi-line import from `@/lib/task-data` (currently lines 5-34). Add `deleteActivityMoveEntry` to that import list. Final import block should include:

```ts
import {
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  createComment,
  toggleChecklistItem,
  createChecklistItem,
  deleteChecklistItem,
  setTaskAssignees,
  setTaskTags,
  syncJobStatusFromTask,
  syncAllJobsInColumn,
  createProject,
  updateProject,
  deleteProject,
  addProjectMembers,
  updateMemberRole,
  removeProjectMember,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  createTag,
  findConflictingTag,
  getProjectTags,
  getCustomFieldDefinitions, createCustomFieldDefinition, updateCustomFieldDefinition,
  archiveCustomFieldDefinition, restoreCustomFieldDefinition, reorderCustomFieldDefinitions,
  getSavedViews, createSavedView, deleteSavedView,
  deleteActivityMoveEntry,
} from "@/lib/task-data";
```

- [ ] **Step 2: Add `sql` import for cache bust**

In `src/lib/task-actions.ts`, the `moveTaskAction` function already does a dynamic import of `sql` (line 93: `const { sql } = await import("@/lib/db");`). Use the same dynamic-import pattern in the new action — do NOT add a new top-level `sql` import (keep the file's existing convention).

- [ ] **Step 3: Add the new server action**

Insert the following immediately after `deleteTaskAction` (after line 122, before `createCommentAction`):

```ts
export async function deleteActivityMoveAction(
  taskId: string,
  activityId: string
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "not_found" | "wrong_type" }> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "forbidden" };
  if (session.user.role !== "admin") return { ok: false, reason: "forbidden" };

  const result = await deleteActivityMoveEntry(taskId, activityId);
  if (result !== "deleted") return { ok: false, reason: result };

  // Bust stats cache so dashboard tiles re-compute on next read.
  const { sql } = await import("@/lib/db");
  await sql`DELETE FROM stats_cache`;

  // Revalidate task pages + every dashboard surface that derives from activity_log.
  revalidatePath("/tasks");
  revalidatePath("/my-tasks");
  revalidatePath("/dashboard");
  revalidatePath("/my-dashboard");
  revalidatePath("/pipeline");
  revalidatePath("/my-pipeline");

  return { ok: true };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: No errors in `task-actions.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-actions.ts
git commit -m "feat(activity): add admin-only deleteActivityMoveAction with cache bust"
```

---

## Task 3: API route — `DELETE /api/tasks/[id]/activity/[activityId]`

**Files:**
- Create: `src/app/api/tasks/[id]/activity/[activityId]/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p "src/app/api/tasks/[id]/activity/[activityId]"
```

- [ ] **Step 2: Create the route handler**

Write `src/app/api/tasks/[id]/activity/[activityId]/route.ts` with this exact content:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteActivityMoveAction } from "@/lib/task-actions";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden", required_role: "admin" },
      { status: 403 }
    );
  }

  const { id: taskId, activityId } = await params;
  const result = await deleteActivityMoveAction(taskId, activityId);

  if (result.ok) return NextResponse.json({ ok: true });

  if (result.reason === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Activity entry not found" }, { status: 404 });
  }
  if (result.reason === "wrong_type") {
    return NextResponse.json(
      { error: "Only task_moved entries can be deleted" },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: "Unknown error" }, { status: 500 });
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run lint && npm run build`
Expected: No errors. Next should compile the new route. Note: `next.config.ts` has `typescript.ignoreBuildErrors: true` for pre-existing strict-mode errors elsewhere — but new code in this PR must still be lint-clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/[id]/activity/[activityId]/route.ts"
git commit -m "feat(activity): add DELETE /api/tasks/[id]/activity/[activityId] route"
```

---

## Task 4: UI — admin trash button on `task_moved` activity entries

**Files:**
- Modify: `src/components/tasks/task-full-view.tsx`
  - Imports (~line 8-44)
  - Activity render block (~line 1101-1125)

- [ ] **Step 1: Verify `Trash2` and `toast` are already imported**

Open `src/components/tasks/task-full-view.tsx`. Confirm:
- `Trash2` is in the lucide-react import (line 23) ✅
- `toast` from `"sonner"` is imported (line 47) ✅
- `isAdmin` prop is destructured in `TaskFullView({ ... })` (line 120) ✅

No import changes needed.

- [ ] **Step 2: Add `deletingActivityIds` state near other useState calls**

Around line 127 (after `const [activity, setActivity] = useState<ActivityLogEntry[]>([]);`), add:

```ts
const [deletingActivityIds, setDeletingActivityIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Add `handleDeleteActivity` handler**

Add this function inside the `TaskFullView` component, just before the `return (` statement. A good location is right after the existing async handlers (search for `async function` definitions inside the component, or place it near the bottom of the component body before `return (`):

```ts
const handleDeleteActivity = useCallback(async (entry: ActivityLogEntry) => {
  if (entry.action_type !== "task_moved") return;
  const confirmMsg = `Delete this status move? This will remove "${entry.old_value ?? "—"} → ${entry.new_value ?? "—"}" from the activity log and update dashboard counts. This cannot be undone.`;
  if (!window.confirm(confirmMsg)) return;

  setDeletingActivityIds((prev) => {
    const next = new Set(prev);
    next.add(entry.id);
    return next;
  });

  try {
    const res = await fetch(`/api/tasks/${taskId}/activity/${entry.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to delete activity entry");
      return;
    }
    setActivity((prev) => prev.filter((a) => a.id !== entry.id));
    toast.success("Activity entry deleted");
    router.refresh();
  } catch {
    toast.error("Network error while deleting activity entry");
  } finally {
    setDeletingActivityIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
  }
}, [taskId, router]);
```

- [ ] **Step 4: Modify the activity render block to add the trash button**

Locate the existing activity-feed render block (~line 1104-1123). Replace the entire `activity.map((entry) => ( ... ))` block with this version, which adds an admin-only hover trash button:

```tsx
activity.map((entry) => {
  const canDelete = isAdmin && entry.action_type === "task_moved";
  const isDeleting = deletingActivityIds.has(entry.id);
  return (
    <div key={entry.id} className="group relative text-xs border-l-2 border-muted pl-3 py-1">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{entry.actor_name ?? entry.actor_label}</span>
        <span className="text-muted-foreground">
          {entry.action_type === "comment_added" ? "commented"
            : entry.action_type === "task_created" ? "created this task"
            : entry.action_type === "task_moved" ? `moved to ${entry.new_value}`
            : `changed ${entry.field}`}
        </span>
      </div>
      {entry.action_type === "comment_added" && entry.new_value && (
        <div className="mt-1 text-foreground bg-muted/50 rounded px-2 py-1">{entry.new_value}</div>
      )}
      {entry.action_type === "field_changed" && entry.old_value && (
        <div className="text-muted-foreground mt-0.5">{entry.old_value} &rarr; {entry.new_value}</div>
      )}
      <div className="text-muted-foreground/60 mt-0.5" title={entry.created_at}>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</div>
      {canDelete && (
        <button
          type="button"
          onClick={() => handleDeleteActivity(entry)}
          disabled={isDeleting}
          aria-label="Delete this status move"
          title="Delete this status move (admin)"
          className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
})
```

Key changes vs. the existing block:
- Wrapper `<div>` gains `group relative` so the absolutely-positioned button can use `group-hover:flex`.
- Returns from arrow function via `{ ... return ( ... ); }` instead of implicit return — needed so we can compute `canDelete` and `isDeleting`.
- New trash button at `absolute top-1 right-1`, hidden until row hover.
- Loading spinner replaces icon while the request is in flight.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: No errors related to this file.

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/task-full-view.tsx
git commit -m "feat(activity): admin-only trash button on task_moved activity rows"
```

---

## Task 5: Manual smoke test (no automated tests in this repo)

**Goal:** Verify end-to-end behavior. Do these checks against a dev server (`npm run dev`).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (already running is fine)
Open: `http://localhost:3000`

- [ ] **Step 2: Test as agent — trash button must NOT appear**

1. Log in as any agent (use the agent passwords seeded in migration 005).
2. Open `/my-tasks`.
3. Click any task with a `task_moved` history entry to open the detail modal.
4. Hover each row in the **Activity** feed.
5. **Expected:** No trash icon appears on any row, including `task_moved` rows.

- [ ] **Step 3: Test as admin — trash button gated to task_moved**

1. Log out, log in as admin (`ADMIN_CREDENTIALS` from env).
2. Open `/tasks`, click a task with at least one `task_moved` entry **and** one `comment_added` entry.
3. Hover the `task_moved` row → **trash icon appears, top-right**.
4. Hover the `comment_added` row → **no trash icon**.
5. Hover the `task_created` row → **no trash icon**.

- [ ] **Step 4: Test the confirm dialog**

1. As admin, click trash on a `task_moved` entry.
2. **Expected:** Browser confirm dialog with the message: *"Delete this status move? This will remove "{old} → {new}" from the activity log and update dashboard counts. This cannot be undone."*
3. Click **Cancel** → entry stays.
4. Click trash again, click **OK** → entry disappears from the feed; success toast appears.

- [ ] **Step 5: Test API direct hits (defense-in-depth)**

Open browser devtools while logged in as admin. In the Console:

```js
// Get a comment_added activity id from the current page (devtools → Network → activity).
// Replace TASK_ID and COMMENT_ACT_ID below.
fetch("/api/tasks/TASK_ID/activity/COMMENT_ACT_ID", { method: "DELETE" })
  .then((r) => r.json().then((b) => ({ status: r.status, body: b })))
  .then(console.log);
```

**Expected:** `{ status: 400, body: { error: "Only task_moved entries can be deleted" } }`

Log out, log in as agent, repeat with a valid `task_moved` id:
**Expected:** `{ status: 403, body: { error: "Forbidden", required_role: "admin" } }`

- [ ] **Step 6: Test dashboard impact (the actual point of this feature)**

1. As agent (or admin acting as one), pick a Todo card.
2. Move it to **Won**. Then move it to **In Chat** (or any non-Won column).
3. Open `/dashboard` with today's date filter.
4. Note the **Won** tile count and **Meetings Done / Proposals Viewed** tiles (cumulative).
5. As admin, open the card, find the `task_moved → Won` activity entry, click trash, confirm.
6. Hard-refresh `/dashboard` (Ctrl+Shift+R — `stats_cache` was cleared and `revalidatePath` ran, but the browser may have its own cache).
7. **Expected:** The Won tile count drops by one. Meetings Done / Proposals Viewed drop by one as well (cumulative cascade).
8. The card itself is still visible in the Task Board in its current column — only the activity entry was removed.

- [ ] **Step 7: Verification commit (optional)**

If you tweaked any code during smoke testing, commit. Otherwise skip.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-04-30-admin-delete-activity-move-design.md`):

| Spec section | Implemented in |
|--------------|----------------|
| Data-layer `deleteActivityMoveEntry` | Task 1 |
| Server action `deleteActivityMoveAction` w/ cache invalidation | Task 2 |
| API route `DELETE /api/tasks/[id]/activity/[activityId]` | Task 3 |
| UI trash button gated to admin + `task_moved` | Task 4 |
| `confirm()` dialog with old → new column names | Task 4 step 3 |
| Optimistic remove + `router.refresh()` | Task 4 step 3 |
| `stats_cache` blanket clear | Task 2 step 3 |
| `revalidatePath` for /tasks, /dashboard, /my-dashboard | Task 2 step 3 (also added /my-tasks, /pipeline, /my-pipeline since they also derive from `activity_log` per CLAUDE.md rule #11) |
| Defense-in-depth: action_type check at API + data layer | Task 1 step 2 + Task 3 step 2 |
| No schema change | Confirmed — migration 007 already permits DELETE |
| Test plan from spec | Task 5 |

All spec sections covered.

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague handlers. Every step has exact code or exact command.

**3. Type consistency:**
- Data layer returns `"deleted" | "not_found" | "wrong_type"` (Task 1).
- Server action returns `{ ok: true } | { ok: false; reason: "forbidden" | "not_found" | "wrong_type" }` — adds `"forbidden"` for the auth failure case, drops `"deleted"` (it's the success case represented by `ok: true`). Consistent.
- API route maps `forbidden → 403`, `not_found → 404`, `wrong_type → 400`. Consistent with HTTP semantics.
- UI calls `fetch(...).method = "DELETE"`, reads `body.error` from non-OK responses. Matches what the route returns.

No drift.

**4. Scope check:** Single feature, ~4 files, single PR. Right-sized.

---

## Out-of-Scope (explicitly NOT in this plan)

- Soft delete / restore. Deletion is permanent (per spec).
- Bulk delete of multiple entries. Single-row only.
- Audit log of who deleted what. Can be added later as a separate `activity_log_deletions` table without changing this design.
- Deleting comments, field edits, or task_created entries.
- Updating CLAUDE.md to document the new admin capability — that's a separate documentation pass after merge.
