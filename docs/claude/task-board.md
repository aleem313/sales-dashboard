# Task Management (Task Board)

## API Routes (Milestone 1)

| Method | Endpoint | Access |
|--------|----------|--------|
| GET/POST | `/api/projects/[id]/tasks` | Agent+ |
| GET/PATCH/DELETE | `/api/tasks/[id]` | Agent+ / Admin |
| PATCH | `/api/tasks/[id]/move` | Agent+ |
| GET/POST | `/api/tasks/[id]/comments` | Agent+ |
| PATCH/DELETE | `/api/tasks/[id]/comments/[cid]` | Author (60min) / Admin |
| GET | `/api/tasks/[id]/activity` | Agent+ |
| GET/POST | `/api/projects/[id]/columns` | Agent+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/columns/[cid]` | Admin |
| PATCH | `/api/projects/[id]/columns/reorder` | Admin |
| POST | `/api/v1/webhooks/tasks` | API Key (Bearer) |
| GET/POST | `/api/projects/[id]/custom-fields` | Member+ / Admin |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| PATCH | `/api/projects/[id]/custom-fields/reorder` | Admin |
| GET/POST | `/api/projects/[id]/saved-views` | Member+ / Admin |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Admin |
| GET | `/api/migrate` | CRON_SECRET |
| PUT | `/api/agents/[id]/assign-profiles` | Admin |
| GET/POST | `/api/profiles/[id]/upwork-snapshot` | GET: Admin or owner-agent / POST: Admin |

## Task Management Key Files

| File | What it does |
|------|-------------|
| `src/lib/task-data.ts` | All task management queries. `getDefaultProject()` auto-creates workspace/project/columns if seed was skipped. Board CRUD, member management, cross-board queries. |
| `src/lib/task-actions.ts` | Server actions: task CRUD, board CRUD, member management + revalidatePath |
| `src/components/tasks/board-header.tsx` | Board toolbar: selector, member avatars, members panel, new task button, rename/delete menu (admin) |
| `src/components/tasks/board-view.tsx` | Horizontal scrolling kanban board; groups tasks by column; per-column "+" button |
| `src/components/tasks/board-column.tsx` | Column with header (color dot, name, WIP count), task cards, empty state |
| `src/components/tasks/task-card.tsx` | Task card: priority badge, assignee avatars, due date, tags, checklist %, counts |
| `src/components/tasks/task-detail-modal.tsx` | Dialog overlay for task detail view — opens on card click instead of navigating |
| `src/components/tasks/task-create-modal.tsx` | Task creation form (title, column, priority, due date, description); supports external trigger from column "+" |
| `src/components/tasks/board-selector.tsx` | Board dropdown with task counts + "New Board" (admin) |
| `src/components/tasks/board-create-dialog.tsx` | Create board dialog (name + description) |
| `src/components/tasks/board-members-panel.tsx` | Slide-out sheet: member list, add/remove/role-change |
| `src/components/tasks/custom-field-renderer.tsx` | Type-specific renderers for 6 field types + compact card display |
| `src/components/tasks/custom-fields-panel.tsx` | Admin slide-out sheet for field CRUD, archive/restore, reorder |
| `src/components/tasks/group-selector.tsx` | Group-by dropdown (status/assignee/priority/label) |
| `src/components/tasks/views-dropdown.tsx` | Saved views popover: load, save, delete |
| `src/components/tasks/custom-field-filter.tsx` | "More Filters" section for custom field conditions |
| `src/app/(dashboard)/tasks/page.tsx` | Admin board page — loads board by `?board=` param, falls back to first/default |
| `src/app/(agent)/my-tasks/page.tsx` | Agent board page — shows first assigned board + cross-board task summary |

## Known Patterns & Gotchas

- **Admin auth**: Admins log in via `ADMIN_CREDENTIALS` env var — they do NOT have a row in `agents` table. Code that queries `agents WHERE role = 'admin'` may find nothing.
- **Agent sidebar detection**: `useNavSections()` uses `pathname.startsWith("/my-")` to show agent nav. All agent routes MUST start with `/my-`.
- **Agent layout**: `(agent)/layout.tsx` renders `<Sidebar>` only. Each agent page includes `<Header title="..." hideFilters />` individually — this shows the top navbar (date picker, theme toggle, user info) without agent/profile filter dropdowns.
- **Auto-seed**: `getDefaultProject()` auto-creates default workspace + project + columns on first access if tables exist but are empty.
- **Board switching**: Admin uses `?board=<id>` URL param + localStorage; agent currently sees only first assigned board (FN-1 audit item).
- **Task creation**: Modal supports external trigger via `triggerOpen` prop + `defaultColumnId` for per-column "+" buttons.
- **Task detail**: Card click opens a modal overlay (`TaskDetailModal`) instead of navigating to `/tasks/[id]`. Direct URL `/tasks/[id]` redirects to `/tasks?task=[id]` which auto-opens the modal.
- **Task create**: "New Task" and column "+" open a full-width create modal with all fields (same layout as detail view).
- **Webhook auto-assignment**: When `_source === "n8n"`, the webhook auto-assigns agent (by name lookup), sets 24h due date, and creates profile + `vollna-auto` tags.
- **Structured fields**: Both create and detail views show editable Job Snapshot (link, budget, skills, posted), Client Intel (location, rating, spent, hires), Routing Info (agent, profile, stack, job ID, generated), and Proposal — all stored in `custom_fields`.
- **Agent header**: All agent pages use `<Header title="..." hideFilters />` — shows date picker, theme toggle, user info, logout. No agent/profile filter dropdowns since data is session-scoped.
- **Member removal**: Uses browser `confirm()` instead of styled dialog (UX-5 audit item); auto-unassigns from tasks.
- **Job-Task status sync**: When a task moves columns → `moveTaskAction()` → `syncJobStatusFromTask()` → updates `jobs.status` to column name. This is the ONLY way job statuses change now.
- **`jobs.status`**: Renamed from `clickup_status` (migration 012). Same values, same queries. Historical data preserved.
- **Legacy ClickUp columns**: `clickup_task_id`, `clickup_task_url` still exist as nullable columns for historical data. Never write to them for new jobs.
- **Connects canonical storage**: `tasks.custom_fields._connects_used` (base spend) and `tasks.custom_fields._boosted_connects` (separate boost amount). Set on every card type — n8n and manual — by the same UI inputs in `task-create-full.tsx`, `task-full-view.tsx`, and `task-detail-drawer.tsx`. `jobs.connects_used` from migration 004 is unused — never read or write. All three connects queries in `data.ts` (`getConnectsUsageByProfile`, `getBoostedConnectsSummary`, `getConnectROIByNiche`) are task-driven, LEFT JOIN to jobs, and date-gated by `COALESCE(j.stage_entered_at, t.created_at)`. `_boosted_connects` is **not** added into the base "Total Used" total — it's surfaced as its own KPI tile from `getBoostedConnectsSummary.totalBoosted`. Manual cards with no `_job_id` and no profile-name task tag aren't attributable to a profile/niche, so they're excluded from `getConnectsUsageByProfile` and aggregated under `'Unspecified'` in `getConnectROIByNiche`; their connects still contribute to `getBoostedConnectsSummary.totalConnectsUsed`.
- **Connects purchase ledger** (migration 016): per-profile budget on the `/connects` and `/my-connects` bars now comes from `SUM(connects_purchases.connects_count)` for that profile, date-bounded by the same range as usage. Entered via `<ConnectsPurchaseForm>` (`src/components/connects/connects-purchase-form.tsx`) on both pages. Auth: agents can ADD only to their own profiles (server-side check in `addConnectsPurchaseAction` against `profiles.agent_id = session.user.agentId`); **only admins can DELETE** any row (`deleteConnectsPurchaseAction` rejects non-admin). Agents have no delete UI. `profiles.connects_budget` is **legacy/unused** post-migration 016 — never read, never written; keep it on the table only so rollback is possible. The hardcoded `150` fallback in `getConnectsUsageByProfile` is gone — a profile with usage but no logged purchases now shows `X used / 0 total` (visible flag that someone forgot to log a purchase). The "Connects Purchased" and "Spend ($)" StatCards on both pages read from `getConnectsBudgetSummary`.
- **Card N/A reason labels now have ONE source: `src/lib/relevancy-reasons.ts`** (`RELEVANCY_REASON_OPTIONS`, 17 labels). As of 2026-06-02 the two former hardcoded `REASON_OPTIONS` arrays (`task-full-view.tsx` card editor, `custom-field-filter.tsx` board filter) both import from it, and a **third** consumer was added — the AI Relevancy feedback checklist (`relevancy-feedback-form.tsx`), which writes these EXACT strings back into `_reason`, so spelling must match the field verbatim. These are still NOT auto-derived from `criteria_versions.reason_enum`/classifier. **KEEP IN SYNC MANUALLY** when you add/rename a reason — edit all 4 sources: (1) migration SQL, (2) `docs/job_relevancy_criteria_prd.md` §6.2 + Appendix C, (3) `docs/relevancy/mode_a_prompt.md` enum + both AI Agent system messages in n8n sub-workflow `hi71jhPU8tmq7hEp`, (4) the single `RELEVANCY_REASON_OPTIONS` const in `src/lib/relevancy-reasons.ts` (no longer two component arrays). Last sync: 2026-05-12 commit `34d3ae9`; consolidated to shared module 2026-06-02.
- **AI Relevancy feedback → card `_reason` mirror** (2026-06-02): when the classifier APPROVED a job (proceed/review verdict — `verdict !== "reject"`), the feedback form runs in "assert mode" and shows the fixed `RELEVANCY_REASON_OPTIONS` checklist ("what's wrong with this wrongly-approved job?"). On save the API (`/api/tasks/[id]/relevancy-feedback` POST, `assert: true`) calls `mirrorReasonsToCard()` in `data.ts` — a MERGE-only union into `tasks.custom_fields._reason` (never wipes; drops the `__decision__` sentinel + non-canonical values; best-effort, never blocks the feedback save). For a REJECT verdict the form stays in dispute mode (tick which of the AI's OWN reasons are wrong) and `assert` is never set, so those ticks must NOT mirror. The card is NOT auto-moved to N/A — reasons are only stamped (agent drags the card themselves).
- **Upwork profile snapshots** (migration 017): rich freelancer-profile JSON (output of `docs/profiles/extract-profile.js`) lives in `upwork_profile_snapshots`, **append-only**. The latest row per `profile_id` has `is_current = TRUE`; older rows are preserved with `is_current = FALSE` so historical evaluation work (classifier calibration, retrospective scoring) can query past profile state. **Default read path is the `upwork_profile_snapshots_current` view** — it filters to `is_current = TRUE` so day-to-day queries feel like a single-snapshot table. The view is what `getUpworkProfileSnapshot(profileId)` reads; `getUpworkProfileSnapshotHistory(profileId, limit)` reads the base table. Write path is the data-layer function `saveUpworkProfileSnapshot(profileId, json)` (in `src/lib/data.ts`) — a single CTE-INSERT statement that demotes the previous current row and inserts the new one atomically. The partial unique index `uq_upwork_snapshot_current_per_profile` enforces the "exactly one current row per profile" invariant at the DB level. The server action `saveUpworkProfileSnapshotAction` wraps it with admin/agent auth (admin can save any profile; agent can save only their own assigned profiles). Auth split: GET API readable by admin OR profile-owner agent; POST API admin-only. UI: `<ProfileUpworkSnapshotSheet>` drawer mounted in the Settings profile table — Current/History/Upload tabs, Upload tab visible to admin only. CLI: `node --import tsx scripts/import-upwork-profile.ts --profile-id <slug> --json <path>` for bulk imports (skips the auth wrapper, calls the data-layer function directly). `skills_summary` is a real TEXT column populated on insert (`json.skills.map(s => s.name).join(", ")`) — `pg_trgm` GIN index supports `ILIKE '%Laravel%'` queries; `data->'skills'` GIN index supports structural matches like `data->'skills' @> '[{"name":"Laravel"}]'::jsonb`. Both indexes are partial (`WHERE is_current = TRUE`) so historical rows don't bloat them.
