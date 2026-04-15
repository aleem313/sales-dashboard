# Task Board Optimization & Scalability Plan

> **Purpose**: Scale the Task Board from hundreds of tasks to 10k+/month without WebSockets, while keeping the codebase simple. Each milestone is independently shippable — tell Claude "implement Milestone N" and it will work feature-by-feature, marking items `[x]` as they complete.
>
> **Execution rule**: Do milestones in order. Stop after M2 and re-measure — M3–M5 are only needed if the board is still slow at that point.
>
> **Status legend**: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` skipped (with reason)

---

## Baseline (fill in before starting)

- [ ] Record current metrics so gains are measurable:
  - [ ] Board page load time (cold, full board): ____ ms
  - [ ] `/tasks?board=X` server response size: ____ KB
  - [ ] DB queries per board poll (check Neon/pg logs): ____
  - [ ] Current total task count: ____
  - [ ] Current tasks per active board (max column): ____
  - [ ] Average `moveTaskAction` latency: ____ ms
  - [ ] Current `activity_log` row count: ____
  - [ ] Neon connection pool peak usage: ____ / max

## Existing indexes (verified 2026-04-15 — do NOT recreate)

From migration 006 on `tasks`:
- `idx_tasks_project_id (project_id)`
- `idx_tasks_column_position (column_id, position)`
- `idx_tasks_custom_fields GIN (custom_fields)` — already exists
- `idx_tasks_creator_id (creator_id)`
- `idx_tasks_due_date (due_date) WHERE due_date IS NOT NULL`

From migration 006 on `columns`: `idx_columns_project_position (project_id, position)`

**Next free migration number: `015`** (014 is `014_lifecycle_milestones_ext.sql`)

---

## Milestone 1 — Database Indexes & Query Hygiene

**Goal**: Eliminate full-table scans on the hot path. No app-code changes beyond SELECT lists. Highest ROI, lowest risk.

**Expected impact**: 5–20× faster board queries once tasks > 1k.

### Features

- [ ] **F1.1 — Add `archived_at` column to `tasks`**
  - Migration `015_task_board_perf.sql`
  - Nullable `TIMESTAMPTZ`; no backfill (NULL = not archived)
  - Required as the partial-index predicate below and by M4 archiving
  - Acceptance: `ALTER TABLE` applied on both envs; existing queries unaffected

- [ ] **F1.2 — Composite index `tasks(project_id, column_id, position) WHERE archived_at IS NULL`**
  - Note: `idx_tasks_column_position (column_id, position)` already exists but lacks `project_id` and archive filter
  - Name: `idx_tasks_board_hot`
  - Acceptance: `EXPLAIN ANALYZE` on `getAgentTasksAcrossBoards` and `getProjectTasks` shows Index Scan, not Seq Scan

- [ ] **F1.3 — Index `tasks(project_id, updated_at DESC) WHERE archived_at IS NULL`**
  - Powers the M2 heartbeat + delta endpoints
  - Name: `idx_tasks_project_updated`
  - Acceptance: `SELECT MAX(updated_at) FROM tasks WHERE project_id = $1 AND archived_at IS NULL` is <10ms at 100k rows

- [ ] **F1.4 — Index `tasks(title text_pattern_ops)` or trigram for search**
  - Only if board search/filter-by-title is a real code path (verify in `task-data.ts` first)
  - Prefer `pg_trgm` + `gin_trgm_ops` index for ILIKE '%x%' patterns
  - Acceptance: skip with note if unused; otherwise search query uses index

- [ ] **F1.5 — Audit SELECT lists in `task-data.ts` board path**
  - Identify every board-path query (`getProjectTasks`, `getAgentTasksAcrossBoards`, any detail query reused by the board)
  - Replace `t.*` / `SELECT *` with explicit list: id, title, priority, column_id, position, due_date, updated_at, created_at, creator_id, checklist_done, checklist_total
  - `description` and `custom_fields` only in the detail-modal query
  - Acceptance: board endpoint response size drops ≥50% at current dataset

- [ ] **F1.6 — Eliminate N+1 in `getAgentTasksAcrossBoards`**
  - Current code (lines ~610–625) loops per task to fetch `task_assignees` and `task_tag_map` → N+1 queries
  - Replace with two bulk queries: `WHERE task_id = ANY($1::uuid[])`, then group in JS
  - Apply the same fix to any other per-task loop found in the audit
  - Acceptance: `getAgentTasksAcrossBoards` executes ≤3 queries total regardless of task count

- [ ] **F1.7 — GIN on `tasks.custom_fields`**
  - **Already exists** as `idx_tasks_custom_fields` (migration 006) — mark done, do not recreate

- [ ] **F1.8 — Index on `activity_log(task_id, created_at DESC)` review**
  - Already exists as `idx_activity_log_task` — verify coverage for `getTaskActivity`
  - Add `activity_log(project_id, created_at DESC)` only if a project-level activity query exists
  - Acceptance: activity query uses index; no seq scan

- [ ] **F1.9 — Migration 015 executed in production**
  - Run via `/api/migrate?v=015&secret=...`
  - Verify `pg_indexes` on Neon (Vercel) AND Postgres 17 (Contabo)
  - Acceptance: both environments show new indexes
  - Down script `015_task_board_perf_down.sql` committed alongside

---

## Milestone 2 — Smart Polling (Delta + Heartbeat)

**Goal**: Replace the 5s full-board refetch with a cheap heartbeat + delta pattern. Single biggest runtime win.

**Expected impact**: ~95% reduction in bytes transferred and DB work per poll.

### Features

- [ ] **F2.1 — `GET /api/board/[id]/version` heartbeat endpoint**
  - Returns `{ version: <max(updated_at)>, taskCount: <int>, columnCounts: {colId: count} }`
  - Single query, indexed, <10ms target
  - Cache headers: `Cache-Control: no-store`, supports ETag
  - Acceptance: returns in <20ms at 10k tasks

- [ ] **F2.2 — `GET /api/board/[id]/changes?since=<iso>` delta endpoint**
  - Returns `{ updated: Task[], deleted: string[], version: <new max> }`
  - `updated` = tasks with `updated_at > since`
  - `deleted` = IDs from a lightweight `task_deletions` table (F2.3) or soft-delete flag
  - Acceptance: returns 0 rows when nothing changed; <50ms typical

- [ ] **F2.3 — Deletion tracking**
  - Option A (preferred): add `deleted_at` soft-delete column; board queries filter it out; delta endpoint picks up rows where `deleted_at > since`
  - Option B: `task_deletions(task_id, project_id, deleted_at)` table with a 7-day TTL cleanup
  - Pick A unless hard delete is required
  - Acceptance: deleting a task removes it from the board within one poll cycle

- [ ] **F2.4 — Client-side `useBoardPolling` hook**
  - Replaces `<AutoRefresh>` for the task board only
  - Polls `/version` every 5s
  - When `version` changes, fetches `/changes?since=lastVersion` and merges into local state
  - Merges by `task.id` into a `Map` — never appends duplicates
  - Full refetch on mount, on tab refocus after >30s hidden, or on manual user action
  - Acceptance: network tab shows mostly 200-byte heartbeat responses

- [ ] **F2.5 — ETag / 304 on heartbeat**
  - Heartbeat returns `ETag: "<version>"`
  - Client sends `If-None-Match`; server returns 304 with empty body when unchanged
  - Acceptance: steady-state polls are 304s

- [ ] **F2.6 — Adaptive poll interval**
  - 5s when tab visible and active
  - 15s when visible but no user interaction for 2min
  - Paused when hidden (already done — verify)
  - Acceptance: idle tabs stop polling entirely

- [ ] **F2.7 — Optimistic updates on move/edit**
  - `moveTaskAction` already returns updated row — apply locally before next poll reconciles
  - Acceptance: drag-drop feels instant even on slow networks

- [ ] **F2.8 — Heartbeat rate limit + connection-pool safety**
  - Rate-limit `/api/board/[id]/version` per IP+session to ≤1 req/sec (protects against runaway clients)
  - Use Neon's pooled connection string for these endpoints (not direct) so 5s polls × N users don't exhaust the pool
  - Add `export const runtime = 'nodejs'` and ensure `@vercel/postgres` is using the pooled URL
  - Acceptance: load test with 50 concurrent clients does not exceed pool limits

- [ ] **F2.9 — Scope change: leave non-task `AutoRefresh` users alone**
  - `<AutoRefresh>` is also used by `/dashboard`, `/pipeline`, `/connects`, `/my-*` pages
  - M2 changes apply to the **task board only** — other pages continue using the existing 15s `router.refresh()`
  - Acceptance: non-task pages still render on the old polling path, no regressions

---

## Milestone 3 — Denormalized Column Counts

**Goal**: Stop recomputing `COUNT(*) GROUP BY column_id` on every request. Make counts transactional so they can't drift.

**Expected impact**: Column headers render instantly regardless of dataset size.

### Features

- [ ] **F3.1 — Add `columns.task_count INT DEFAULT 0`**
  - Migration `016_column_counts.sql` (+ down script)
  - Backfill from current data on migration run (`UPDATE columns SET task_count = (SELECT COUNT(*) FROM tasks WHERE column_id = columns.id AND archived_at IS NULL)`)
  - Replaces the LEFT JOIN + GROUP BY pattern in `getProjectColumns` (task-data.ts ~line 634)
  - Acceptance: backfilled values match `SELECT COUNT(*)` exactly

- [ ] **F3.2 — Update count inside `moveTaskAction` transaction**
  - `UPDATE columns SET task_count = task_count - 1 WHERE id = <from>`
  - `UPDATE columns SET task_count = task_count + 1 WHERE id = <to>`
  - Both inside the same BEGIN/COMMIT as the task move
  - Acceptance: counts stay exact across rapid moves

- [ ] **F3.3 — Update count on task create/delete/archive**
  - Create: +1 to target column
  - Hard delete or archive: -1
  - Restore from archive: +1
  - Acceptance: all CRUD paths update the counter

- [ ] **F3.4 — n8n webhook task creation updates count**
  - `/api/v1/webhooks/tasks` is a separate path — make sure it also increments
  - Acceptance: counts correct after n8n-created tasks

- [ ] **F3.5 — Nightly reconciliation cron**
  - Job: recompute counts from scratch, log any discrepancies to `sync_log`
  - Runs once per day at off-peak
  - Acceptance: cron runs, drift alerts fire if counts diverge

- [ ] **F3.6 — Column count served by heartbeat**
  - Heartbeat endpoint returns `columnCounts` directly from `columns.task_count` (single indexed read per column)
  - Acceptance: no COUNT(*) queries in heartbeat path

- [ ] **F3.7 — "Unknown status" bucket for orphan jobs**
  - Any `jobs.status` that doesn't match an existing column name is surfaced in a synthetic bucket rather than silently dropped
  - Applies to the pipeline view, not necessarily the board itself
  - Acceptance: orphan jobs visible in UI, not lost

- [ ] **F3.8 — Audit all `getProjectColumns` / `getColumnTaskCount` / `getBoards` call sites**
  - Four COUNT(*) subqueries exist (task-data.ts lines ~324, 337, 445, 686) — all must switch to the denormalized column
  - `getBoards` returns per-project task_count — keep using COUNT(*) there OR add `projects.task_count` too (decide during impl)
  - Acceptance: no `COUNT(*) FROM tasks` in the heartbeat/board hot path

---

## Milestone 4 — Pagination, Limits & Archiving

**Goal**: Keep boards responsive when a single column holds thousands of cards. Move cold data out of the hot path.

**Expected impact**: Bounded render cost regardless of total task count.

### Features

- [ ] **F4.1 — Cap visible tasks per column at 50**
  - Server query uses `LIMIT 50 ORDER BY position ASC` (or `updated_at DESC` for done columns)
  - Acceptance: no column ever ships more than 50 cards on initial load

- [ ] **F4.2 — "Load more" pagination per column**
  - Button at column bottom: "Show 50 more (127 remaining)"
  - Uses cursor on `position` or `updated_at`, not OFFSET
  - Acceptance: can page through all tasks in a column

- [ ] **F4.3 — Distinct ordering strategies per column type**
  - Active columns (Todo, In Progress, etc.): ORDER BY `position ASC`
  - Terminal columns (Won, Lost, N/A): ORDER BY `updated_at DESC` (most recent first)
  - Priority-sorted view: secondary sort on `priority DESC`
  - Acceptance: terminal columns show newest first

- [ ] **F4.4 — Archive cron (migration 017 + route)**
  - New route `/api/cron/archive-tasks` (Bearer `CRON_SECRET`), add to `vercel.json`
  - Runs daily; sets `archived_at = NOW()` on tasks where column `is_done = true` AND `updated_at < NOW() - interval '90 days'`
  - Board queries already filter `archived_at IS NULL` (M1)
  - Must also decrement `columns.task_count` when archiving (M3 invariant)
  - Acceptance: old terminal tasks disappear from the board but remain in DB; counts stay correct

- [ ] **F4.5 — Archived task viewer (admin only)**
  - Simple page `/tasks/archive?board=<id>` showing archived tasks, read-only
  - Search/filter by date range + title
  - Acceptance: admin can find and restore archived tasks

- [ ] **F4.6 — Unarchive action**
  - `unarchiveTaskAction` clears `archived_at`, re-increments column count
  - Acceptance: restored task reappears on the board

- [ ] **F4.7 — Virtualized column rendering (conditional)**
  - Only if a single column still genuinely renders >100 cards after pagination
  - Use `@tanstack/react-virtual` for the card list inside `board-column.tsx`
  - Acceptance: skip if pagination solves the problem

- [ ] **F4.8 — Position rebalancing strategy**
  - Current code uses 1000-increment positions; after thousands of drag-drop moves, gaps shrink and collisions become likely
  - Add a per-column rebalance: when min gap between adjacent positions < 10, re-space with `position = row_number * 1000`
  - Trigger lazily inside `moveTaskAction` when a collision-prone move is detected, or as a weekly cron
  - Acceptance: no task moves ever fail due to position collision

- [ ] **F4.9 — `activity_log` retention**
  - `activity_log` gets a row per move/edit/comment — balloons at 10k tasks/month
  - Daily cron: delete rows where `created_at < NOW() - interval '180 days'` (or archive to a cold table)
  - Verify no UI depends on older activity than that
  - Acceptance: `activity_log` row count stays bounded

---

## Milestone 5 — Monitoring & Real-Time Decision Gate

**Goal**: Know when (if ever) polling stops being good enough. Don't migrate to WebSockets on vibes.

### Features

- [ ] **F5.1 — Log poll metrics**
  - On each heartbeat: log `projectId`, `userId`, response time, 200 vs 304
  - Lightweight — append to `sync_log` or a new `poll_metrics` table with TTL
  - Acceptance: daily summary query shows polls/sec per board

- [ ] **F5.2 — Slow-query alert**
  - Any board query >200ms writes a row to `alerts` + optional Slack ping
  - Acceptance: degradation gets noticed before users complain

- [ ] **F5.3 — Decision criteria doc block in this file**
  - Upgrade to real-time only when **any** are true:
    - [ ] >50 concurrent users on a single board
    - [ ] >10 heartbeat req/sec sustained on one board
    - [ ] Heartbeat p95 latency >100ms
    - [ ] Users report >5s perceived staleness as a real issue
  - Acceptance: criteria are explicit, reviewed quarterly

- [ ] **F5.4 — Real-time migration sketch (not implemented)**
  - Preferred path if needed: **Postgres `LISTEN/NOTIFY` + SSE** (not WebSockets)
    - DB trigger on `tasks` update → `NOTIFY task_changed, '<project_id>'`
    - Next.js route handler subscribes via `pg` client, streams SSE to connected browsers
    - Fallback: client auto-reconnects and falls back to polling if SSE drops
  - WebSockets only if bidirectional (e.g., presence indicators, live cursors)
  - Acceptance: design doc exists; no code until criteria hit

---

## Cross-Cutting Concerns

- [ ] **Rollout**: all migrations run on Vercel first, then Contabo
- [ ] **Rollback plan**: every migration has a documented DOWN (drop index, drop column)
- [ ] **No behaviour change user-visible** through M1–M3 — purely perf
- [ ] **Update `CLAUDE.md`** after M2 to document the new polling pattern
- [ ] **Update `docs/cline.md`** after each milestone completes

---

## Out of Scope (explicitly)

- Real-time WebSocket/SSE implementation (see M5 gate)
- ORM migration — raw SQL stays
- Full-text search on tasks (separate concern)
- Multi-tenant / multi-workspace perf (current setup is single workspace)
- Redis / external cache — `stats_cache` table + heartbeat pattern is enough

---

## Execution Instructions for Future Claude

When the user says **"implement Milestone N"**:

1. Read this file fresh
2. Work features in order (F*N*.1, F*N*.2, …)
3. Mark `[ ]` → `[~]` when starting, `[~]` → `[x]` when the acceptance criterion is verified
4. Don't skip ahead to the next milestone without confirmation
5. Commit each feature separately with message `perf(tasks): M<N> F<N.X> — <short desc>`
6. After the milestone completes, add a "Completed YYYY-MM-DD" note under the milestone heading and update `docs/cline.md`
