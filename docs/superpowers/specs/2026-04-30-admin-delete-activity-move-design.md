# Admin-Only Activity Delete (move entries) — Design

**Date:** 2026-04-30
**Status:** Approved, ready for implementation plan
**Scope:** Task Board → Task detail view → Activity feed

## Problem

Funnel KPIs on the dashboard are derived from `activity_log` `task_moved` rows (per `CLAUDE.md` rule #11 — every cumulative tile uses `MIN(activity_log.created_at)` where `LOWER(new_value)` is in a funnel-stage set).

When an agent accidentally moves a card to **Won** (or any other status) and then moves it elsewhere, the stray `task_moved` entry remains in `activity_log` and pollutes cumulative funnel tiles forever — e.g. a card briefly touched by **Won** keeps counting under Won/Meetings Done/Proposals Viewed for the day it was touched, even though its current column is something else.

There is no way today to correct an accidental status move. Admins need one.

## Goal

Allow admins (and only admins) to delete a single `task_moved` activity entry from a task's activity feed, so cumulative dashboard KPIs no longer reflect the accidental move.

## Non-goals

- Deleting comments, task-creation entries, field edits, or any non-move activity (out of scope).
- Bulk delete (e.g. "remove every move to Won on this card") — single-entry delete is enough.
- Undo / restore. The delete is permanent.
- An audit trail of who deleted what. Can be added later if needed; not requested.
- Soft-delete with `deleted_at` filter clauses across funnel queries.

## Approach

**Hard delete, admin-only, scoped to `task_moved`.**

Migration 007 already allows DELETE on `activity_log` (only UPDATE is blocked by the trigger), so no schema change is needed. Funnel queries already use `MIN(created_at)` over remaining rows, so removing a row makes the funnel re-resolve to the next earliest move automatically.

## UI changes

**File:** `src/components/tasks/task-full-view.tsx` (~line 1101, the `activity.map((entry) => ...)` block)

For each rendered activity entry where:

- `entry.action_type === 'task_moved'`, AND
- the current session's `user.role === 'admin'`

…render a small trash-icon button at the top-right of the entry, visible on hover. Click flow:

1. Browser `confirm()` dialog with message:
   > *"Delete this status move? This will remove '{old_value} → {new_value}' from the activity log and update dashboard counts. This cannot be undone."*
2. On confirm, call the new `DELETE /api/tasks/[id]/activity/[activityId]` route.
3. On 200, optimistically remove the entry from the local `activity` state and call `router.refresh()` so the parent page re-fetches and the dashboard tiles re-compute on next visit.
4. On non-200, surface a toast / inline error and leave the entry in place.

No tombstone or "deleted by admin" marker — entries are simply gone (matches the hard-delete decision).

The `confirm()` dialog matches the existing pattern in the codebase (e.g. board-members-panel uses browser `confirm()` per UX-5 audit item, see `CLAUDE.md`). No new styled dialog is introduced.

## API

**New route:** `src/app/api/tasks/[id]/activity/[activityId]/route.ts`

```
DELETE /api/tasks/[id]/activity/[activityId]
```

Behavior:

1. `auth()` → require session.
2. Require `session.user.role === 'admin'`. If not, return `403 { error: "Forbidden" }`.
3. Delegate to `deleteActivityMoveAction(taskId, activityId)` (server action — see below).
4. Return `200 { ok: true }` on success, `404 { error: "Not found" }` if no row matched, `400 { error: "Bad request" }` if the entry exists but is not a `task_moved` row or doesn't belong to this task.

The route handler is thin; all logic lives in the server action so cache invalidation is centralized.

## Server action

**File:** `src/lib/task-actions.ts`

Add:

```ts
export async function deleteActivityMoveAction(
  taskId: string,
  activityId: string,
): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "not_found" | "wrong_type" }>
```

Behavior:

1. `auth()` → require admin role. Return `{ ok: false, reason: "forbidden" }` if not.
2. Call `deleteActivityMoveEntry(taskId, activityId)` in `task-data.ts`.
3. On success, run cache invalidation:
   - `revalidatePath('/tasks')`
   - `revalidatePath('/dashboard')`
   - `revalidatePath('/my-dashboard')`
   - Clear stats cache: `DELETE FROM stats_cache` (matches the blanket-clear pattern used elsewhere in mutations).
4. Return result.

## Data layer

**File:** `src/lib/task-data.ts`

Add:

```ts
export async function deleteActivityMoveEntry(
  taskId: string,
  activityId: string,
): Promise<"deleted" | "not_found" | "wrong_type">
```

Behavior:

1. SELECT the row by `id = $activityId AND task_id = $taskId`. If not found, return `"not_found"`.
2. If `action_type !== 'task_moved'`, return `"wrong_type"`. (Defense-in-depth — admins should not be able to URL-poke the route to delete comments.)
3. Run `DELETE FROM activity_log WHERE id = $activityId AND task_id = $taskId AND action_type = 'task_moved'`.
4. If the DELETE throws because the trigger is in a stale state, fall back to `fixActivityLogTrigger()` and retry — same pattern already used by `deleteTask` and `deleteProject` in this file.
5. Return `"deleted"`.

## Funnel correctness — why this works

Per `CLAUDE.md` rule #11:

- `move_in_<metric>` CTEs find `MIN(activity_log.created_at)` of `task_moved` rows whose `LOWER(new_value)` is in that metric's funnel-stage set.
- `task_visited.first_<metric>_at` is `LEAST(move_in_<metric>.first_in, created_at_fallback)`.
- Cumulative tiles date-filter on `first_<metric>_at BETWEEN start AND end`.

Deleting the stray "moved to Won" row makes the `MIN()` resolve to whatever the next `task_moved` row to a won-stage column is (typically nothing, since the agent corrected the mistake) — so `first_won_at` becomes NULL for that task and it stops counting under Won. Same logic cascades for Meetings Done, Proposals Viewed, etc. for any other accidental status touched.

Current-state tiles (Won today, Lost today, Bad Leads, etc.) read from `tasks.column_id` directly and are not affected by the deletion. They will already be correct because the agent moved the card off Won when correcting the mistake.

## Cache busting

Stats are cached in `stats_cache` with a 5-min TTL. Without a bust, an admin could delete an entry and still see the wrong number on the dashboard for up to 5 min. To avoid that, the server action clears `stats_cache` (DELETE all rows) — same blanket-clear approach used by other mutating actions in the file. Targeted invalidation by cache key prefix is possible but not warranted: deletions are rare and the cost of a full re-compute is bounded.

## Permissions matrix

| Role  | View activity | Delete `task_moved` | Delete comment / other activity |
|-------|---------------|---------------------|---------------------------------|
| Admin | Yes           | Yes                 | No (out of scope)               |
| Agent | Yes           | No                  | No                              |

Comments retain their existing 60-min author-edit/delete window — not changed.

## Files changed

| File | Change |
|------|--------|
| `src/lib/task-data.ts` | Add `deleteActivityMoveEntry()` |
| `src/lib/task-actions.ts` | Add `deleteActivityMoveAction()` with cache invalidation |
| `src/app/api/tasks/[id]/activity/[activityId]/route.ts` | New file — DELETE handler, admin-only |
| `src/components/tasks/task-full-view.tsx` | Add trash-icon button + delete handler in the activity feed render block |

No migration, no DB schema change, no new env vars.

## Risks

- **Audit-trail gap.** Once deleted, there's no record the entry ever existed. Mitigated by admin-only access and confirmation dialog. If audit becomes a requirement, the path forward is a separate `activity_log_deletions` table written by the server action — additive, doesn't change this design.
- **Race with concurrent moves.** If an agent moves the same card while admin is reviewing the activity, the deleted entry could be a stale view. Mitigated by `task_id` + `id` match in the DELETE — only the exact entry the admin clicked is removed.
- **Stats cache lag for other admins.** A blanket `DELETE FROM stats_cache` busts everyone's cache, which is the right behavior here.

## Test plan

Manual checks (no automated test framework in repo):

1. As agent: open task detail. Confirm trash-icon is **not** rendered next to any activity entry.
2. As admin: open task detail with a task that has at least one `task_moved` entry and one `comment_added` entry. Confirm trash-icon shows on `task_moved` entries only on hover.
3. Click trash on a `task_moved` entry → confirm dialog appears with old → new column names.
4. Cancel → entry stays.
5. Confirm → entry disappears from feed; reload page and confirm it's still gone.
6. Direct API hit: `DELETE /api/tasks/{id}/activity/{commentActivityId}` as admin → expect 400 (wrong type).
7. Direct API hit as agent → expect 403.
8. Set up a card: move to **Won**, then move to **In Chat**. Verify dashboard "Won today" tile counts the card. Delete the "moved to Won" activity entry. Reload `/dashboard`. Verify "Won today" no longer counts that card.
9. Verify "Proposals Viewed today", "Meetings Booked today", "Meetings Done today" also drop the card after deletion (cumulative funnel cascade).
