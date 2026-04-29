# Taskboard Per-Column Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only 5 cards per column initially, load 10 more on scroll. Total counts come from a separate server query and remain accurate under filters. Sort tasks by priority → last status update → created_at.

**Architecture:** Server-side pagination per column with a separate count aggregation. The Next.js page reads URL filters and calls a new `getProjectColumnsTasksPaged` to return `{ tasks, totalCount, hasMore } per column`. A new GET API route returns the next page on demand. Zustand board store tracks per-column counts, loaded counts, hasMore, and loading state. `IntersectionObserver` at the bottom of each column triggers `loadMoreForColumn`. DnD count adjustments and a server-aware `position: number | null` keep moves correct when the destination column has unloaded tail. Auto-refresh is replaced by a `refreshBoard()` store action that re-fetches counts plus the currently-loaded window.

**Tech Stack:** Next.js 16 App Router · TypeScript · `@vercel/postgres` raw SQL · Zustand · `@dnd-kit` · Tailwind. No test framework — verification is manual smoke + a quick SQL spot-check.

**Sort rule (universal, replaces existing per-column logic):**
1. Priority (urgent → high → medium → low → null)
2. `last_status_at` DESC (most recent `task_moved` activity_log row; falls back to `created_at` if never moved)
3. `created_at` DESC

---

## File Structure

**New files**

| Path | Purpose |
|------|---------|
| `src/lib/board-filters.ts` | Pure helpers: `BoardServerFilters` type, `parseBoardFiltersFromSearchParams`, `serializeBoardFiltersToQuery`. Single source of truth for filter param names. |
| `src/app/api/projects/[id]/columns/[cid]/tasks/route.ts` | `GET` returning `{ tasks, hasMore }` for one column with offset/limit + filters. |
| `src/hooks/use-column-load-more.ts` | Client hook wrapping `IntersectionObserver` + `loadMoreForColumn` store call. |

**Modified files**

| Path | What changes |
|------|--------------|
| `src/lib/task-data.ts` | Add `last_status_at` to `Task` type; add `last_move` LATERAL join to existing `getProjectTasks`. New: `getProjectColumnsTasksPaged`, `getColumnTasksPage`, `buildTaskFilterClauses` helper. |
| `src/lib/task-actions.ts` | `moveTaskAction(taskId, columnId, position?: number \| null)` — `null` means "append at end, server computes position". |
| `src/lib/stores/board-store.ts` | New state: `columnCounts`, `columnLoadedCount`, `columnHasMore`, `columnLoading`, `paginationVersion`. New actions: `initBoardPaged`, `loadMoreForColumn`, `adjustColumnCount`, `resetPagination`, `refreshBoard`. Rewrite `sortTasksForColumn` for the new universal rule. |
| `src/components/tasks/board-column.tsx` | Badge reads `columnCounts[column.id]`. Sentinel + spinner under the last card. Empty state stays. |
| `src/components/tasks/board-view.tsx` | Replace tasks-prop wiring with `buckets`. DnD counts. Drop at end uses `position: null`. |
| `src/components/tasks/board-store-initializer.tsx` | Accept paged `buckets` instead of flat tasks. |
| `src/app/(dashboard)/tasks/page.tsx` | Read filters from `searchParams`. Call `getProjectColumnsTasksPaged`. Pass `buckets` down. |
| `src/app/(agent)/my-tasks/page.tsx` | Same as admin page, scoped: counts/tasks must respect agent membership + assignment-or-unassigned-on-current-board rule (mirrors today's `getAgentTasksAcrossBoards` predicate). |
| `src/components/tasks/board-filter-bar.tsx` | When filters change, also call `store.resetPagination()` (router push triggers server refetch — store needs a sync hook so optimistic state clears). |

**No-touch:** `task-card.tsx`, `task-detail-modal.tsx`, `task-create-modal.tsx`, dashboard funnel/KPI queries, n8n webhook route. The "Card Agent" and "Dashboard Agent" boundaries hold.

---

## Constants

```ts
// src/lib/board-filters.ts
export const INITIAL_PER_COLUMN = 5;
export const PAGE_SIZE = 10;
```

---

## Task 1 — Add `last_status_at` to Task data + new sort

**Files:**
- Modify: `src/lib/task-data.ts` (Task interface ~line 51; `getProjectTasks` ~lines 723–823)
- Modify: `src/lib/stores/board-store.ts` (`sortTasksForColumn` ~lines 14–26)

- [ ] **Step 1: Extend `Task` interface**

In `src/lib/task-data.ts`, add field to the `Task` interface (after `prev_column_name`):

```ts
  prev_column_name?: string | null;
  /** Most recent task_moved activity_log timestamp; falls back to created_at when no moves recorded. */
  last_status_at?: string | null;
```

- [ ] **Step 2: Update `getProjectTasks` query**

In the `LEFT JOIN LATERAL (...) prev_move ON true` block of `getProjectTasks`, replace it with a unified `last_move` LATERAL that returns both fields:

```sql
    LEFT JOIN LATERAL (
      SELECT created_at AS last_status_at, old_value AS prev_column_name
      FROM activity_log
      WHERE task_id = t.id AND action_type = 'task_moved' AND field = 'column'
      ORDER BY created_at DESC
      LIMIT 1
    ) last_move ON true
```

And in the `SELECT` list, replace `prev_move.old_value AS prev_column_name` with:

```sql
      last_move.prev_column_name,
      last_move.last_status_at,
```

- [ ] **Step 3: Rewrite `sortTasksForColumn`**

Replace the entire `sortTasksForColumn` function in `src/lib/stores/board-store.ts` with:

```ts
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Universal sort:
 *   1. Priority (urgent → high → medium → low → null)
 *   2. last_status_at DESC  (most recent column move; falls back to created_at)
 *   3. created_at DESC
 */
export function sortTasksForColumn(tasks: Task[], _columnName?: string | undefined): Task[] {
  const lastStatus = (t: Task) =>
    new Date((t.last_status_at ?? t.created_at) as string).getTime();
  const created = (t: Task) => new Date(t.created_at).getTime();

  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? ""] ?? 99;
    const pb = PRIORITY_RANK[b.priority ?? ""] ?? 99;
    if (pa !== pb) return pa - pb;
    const la = lastStatus(a);
    const lb = lastStatus(b);
    if (la !== lb) return lb - la;
    return created(b) - created(a);
  });
}
```

The unused `_columnName` parameter stays in the signature so existing call sites compile unchanged. The Todo-special-case is intentionally removed; for typical Todo tasks `last_status_at = created_at` so behavior is preserved.

- [ ] **Step 4: Manual smoke**

Run `npm run dev`, open `/tasks`. Confirm cards still render and order is sensible (urgent at top, then by recent move, then by creation). No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-data.ts src/lib/stores/board-store.ts
git commit -m "feat(tasks): expose last_status_at and re-sort by priority → last move → created"
```

---

## Task 2 — Server filter helper

**Files:**
- Create: `src/lib/board-filters.ts`

- [ ] **Step 1: Write the helper module**

```ts
// src/lib/board-filters.ts
import type { ReadonlyURLSearchParams } from "next/navigation";

export const INITIAL_PER_COLUMN = 5;
export const PAGE_SIZE = 10;

export interface BoardServerFilters {
  search?: string;
  priority?: "urgent" | "high" | "medium" | "low";
  assigneeId?: string;
  tagId?: string;
  /** When set, only this column's bucket is populated (used by single-column queries). */
  columnId?: string;
}

type SearchParamsLike =
  | URLSearchParams
  | ReadonlyURLSearchParams
  | Record<string, string | string[] | undefined>;

function get(sp: SearchParamsLike, key: string): string | undefined {
  if (sp instanceof URLSearchParams || (typeof (sp as URLSearchParams).get === "function")) {
    const v = (sp as URLSearchParams).get(key);
    return v ?? undefined;
  }
  const raw = (sp as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

export function parseBoardFiltersFromSearchParams(sp: SearchParamsLike): BoardServerFilters {
  const priority = get(sp, "priority");
  return {
    search: get(sp, "search") || undefined,
    priority: priority === "urgent" || priority === "high" || priority === "medium" || priority === "low"
      ? priority
      : undefined,
    assigneeId: get(sp, "assignee") || undefined,
    tagId: get(sp, "tag") || undefined,
    columnId: get(sp, "column") || undefined,
  };
}

export function serializeBoardFiltersToQuery(f: BoardServerFilters): string {
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.priority) params.set("priority", f.priority);
  if (f.assigneeId) params.set("assignee", f.assigneeId);
  if (f.tagId) params.set("tag", f.tagId);
  if (f.columnId) params.set("column", f.columnId);
  return params.toString();
}
```

- [ ] **Step 2: Smoke**

```bash
npx tsc --noEmit
```

Expected: no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/board-filters.ts
git commit -m "feat(tasks): add BoardServerFilters helper module"
```

---

## Task 3 — Server-side paginated queries

**Files:**
- Modify: `src/lib/task-data.ts` (add new functions near `getProjectTasks`)

- [ ] **Step 1: Add the per-column paged fetch**

Append (just after `getProjectTasks` ends) in `src/lib/task-data.ts`:

```ts
import type { BoardServerFilters } from "@/lib/board-filters";

interface ColumnBucket {
  tasks: Task[];
  totalCount: number;
  hasMore: boolean;
}

export interface PaginatedColumnsResult {
  buckets: Record<string, ColumnBucket>;
}

/**
 * Returns counts + first N filtered tasks per column for one project, in a single
 * pass using PARTITION BY. Counts always reflect filters; tasks reflect filters AND
 * the per-column slice.
 */
export async function getProjectColumnsTasksPaged(
  projectId: string,
  filters: BoardServerFilters,
  initialLimit: number,
  options?: { agentId?: string | null; agentScopeOnCurrentBoard?: boolean }
): Promise<PaginatedColumnsResult> {
  const search = filters.search ?? null;
  const priority = filters.priority ?? null;
  const assigneeId = filters.assigneeId ?? null;
  const tagId = filters.tagId ?? null;
  const columnId = filters.columnId ?? null;
  const agentScopeId = options?.agentScopeOnCurrentBoard ? options.agentId ?? null : null;

  // Counts query — applies all filters, groups by column.
  const countsResult = await sql`
    SELECT t.column_id, COUNT(*)::int AS total_count
    FROM tasks t
    WHERE t.project_id = ${projectId}
      AND (${columnId}::uuid IS NULL OR t.column_id = ${columnId}::uuid)
      AND (${priority}::text IS NULL OR t.priority = ${priority}::text)
      AND (${search}::text IS NULL OR t.title ILIKE '%' || ${search}::text || '%')
      AND (${assigneeId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${assigneeId}::uuid
      ))
      AND (${tagId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_tag_map ttm WHERE ttm.task_id = t.id AND ttm.tag_id = ${tagId}::uuid
      ))
      AND (
        ${agentScopeId}::uuid IS NULL
        OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${agentScopeId}::uuid)
        OR NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
      )
    GROUP BY t.column_id
  `;

  // Paged tasks query — same filters, ROW_NUMBER PARTITION BY column ordered by the
  // universal sort, sliced to first N.
  const pageResult = await sql`
    WITH filtered AS (
      SELECT
        t.*,
        c.name AS column_name,
        a.name AS creator_name,
        last_move.last_status_at,
        last_move.prev_column_name,
        COALESCE(cl_stats.total, 0)::int AS checklist_total,
        COALESCE(cl_stats.done, 0)::int AS checklist_done,
        COALESCE(cmt_stats.count, 0)::int AS comment_count,
        COALESCE(att_stats.count, 0)::int AS attachment_count,
        ROW_NUMBER() OVER (
          PARTITION BY t.column_id
          ORDER BY
            CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
            COALESCE(last_move.last_status_at, t.created_at) DESC,
            t.created_at DESC
        ) AS rn
      FROM tasks t
      LEFT JOIN columns c ON c.id = t.column_id
      LEFT JOIN agents a ON a.id = t.creator_id
      LEFT JOIN LATERAL (
        SELECT created_at AS last_status_at, old_value AS prev_column_name
        FROM activity_log
        WHERE task_id = t.id AND action_type = 'task_moved' AND field = 'column'
        ORDER BY created_at DESC
        LIMIT 1
      ) last_move ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE is_checked)::int AS done
        FROM checklist_items WHERE task_id = t.id
      ) cl_stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS count FROM comments WHERE task_id = t.id AND deleted_at IS NULL
      ) cmt_stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS count FROM file_attachments WHERE task_id = t.id
      ) att_stats ON true
      WHERE t.project_id = ${projectId}
        AND (${columnId}::uuid IS NULL OR t.column_id = ${columnId}::uuid)
        AND (${priority}::text IS NULL OR t.priority = ${priority}::text)
        AND (${search}::text IS NULL OR t.title ILIKE '%' || ${search}::text || '%')
        AND (${assigneeId}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${assigneeId}::uuid
        ))
        AND (${tagId}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM task_tag_map ttm WHERE ttm.task_id = t.id AND ttm.tag_id = ${tagId}::uuid
        ))
        AND (
          ${agentScopeId}::uuid IS NULL
          OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${agentScopeId}::uuid)
          OR NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
        )
    )
    SELECT * FROM filtered WHERE rn <= ${initialLimit}
  `;

  const tasks = pageResult.rows as Task[];

  // Hydrate assignees + tags per task (mirrors getProjectTasks pattern).
  for (const task of tasks) {
    const assignees = await sql`
      SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
      FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id
      WHERE ta.task_id = ${task.id}
    `;
    task.assignees = assignees.rows as unknown as TaskAssignee[];
    const taskTags = await sql`
      SELECT tt.id, tt.name, tt.color
      FROM task_tag_map ttm JOIN task_tags tt ON tt.id = ttm.tag_id
      WHERE ttm.task_id = ${task.id}
    `;
    task.tags = taskTags.rows as unknown as TaskTag[];
  }

  // Build buckets keyed by column_id, defaulting to empty for columns with zero matches.
  const buckets: Record<string, ColumnBucket> = {};
  for (const row of countsResult.rows) {
    const cid = row.column_id as string;
    const total = row.total_count as number;
    buckets[cid] = { tasks: [], totalCount: total, hasMore: total > initialLimit };
  }
  for (const t of tasks) {
    const cid = t.column_id;
    if (!buckets[cid]) buckets[cid] = { tasks: [], totalCount: 0, hasMore: false };
    buckets[cid].tasks.push(t);
  }

  return { buckets };
}

/**
 * Returns the next page of tasks for a single column, applying the same filters and sort.
 */
export async function getColumnTasksPage(
  projectId: string,
  columnId: string,
  filters: BoardServerFilters,
  offset: number,
  limit: number,
  options?: { agentId?: string | null; agentScopeOnCurrentBoard?: boolean }
): Promise<{ tasks: Task[]; hasMore: boolean }> {
  const search = filters.search ?? null;
  const priority = filters.priority ?? null;
  const assigneeId = filters.assigneeId ?? null;
  const tagId = filters.tagId ?? null;
  const agentScopeId = options?.agentScopeOnCurrentBoard ? options.agentId ?? null : null;

  const result = await sql`
    SELECT
      t.*,
      c.name AS column_name,
      a.name AS creator_name,
      last_move.last_status_at,
      last_move.prev_column_name,
      COALESCE(cl_stats.total, 0)::int AS checklist_total,
      COALESCE(cl_stats.done, 0)::int AS checklist_done,
      COALESCE(cmt_stats.count, 0)::int AS comment_count,
      COALESCE(att_stats.count, 0)::int AS attachment_count
    FROM tasks t
    LEFT JOIN columns c ON c.id = t.column_id
    LEFT JOIN agents a ON a.id = t.creator_id
    LEFT JOIN LATERAL (
      SELECT created_at AS last_status_at, old_value AS prev_column_name
      FROM activity_log
      WHERE task_id = t.id AND action_type = 'task_moved' AND field = 'column'
      ORDER BY created_at DESC
      LIMIT 1
    ) last_move ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_checked)::int AS done
      FROM checklist_items WHERE task_id = t.id
    ) cl_stats ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM comments WHERE task_id = t.id AND deleted_at IS NULL
    ) cmt_stats ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM file_attachments WHERE task_id = t.id
    ) att_stats ON true
    WHERE t.project_id = ${projectId}
      AND t.column_id = ${columnId}
      AND (${priority}::text IS NULL OR t.priority = ${priority}::text)
      AND (${search}::text IS NULL OR t.title ILIKE '%' || ${search}::text || '%')
      AND (${assigneeId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${assigneeId}::uuid
      ))
      AND (${tagId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_tag_map ttm WHERE ttm.task_id = t.id AND ttm.tag_id = ${tagId}::uuid
      ))
      AND (
        ${agentScopeId}::uuid IS NULL
        OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${agentScopeId}::uuid)
        OR NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
      )
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
      COALESCE(last_move.last_status_at, t.created_at) DESC,
      t.created_at DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `;

  const rows = result.rows as Task[];
  const hasMore = rows.length > limit;
  const tasks = hasMore ? rows.slice(0, limit) : rows;

  for (const task of tasks) {
    const assignees = await sql`
      SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
      FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id
      WHERE ta.task_id = ${task.id}
    `;
    task.assignees = assignees.rows as unknown as TaskAssignee[];
    const taskTags = await sql`
      SELECT tt.id, tt.name, tt.color
      FROM task_tag_map ttm JOIN task_tags tt ON tt.id = ttm.tag_id
      WHERE ttm.task_id = ${task.id}
    `;
    task.tags = taskTags.rows as unknown as TaskTag[];
  }

  return { tasks, hasMore };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean (or any errors are pre-existing on `src/lib/data.ts`, which is in `ignoreBuildErrors`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/task-data.ts
git commit -m "feat(tasks): add paginated per-column query (counts + first-N + load-more)"
```

---

## Task 4 — Load-more API route

**Files:**
- Create: `src/app/api/projects/[id]/columns/[cid]/tasks/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/projects/[id]/columns/[cid]/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getColumnTasksPage, isProjectMember } from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, PAGE_SIZE } from "@/lib/board-filters";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, cid: columnId } = await params;
  const agentId = session.user.agentId;

  if (agentId && !(await isProjectMember(projectId, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const filters = parseBoardFiltersFromSearchParams(sp);
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE));

  const isAdmin = session.user.role === "admin";
  const result = await getColumnTasksPage(projectId, columnId, filters, offset, limit, {
    agentId,
    agentScopeOnCurrentBoard: !isAdmin && !!agentId,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Smoke via curl after dev server start**

```bash
npm run dev
# in another shell, with a logged-in session cookie or while logged in via browser:
# Replace UUIDs with real ones from your dev DB.
curl -i 'http://localhost:3000/api/projects/<projectId>/columns/<columnId>/tasks?offset=0&limit=5'
```

Expected: `200`, JSON `{ tasks: [...], hasMore: boolean }`. (`401` if not authenticated — log in via browser, then the cookie covers curl on localhost.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/[id]/columns/[cid]/tasks/route.ts
git commit -m "feat(tasks): add column-tasks load-more endpoint"
```

---

## Task 5 — Board store: paged state + actions

**Files:**
- Modify: `src/lib/stores/board-store.ts`

- [ ] **Step 1: Add paged state to `BoardState`**

In the `BoardState` interface, after the `Filters` block, add:

```ts
  // Pagination state (per column)
  columnCounts: Record<string, number>;
  columnLoadedCount: Record<string, number>;
  columnHasMore: Record<string, boolean>;
  columnLoading: Record<string, boolean>;
  /** Bumped on filter change so in-flight load-more requests can self-cancel. */
  paginationVersion: number;

  // Paged actions
  initBoardPaged: (data: {
    columns: BoardColumn[];
    buckets: Record<string, { tasks: Task[]; totalCount: number; hasMore: boolean }>;
    members: ProjectMember[];
    projectId: string;
    customFields?: CustomFieldDefinition[];
  }) => void;
  loadMoreForColumn: (columnId: string, query: string) => Promise<void>;
  adjustColumnCount: (columnId: string, delta: number) => void;
  resetPagination: () => void;
  refreshBoard: (query: string) => Promise<void>;
```

- [ ] **Step 2: Initialize state**

In the `create<BoardState>(...)` body, after the existing primitive defaults (next to `filters: {}`), add:

```ts
  columnCounts: {},
  columnLoadedCount: {},
  columnHasMore: {},
  columnLoading: {},
  paginationVersion: 0,
```

- [ ] **Step 3: Implement `initBoardPaged`**

Add after the existing `initBoard` action:

```ts
  initBoardPaged: (data) => {
    if (get().isDragging) return;
    const tasks: Task[] = [];
    const counts: Record<string, number> = {};
    const loaded: Record<string, number> = {};
    const hasMore: Record<string, boolean> = {};
    for (const [cid, bucket] of Object.entries(data.buckets)) {
      counts[cid] = bucket.totalCount;
      loaded[cid] = bucket.tasks.length;
      hasMore[cid] = bucket.hasMore;
      tasks.push(...bucket.tasks);
    }
    // Columns absent from buckets (no tasks at all under filters) still need zero counts
    for (const col of data.columns) {
      if (!(col.id in counts)) {
        counts[col.id] = 0;
        loaded[col.id] = 0;
        hasMore[col.id] = false;
      }
    }
    set((s) => ({
      columns: data.columns,
      tasks,
      members: data.members,
      projectId: data.projectId,
      customFields: data.customFields ?? s.customFields,
      activeTaskId: null,
      previousState: null,
      columnCounts: counts,
      columnLoadedCount: loaded,
      columnHasMore: hasMore,
      columnLoading: {},
      paginationVersion: s.paginationVersion + 1,
    }));
  },
```

- [ ] **Step 4: Implement `loadMoreForColumn`**

Add:

```ts
  loadMoreForColumn: async (columnId, query) => {
    const state = get();
    if (state.columnLoading[columnId]) return;
    if (!state.columnHasMore[columnId]) return;
    if (!state.projectId) return;

    const versionAtStart = state.paginationVersion;
    set((s) => ({ columnLoading: { ...s.columnLoading, [columnId]: true } }));

    try {
      const offset = state.columnLoadedCount[columnId] ?? 0;
      const url = `/api/projects/${state.projectId}/columns/${columnId}/tasks?offset=${offset}&limit=10${
        query ? `&${query}` : ""
      }`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { tasks: Task[]; hasMore: boolean };

      // Drop the result if filters changed under us.
      if (get().paginationVersion !== versionAtStart) return;

      set((s) => {
        const existingIds = new Set(s.tasks.map((t) => t.id));
        const fresh = data.tasks.filter((t) => !existingIds.has(t.id));
        return {
          tasks: [...s.tasks, ...fresh],
          columnLoadedCount: {
            ...s.columnLoadedCount,
            [columnId]: (s.columnLoadedCount[columnId] ?? 0) + fresh.length,
          },
          columnHasMore: { ...s.columnHasMore, [columnId]: data.hasMore },
          columnLoading: { ...s.columnLoading, [columnId]: false },
        };
      });
    } catch {
      set((s) => ({ columnLoading: { ...s.columnLoading, [columnId]: false } }));
    }
  },
```

- [ ] **Step 5: Implement `adjustColumnCount`, `resetPagination`, `refreshBoard`**

Add:

```ts
  adjustColumnCount: (columnId, delta) => {
    set((s) => ({
      columnCounts: {
        ...s.columnCounts,
        [columnId]: Math.max(0, (s.columnCounts[columnId] ?? 0) + delta),
      },
      columnLoadedCount: {
        ...s.columnLoadedCount,
        [columnId]: Math.max(0, (s.columnLoadedCount[columnId] ?? 0) + delta),
      },
    }));
  },

  resetPagination: () => {
    set((s) => ({
      columnCounts: {},
      columnLoadedCount: {},
      columnHasMore: {},
      columnLoading: {},
      paginationVersion: s.paginationVersion + 1,
    }));
  },

  refreshBoard: async (query) => {
    const state = get();
    if (state.isDragging || !state.projectId) return;

    // For each column, refetch [0 .. max(INITIAL, loaded)] so scroll-loaded tail is preserved.
    const columnIds = state.columns.map((c) => c.id);
    const versionAtStart = state.paginationVersion;

    await Promise.all(
      columnIds.map(async (cid) => {
        const want = Math.max(5, state.columnLoadedCount[cid] ?? 0);
        const url = `/api/projects/${state.projectId}/columns/${cid}/tasks?offset=0&limit=${want}${
          query ? `&${query}` : ""
        }`;
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) return;
          const data = (await res.json()) as { tasks: Task[]; hasMore: boolean };
          if (get().paginationVersion !== versionAtStart) return;

          set((s) => {
            // Replace tasks for this column with the fresh slice; preserve other columns intact.
            const otherTasks = s.tasks.filter((t) => t.column_id !== cid);
            return {
              tasks: [...otherTasks, ...data.tasks],
              columnLoadedCount: { ...s.columnLoadedCount, [cid]: data.tasks.length },
              columnHasMore: { ...s.columnHasMore, [cid]: data.hasMore },
            };
          });
        } catch {
          /* swallow — next tick will retry */
        }
      })
    );

    // Refresh counts via a lightweight fetch to /api/projects/[id]/columns (existing endpoint
    // returns task_count per column). NOTE: that endpoint counts ALL tasks, not filtered. For
    // filter-aware count refresh we rely on initBoardPaged flowing through router refresh on
    // filter changes; periodic refresh keeps loaded-window data fresh which is the priority.
  },
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/board-store.ts
git commit -m "feat(tasks): paginated per-column state + load-more / refresh actions"
```

---

## Task 6 — `useColumnLoadMore` hook

**Files:**
- Create: `src/hooks/use-column-load-more.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/use-column-load-more.ts
"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import { parseBoardFiltersFromSearchParams, serializeBoardFiltersToQuery } from "@/lib/board-filters";

/**
 * Attaches an IntersectionObserver to the returned ref. When it intersects and
 * the column has more tasks to load, triggers loadMoreForColumn with the current
 * URL filters serialized into the API query.
 */
export function useColumnLoadMore(columnId: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sp = useSearchParams();
  const loadMoreForColumn = useBoardStore((s) => s.loadMoreForColumn);
  const hasMore = useBoardStore((s) => s.columnHasMore[columnId] ?? false);
  const loading = useBoardStore((s) => s.columnLoading[columnId] ?? false);

  useEffect(() => {
    if (!ref.current) return;
    if (!hasMore) return;

    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !useBoardStore.getState().columnLoading[columnId]) {
            const filters = parseBoardFiltersFromSearchParams(sp ?? new URLSearchParams());
            const query = serializeBoardFiltersToQuery(filters);
            loadMoreForColumn(columnId, query);
          }
        }
      },
      { root: null, rootMargin: "200px 0px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [columnId, hasMore, loadMoreForColumn, sp]);

  return { ref, hasMore, loading };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-column-load-more.ts
git commit -m "feat(tasks): IntersectionObserver hook for per-column load-more"
```

---

## Task 7 — Board column UI (badge + sentinel + spinner)

**Files:**
- Modify: `src/components/tasks/board-column.tsx`

- [ ] **Step 1: Import the hook + store selector**

Add imports near the top of `src/components/tasks/board-column.tsx`:

```ts
import { useBoardStore } from "@/lib/stores/board-store";
import { useColumnLoadMore } from "@/hooks/use-column-load-more";
import { Loader2 } from "lucide-react";
```

- [ ] **Step 2: Use server-truth count for the badge**

Inside the `BoardColumnComponent` function (the live, non-readOnly path), after `const { setNodeRef, isOver } = useDroppable(...)`, add:

```ts
  const totalCount = useBoardStore((s) => s.columnCounts[column.id]);
  const displayCount = totalCount ?? tasks.length;
```

Then locate the count `<span>` that currently renders `{tasks.length}{column.wip_limit != null && \`/${column.wip_limit}\`}` and change `{tasks.length}` → `{displayCount}`. Also update `isOverWip` and `isAtWip` to use `displayCount`:

```ts
  const isOverWip = column.wip_limit != null && displayCount > column.wip_limit;
  const isAtWip = column.wip_limit != null && displayCount === column.wip_limit;
```

(Replace the existing two lines that compute these from `tasks.length`.)

- [ ] **Step 3: Add the sentinel + spinner**

Inside the droppable card area, immediately after the `<SortableContext>` closing tag (i.e., after `</SortableContext>` but still inside the scrolling `<div ref={setNodeRef}...>`), insert:

```tsx
        <ColumnLoadMoreSentinel columnId={column.id} />
```

Then declare the component at the bottom of the file (below the existing `BoardColumnComponent` export):

```tsx
function ColumnLoadMoreSentinel({ columnId }: { columnId: string }) {
  const { ref, hasMore, loading } = useColumnLoadMore(columnId);
  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} className="flex items-center justify-center py-2">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <span className="text-[11px] text-muted-foreground/60">Scroll to load more</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: no new errors in `board-column.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/board-column.tsx
git commit -m "feat(tasks): column header reads server count; render load-more sentinel"
```

---

## Task 8 — Board view: paged init + DnD count adjustments + position=null

**Files:**
- Modify: `src/components/tasks/board-view.tsx`
- Modify: `src/lib/task-actions.ts`
- Modify: `src/lib/task-data.ts` (`moveTask` already supports `position?: number` — extend to accept `null`)

- [ ] **Step 1: Allow `position: null` in `moveTask`**

In `src/lib/task-data.ts` `moveTask`, change the signature and the `if (newPosition === undefined)` check to also accept `null`:

```ts
export async function moveTask(
  taskId: string,
  columnId: string,
  position?: number | null,
  actorId?: string | null
): Promise<Task | null> {
  // ...
  let newPosition = position ?? undefined;
  if (newPosition === undefined) {
    const maxPos = await sql`
      SELECT COALESCE(MAX(position), 0) AS max_pos FROM tasks WHERE column_id = ${columnId}
    `;
    newPosition = (maxPos.rows[0].max_pos as number) + 1000;
  }
  // ... rest unchanged
}
```

- [ ] **Step 2: Allow `position: null` in `moveTaskAction`**

In `src/lib/task-actions.ts`:

```ts
export async function moveTaskAction(
  taskId: string,
  columnId: string,
  position?: number | null
) {
  // body unchanged — moveTask already accepts position | null after Task 8 step 1
```

- [ ] **Step 3: Switch board-view to paged props**

Replace the `BoardViewProps` interface in `src/components/tasks/board-view.tsx`:

```ts
interface BoardViewProps {
  columns: BoardColumn[];
  buckets: Record<string, { tasks: Task[]; totalCount: number; hasMore: boolean }>;
  projectId?: string;
  members?: ProjectMember[];
  isAdmin?: boolean;
  agentId?: string | null;
  customFields?: CustomFieldDefinition[];
}
```

Update the function signature to destructure `buckets` instead of `tasks`. Replace the `useNewTaskNotifier` call's first argument with a flattened tasks list:

```ts
  const flatTasks = useMemo(
    () => Object.values(buckets).flatMap((b) => b.tasks),
    [buckets]
  );
  useNewTaskNotifier(flatTasks, { enabled: !isAdmin });
```

(Add `import { useMemo } from "react"` to the existing react import line.)

Replace the existing `store.initBoard({...})` call with:

```ts
  useEffect(() => {
    store.initBoardPaged({
      columns: serverColumns,
      buckets,
      members: members ?? [],
      projectId: projectId ?? "",
      customFields,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverColumns, buckets, members, projectId]);
```

- [ ] **Step 4: DnD — adjust counts on cross-column move**

Inside `handleDragEnd`, replace the existing position-math + try/catch block with a version that:
- passes `null` when target index is past the loaded tail AND the column has more unloaded
- adjusts `columnCounts` optimistically when columns differ
- reverts both list and counts on failure

Replace the position calculation block:

```ts
      // Calculate position for server. If we're dropping past the loaded tail of a
      // column that still has unloaded tasks, send `null` so the server appends.
      const colTasks = store.getTasksByColumn(targetColumnId).filter((t) => t.id !== task.id);
      const targetHasUnloadedTail = !!store.columnHasMore[targetColumnId];
      let newPosition: number | null;
      if (colTasks.length === 0) {
        newPosition = 1000;
      } else if (targetIndex <= 0) {
        newPosition = colTasks[0].position - 1000;
      } else if (targetIndex >= colTasks.length) {
        newPosition = targetHasUnloadedTail ? null : colTasks[colTasks.length - 1].position + 1000;
      } else {
        newPosition = Math.floor((colTasks[targetIndex - 1].position + colTasks[targetIndex].position) / 2);
      }

      const sourceColumnId = prev?.columnId ?? task.column_id;
      const crossColumn = sourceColumnId !== targetColumnId;
      if (crossColumn) {
        store.adjustColumnCount(sourceColumnId, -1);
        store.adjustColumnCount(targetColumnId, +1);
      }

      try {
        await moveTaskAction(task.id, targetColumnId, newPosition);
        store.setActiveTask(null);
        if (typeof newPosition === "number") {
          store.updateTask(task.id, { position: newPosition, column_id: targetColumnId });
        } else {
          store.updateTask(task.id, { column_id: targetColumnId });
        }
        // ... existing undo-toast block stays unchanged
      } catch {
        store.setActiveTask(null);
        store.revertMove();
        if (crossColumn) {
          store.adjustColumnCount(sourceColumnId, +1);
          store.adjustColumnCount(targetColumnId, -1);
        }
        toast.error("Failed to move task");
      }
```

- [ ] **Step 5: DnD — adjust counts on context-menu move and delete**

In `handleContextMoveTask`:

```ts
  async function handleContextMoveTask(taskId: string, columnId: string) {
    const task = store.tasks.find((t) => t.id === taskId);
    const fromColumn = task?.column_id;
    store.savePreviousState(taskId);
    store.moveTask(taskId, columnId, 0);
    if (fromColumn && fromColumn !== columnId) {
      store.adjustColumnCount(fromColumn, -1);
      store.adjustColumnCount(columnId, +1);
    }
    try {
      await moveTaskAction(taskId, columnId);
      const col = columnOrder.find((c) => c.id === columnId);
      toast.success(`Moved to ${col?.name ?? "column"}`);
    } catch {
      store.revertMove();
      if (fromColumn && fromColumn !== columnId) {
        store.adjustColumnCount(fromColumn, +1);
        store.adjustColumnCount(columnId, -1);
      }
      toast.error("Failed to move task");
    }
  }
```

In `handleContextDeleteTask`:

```ts
  async function handleContextDeleteTask(taskId: string) {
    const task = store.tasks.find((t) => t.id === taskId);
    const fromColumn = task?.column_id;
    store.removeTask(taskId);
    if (fromColumn) store.adjustColumnCount(fromColumn, -1);
    try {
      await deleteTaskAction(taskId);
      toast.success("Task deleted");
    } catch {
      if (fromColumn) store.adjustColumnCount(fromColumn, +1);
      toast.error("Failed to delete task");
    }
  }
```

- [ ] **Step 6: Update `getColumnTasks` to use the new sort signature**

`sortTasksForColumn` now ignores its second argument; existing call site still works. No change needed unless lint flags unused arg.

- [ ] **Step 7: Lint + type-check**

```bash
npm run lint
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add src/components/tasks/board-view.tsx src/lib/task-actions.ts src/lib/task-data.ts
git commit -m "feat(tasks): board view consumes paged buckets; DnD adjusts column counts"
```

---

## Task 9 — Wire admin and agent pages to paged data

**Files:**
- Modify: `src/app/(dashboard)/tasks/page.tsx`
- Modify: `src/app/(agent)/my-tasks/page.tsx`

- [ ] **Step 1: Admin page**

Replace the data-fetch block inside `BoardContent` of `src/app/(dashboard)/tasks/page.tsx`. Current body imports `getProjectTasks` and passes `tasks={tasks}` to `<BoardView>`. Change to:

```tsx
import { getProjectColumnsTasksPaged } from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, INITIAL_PER_COLUMN } from "@/lib/board-filters";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function BoardContent({ searchParams }: Props) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const agentId = session?.user?.agentId;

  // ... existing project-resolution code unchanged ...

  const params = await searchParams;
  const filters = parseBoardFiltersFromSearchParams(params);

  const [columns, paged, members, available, tags, customFields, savedViews] = await Promise.all([
    getProjectColumns(project.id),
    getProjectColumnsTasksPaged(project.id, filters, INITIAL_PER_COLUMN),
    getProjectMembers(project.id),
    isAdmin ? getAvailableAgents(project.id) : Promise.resolve([]),
    getProjectTags(project.id),
    getCustomFieldDefinitions(project.id),
    getSavedViews(project.id),
  ]);

  return (
    <>
      <BoardStoreInitializer customFields={customFields} savedViews={savedViews} />
      <BoardHeader
        project={project}
        projects={finalProjects}
        columns={columns}
        members={members}
        availableAgents={available}
        isAdmin={isAdmin}
        customFields={customFields}
      />
      <BoardFilterBar columns={columns} members={members} tags={tags} customFields={customFields} />
      <BoardView
        columns={columns}
        buckets={paged.buckets}
        projectId={project.id}
        members={members}
        isAdmin={isAdmin}
        agentId={agentId}
        customFields={customFields}
      />
    </>
  );
}
```

Update `Props` typing in `TasksPage` accordingly (already shown above).

- [ ] **Step 2: Agent page**

In `src/app/(agent)/my-tasks/page.tsx`, replace the `getAgentTasksAcrossBoards` call + the `boardTasks` filtering with a paged fetch scoped to the agent. Imports:

```ts
import { getProjectColumnsTasksPaged } from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, INITIAL_PER_COLUMN } from "@/lib/board-filters";
```

Update `Props`:

```ts
interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}
```

Replace the `Promise.all` block inside `AgentBoardContent`:

```ts
  const params = await searchParams;
  const filters = parseBoardFiltersFromSearchParams(params);

  const [paged, columns, members, customFields, agentData, tags, savedViews, allTasks] = await Promise.all([
    getProjectColumnsTasksPaged(project.id, filters, INITIAL_PER_COLUMN, {
      agentId,
      agentScopeOnCurrentBoard: true,
    }),
    getProjectColumns(project.id),
    getProjectMembers(project.id),
    getCustomFieldDefinitions(project.id),
    getAgentById(agentId),
    getProjectTags(project.id),
    getSavedViews(project.id),
    getAgentTasksAcrossBoards(agentId, project.id), // kept for cross-board count badge only
  ]);

  const totalOnBoard = Object.values(paged.buckets).reduce((sum, b) => sum + b.totalCount, 0);
  const hasMultipleBoards = projects.length > 1;
```

Update the badge text to use `totalOnBoard` instead of `boardTasks.length`, and the cross-board summary uses `allTasks.length`:

```tsx
          <Badge variant="secondary" className="text-[11px] font-normal shrink-0">
            {totalOnBoard} task{totalOnBoard !== 1 ? "s" : ""}
          </Badge>

          {hasMultipleBoards && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {allTasks.length} total across {projects.length} boards
            </span>
          )}
```

Replace `<BoardView ... tasks={boardTasks} ... />` with `<BoardView ... buckets={paged.buckets} ... />`.

- [ ] **Step 3: Smoke**

```bash
npm run dev
```

Open `/tasks` (admin) and `/my-tasks` (agent). Confirm:
- Each column header shows a count.
- Each column shows ≤ 5 cards initially.
- Scrolling near the bottom of a column triggers a spinner, then 10 more cards appear.
- The badge count does NOT change as more cards load.
- Apply a search/priority/assignee/tag filter via the filter bar — counts shrink to match filtered totals; columns still show ≤ 5 initially; load-more still works on filtered data.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/tasks/page.tsx src/app/\(agent\)/my-tasks/page.tsx
git commit -m "feat(tasks): admin + agent pages fetch paginated buckets with URL filters"
```

---

## Task 10 — Polling: replace `router.refresh()` for the board

**Files:**
- Modify: `src/app/(dashboard)/tasks/page.tsx`
- Modify: `src/app/(agent)/my-tasks/page.tsx`
- Create: `src/components/tasks/board-auto-refresh.tsx`

- [ ] **Step 1: Write the board-aware refresh component**

```tsx
// src/components/tasks/board-auto-refresh.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import { parseBoardFiltersFromSearchParams, serializeBoardFiltersToQuery } from "@/lib/board-filters";

/**
 * Polls every `interval` ms and asks the board store to refresh the loaded
 * window per column with current URL filters. Pauses while a card is being
 * dragged and (optionally) while the tab is hidden.
 */
export function BoardAutoRefresh({
  interval = 5000,
  runInBackground = true,
}: {
  interval?: number;
  runInBackground?: boolean;
}) {
  const sp = useSearchParams();
  const refreshBoard = useBoardStore((s) => s.refreshBoard);

  useEffect(() => {
    const id = setInterval(() => {
      if (!runInBackground && document.hidden) return;
      const filters = parseBoardFiltersFromSearchParams(sp ?? new URLSearchParams());
      const query = serializeBoardFiltersToQuery(filters);
      refreshBoard(query);
    }, interval);
    return () => clearInterval(id);
  }, [interval, runInBackground, sp, refreshBoard]);

  return null;
}
```

- [ ] **Step 2: Replace `<AutoRefresh interval={5000} runInBackground />` on the admin tasks page**

In `src/app/(dashboard)/tasks/page.tsx`:

```tsx
import { BoardAutoRefresh } from "@/components/tasks/board-auto-refresh";
// ...
<main className="flex-1 overflow-hidden flex flex-col">
  <BoardAutoRefresh interval={5000} runInBackground />
  <Suspense fallback={<BoardSkeleton />}>
    <BoardContent searchParams={searchParams} />
  </Suspense>
</main>
```

(Remove the existing `<AutoRefresh ... />` import and usage in this file only; other dashboards keep `AutoRefresh`.)

- [ ] **Step 3: Same swap on the agent tasks page**

In `src/app/(agent)/my-tasks/page.tsx` replace `<AutoRefresh interval={5000} runInBackground />` with `<BoardAutoRefresh interval={5000} runInBackground />`. Update the import.

- [ ] **Step 4: Smoke**

Open the board in two tabs as the same user. In tab A, drag a card. In tab B (within ~5s), confirm the card has moved without losing your scroll-loaded extras in any column.

Open n8n preview / create a new task via the API and confirm it appears in the polling tick on each tab.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/board-auto-refresh.tsx src/app/\(dashboard\)/tasks/page.tsx src/app/\(agent\)/my-tasks/page.tsx
git commit -m "feat(tasks): per-column polling refresh that preserves loaded tail"
```

---

## Task 11 — Filter-bar: reset pagination on filter change

**Files:**
- Modify: `src/components/tasks/board-filter-bar.tsx`

- [ ] **Step 1: Reset on URL change**

The filter bar already pushes URL changes. The server-rendered page will re-call `initBoardPaged` (which bumps `paginationVersion`) on the new render. As insurance against any in-flight load-more from the previous filter set landing late, ensure `loadMoreForColumn` already drops late results when `paginationVersion` mismatches (Task 5 step 4 — present). No code change needed here unless lint flags something.

- [ ] **Step 2: Manual smoke**

Open `/tasks`. Open dev tools network tab. Apply search="x". Quickly clear the search and immediately scroll a column. Verify no race produces duplicates or stale tasks (each load-more aborts cleanly when filters change).

- [ ] **Step 3: Commit if changes were made**

```bash
git diff --quiet src/components/tasks/board-filter-bar.tsx || \
  git add src/components/tasks/board-filter-bar.tsx && \
  git commit -m "feat(tasks): defensive pagination reset on filter change"
```

---

## Task 12 — End-to-end manual verification + PRD update

**Files:**
- Modify: `docs/taskboard_prd.md` (sections 8.3, 22.3, 25.1)

- [ ] **Step 1: End-to-end smoke checklist**

Run `npm run dev`. For BOTH `/tasks` (admin) and `/my-tasks` (agent), verify:

1. Initial load: each column shows the badge count (server total) and ≤ 5 cards.
2. Scroll a column with > 5 cards: spinner appears, 10 more cards load, badge unchanged.
3. Repeat scroll: another 10 cards load, until `hasMore` is false.
4. Apply each filter (search, priority, assignee, tag): badge counts shrink to filtered totals; ≤ 5 cards per column initially; load-more works on filtered data.
5. Drag a card across columns: source count drops by 1, destination count rises by 1. Refresh — counts persist on server.
6. Drag a card to the bottom of a column with unloaded tail: card lands at the very end on server (`MAX(position) + 1000`).
7. Delete a card (admin context menu): source column count drops by 1.
8. With two tabs open as the same user, drag a card in tab A; tab B's count and visible cards update within 5s, scrolled-tail tasks not lost.
9. Sort: each column shows urgent tasks first, then non-urgent ordered by most-recent move, falling back to creation date.
10. Group-by Assignee/Priority/Label still works (cards may not paginate within those virtual columns — confirmed acceptable).

- [ ] **Step 2: Update PRD §8.3**

Open `docs/taskboard_prd.md`. Replace the contents of "8.3 Sort order within a column" with:

```markdown
### 8.3 Sort order within a column

Universal sort across all columns:
1. **Priority**: urgent → high → medium → low → none
2. **Last status update** (`last_status_at`) DESC: timestamp of the most recent `task_moved` activity_log row for the task; falls back to `created_at` when the task has never moved
3. **Created at** DESC

This rule replaces the prior Todo-special-case (which was strict `created_at DESC`); under the new rule, a freshly-created Todo task has `last_status_at = created_at` so newest-first behavior is preserved for the common case.
```

- [ ] **Step 3: Update PRD §25.1 (perf)**

Append to §25.1:

```markdown
- Per-column pagination: each column initially renders 5 cards and loads 10 more on scroll. Total counts are returned independently of the visible slice, so column badges always reflect the full filtered total. Drag-and-drop adjusts counts optimistically and falls back to server-side position computation (`MAX(position) + 1000`) when dropping past a column's loaded tail. Polling refresh preserves the scroll-loaded window.
```

- [ ] **Step 4: Update PRD §22.3 (skeleton)**

Add a sentence:

```markdown
After hydration, each column shows up to 5 cards and a sentinel that loads 10 more on scroll.
```

- [ ] **Step 5: Final commit**

```bash
git add docs/taskboard_prd.md
git commit -m "docs(taskboard): document per-column pagination and new sort order"
```

---

## Self-Review

**Spec coverage:**
- Initial 5 cards / +10 on scroll → Tasks 3, 4, 5, 6, 7 (server fetch + API + store + sentinel + UI)
- Total count independent of visible cards → Task 3 (separate counts query) + Task 5 (`columnCounts`) + Task 7 (badge reads from store)
- Counts respect filters → Task 2 (filter parser) + Task 3 (filters in counts SQL) + Task 9 (page reads URL filters into both queries)
- Sort: priority → last status update → created → Task 1 (DB ORDER BY + `last_status_at` field) + Task 5 (client `sortTasksForColumn`)
- DnD intact → Task 8 (counts adjustment + position=null fallback)
- Filters/grouping intact → Task 5 (`getFilteredTasks` unchanged for existing client filters; counts now server-driven for status group)
- Polling → Task 10 (`BoardAutoRefresh` preserves loaded tail)
- Card Agent + Dashboard Agent untouched → only `task-data.ts`/`task-actions.ts` board paths modified; webhook + funnel/KPI queries (`data.ts`) untouched

**Placeholder scan:** None. Every step has runnable code or shell commands.

**Type consistency:**
- `BoardServerFilters` defined in Task 2, used identically in Tasks 3, 4, 6, 9, 10
- `getProjectColumnsTasksPaged` signature consistent across Tasks 3 and 9
- `getColumnTasksPage` signature consistent across Tasks 3 and 4
- Store actions (`initBoardPaged`, `loadMoreForColumn`, `adjustColumnCount`, `resetPagination`, `refreshBoard`) named identically across Tasks 5, 6, 7, 8, 10
- `position?: number | null` consistent in `moveTask` (Task 8 step 1), `moveTaskAction` (Task 8 step 2), and the board-view caller (Task 8 step 4)

**Known limitations (called out, not gaps):**
- Non-status grouping (assignee/priority/label) still renders over already-loaded tasks. Documented in Task 12 step 1 item 10.
- Custom-field filters remain client-only for now; the server count and load-more honor only the standard URL filters. Custom-field counts will be approximate until those filters are wired into the SQL — out of scope for this plan.
- `refreshBoard` does not re-fetch counts every tick; it refreshes the loaded windows. Filter changes go through the server component (which does refresh counts via `initBoardPaged`).
