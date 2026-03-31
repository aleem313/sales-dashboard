# Task Board — UI Component Audit

> **Audit Date:** 2026-03-31
> **Scope:** All Task Board UI components across Admin and Agent dashboards
> **Status:** Post-Milestone 1B deployment

---

## Component Inventory

| # | Component | File | Used By | Status |
|---|-----------|------|---------|--------|
| 1 | Board Header | `board-header.tsx` | Admin `/tasks` | OK |
| 2 | Board Selector | `board-selector.tsx` | Board Header | OK |
| 3 | Board Selector Wrapper | `board-selector-wrapper.tsx` | Board Header, empty state | OK |
| 4 | Board Create Dialog | `board-create-dialog.tsx` | Board Selector | OK |
| 5 | Board Members Panel | `board-members-panel.tsx` | Board Header | OK |
| 6 | Board View | `board-view.tsx` | Admin + Agent pages | OK |
| 7 | Board Column | `board-column.tsx` | Board View | OK with issues |
| 8 | Task Card | `task-card.tsx` | Board Column | OK |
| 9 | Task Create Modal | `task-create-modal.tsx` | Board Header + Column "+" | OK |
| 10 | Sidebar Nav | `sidebar.tsx` | Both layouts | OK |
| 11 | Admin Tasks Page | `(dashboard)/tasks/page.tsx` | — | OK |
| 12 | Agent Tasks Page | `(agent)/my-tasks/page.tsx` | — | OK with gaps |

---

## Issues Found

### P0 — Security / Access Control

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| SEC-1 | **Agents can access `/tasks` (admin board)** — middleware only checks auth, not role. Dashboard layout redirects agents, but `/tasks` is under `(dashboard)` route group so the redirect works. VERIFIED: dashboard layout does `if (session.user.role === "agent") redirect("/my-dashboard")` so agents ARE blocked. **NOT A BUG.** | `(dashboard)/layout.tsx:15` | None — already handled |
| SEC-2 | `board-column.tsx` accepts `isAdmin` prop but never uses it | `board-column.tsx:13` | Cosmetic — unused prop |

### P1 — Functional Gaps

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| FN-1 | **Agent can't switch boards** — `/my-tasks` always shows first assigned board; no board selector for agents | `my-tasks/page.tsx` | Agents with multiple boards can only see tasks on one |
| FN-2 | **Task create modal has no assignee picker** — can't assign agents during creation | `task-create-modal.tsx` | Must edit task after creation to assign |
| FN-3 | **No column management UI** — can't add/rename/delete/reorder columns from the board | `board-view.tsx`, `board-column.tsx` | Admin must use API directly |
| FN-4 | **No task detail view/drawer** — clicking a task card sets `?task=id` URL param but no drawer renders | `board-view.tsx:35` | Tasks can only be viewed as cards, not edited inline |
| FN-5 | **No task delete button anywhere** — delete action exists in API/server actions but no UI trigger | — | Admin must use API directly to delete tasks |
| FN-6 | **No task editing UI** — update action exists but no edit form/drawer | — | Tasks are create-only from the UI |
| FN-7 | **Board description not shown** — `createProject` stores description but it's never displayed | `board-header.tsx` | Description is invisible |
| FN-8 | **Per-column "+" creates a floating modal** — the `addToColumn` state triggers a second TaskCreateModal inside BoardView but it's not attached to DOM properly (rendered inside scroll container) | `board-view.tsx:51-57` | May cause rendering issues |

### P2 — UX Improvements Needed

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| UX-1 | **No task count in board selector for agent** — agent page header shows task count but no board selector | `my-tasks/page.tsx` | Inconsistent with admin experience |
| UX-2 | **Member avatars hidden on mobile** — `hidden sm:flex` hides avatar cluster on small screens | `board-header.tsx:108` | Members not visible on mobile |
| UX-3 | **Board create dialog doesn't clear form on re-open** — form state persists between opens | `board-create-dialog.tsx` | Stale data shown if user cancels and reopens |
| UX-4 | **No loading indicator during member operations** — `isPending` disables buttons but no spinner | `board-members-panel.tsx` | User may think nothing happened |
| UX-5 | **Confirmation for member removal uses `confirm()`** — browser native dialog instead of styled modal | `board-members-panel.tsx:81` | Inconsistent with other modals |
| UX-6 | **Board skeleton doesn't match actual layout** — skeleton in loading.tsx doesn't show board header | `tasks/loading.tsx` | Flash of different layout during load |

---

## Role Matrix — Current State

| Feature | Admin UI | Agent UI | API Enforced |
|---------|----------|----------|-------------|
| View board | Board selector + full board | First assigned board only | Yes — `isProjectMember` |
| Switch boards | Board selector dropdown | **MISSING** | N/A |
| Create board | Board selector "New Board" + empty state button | Not shown | Yes — admin only |
| Rename board | Header menu > Rename | Not shown | Yes — admin only |
| Delete board | Header menu > Delete (with confirm) | Not shown | Yes — admin only |
| View members | Avatar cluster + Members panel | **MISSING** (no panel) | Yes — any member |
| Add member | Members panel dropdown | Not shown | Yes — admin only |
| Change member role | Members panel role selector | Not shown | Yes — admin only |
| Remove member | Members panel X button | Not shown | Yes — admin only |
| Create task | Header "New Task" + column "+" button | Header "New Task" + column "+" | Yes — any member |
| Edit task | **MISSING** | **MISSING** | Yes — any member |
| Delete task | **MISSING** | Not applicable | Yes — admin only |
| View task detail | **MISSING** (URL param set but no drawer) | **MISSING** | Yes — any member |
| Manage columns | **MISSING** | Not applicable | Yes — admin only |
| Filter tasks | **MISSING** | **MISSING** | Yes — query params work |
| Search tasks | **MISSING** | **MISSING** | Yes — `search` filter works |

---

## What's Working Well

1. **Board CRUD flow** — Create board dialog > auto-creates columns > redirects to new board
2. **Board selector** — Dropdown with task counts, "New Board" option, URL-based switching, localStorage persistence
3. **Members panel** — Slide-out sheet with add/remove/role-change; guards last-admin and workspace-owner removal
4. **Delete board confirmation** — Type board name to confirm when tasks exist; shows task count warning
5. **Task cards** — Priority badges, assignee avatars, due date warnings, tag chips, checklist progress
6. **Per-column task creation** — "+" on column header and "Add a task" in empty columns
7. **Skeleton loaders** — Both page-level and Suspense-boundary loaders
8. **Role-based sidebar** — `/my-*` routes get agent nav, others get admin nav
9. **Empty states** — Different messaging for admin ("Create board") vs agent ("Contact admin")

---

## Recommended Fixes by Priority

### Must Fix (before Milestone 2) — ALL RESOLVED 2026-03-31
- **FN-1**: ~~Add board selector for agents on `/my-tasks`~~ FIXED
- **FN-2**: ~~Assignee picker in task create form~~ FIXED
- **FN-8**: ~~Fix per-column task creation modal placement~~ FIXED
- **SEC-2**: ~~Remove unused `isAdmin` prop from `board-column.tsx`~~ FIXED
- **UX-3**: ~~Clear form state on dialog open~~ FIXED
- **UX-5**: ~~Replace `confirm()` with styled confirmation dialog~~ FIXED
- **UX-6**: ~~Update `loading.tsx` to match actual board header layout~~ FIXED

### Should Fix (during Milestone 2)
- **FN-4**: Task detail drawer (planned in M2.4)
- **FN-5**: Task delete button in drawer/context menu (planned in M2)
- **FN-6**: Task editing UI (planned in M2.5)
- **FN-3**: Column management UI (planned in M4.9)

### Nice to Have (Milestone 3+)
- **FN-7**: Show board description in board header or settings
