# Plan: Task Board Notifications (In-Page Toast + Sound + OS Notifications)

> **Purpose:** Make new tasks feel instant on the Task Board by alerting agents the moment a task lands in the DB, matching ClickUp's perceived responsiveness. The actual Vollna → n8n → Contabo pipeline is already fast (~95s end-to-end); this plan targets the agent's *perception* of latency.
>
> **How to execute:** Tell the assistant "Execute `docs/plans/task-notifications.md`". The plan is self-contained and ordered.

---

## Problem statement (why we're doing this)

Agents claim new tasks take "4–5 minutes" to appear on the Task Board vs ClickUp. Measurement showed the real delay is ~95 seconds (Vollna polling 0–300s + n8n Claude ~11s + UI refresh 0–5s). The pipeline is fine — but ClickUp had **push notifications** and the Task Board currently has none. Agents don't notice tasks land until they manually look at the board.

Baseline diagnostics for reference (captured 2026-04-15 from exec 12117):

```
Upwork post → Vollna webhook:  84s   (Vollna polling, not our code)
Vollna → n8n task in DB:       11s   (Claude 8.8s + routing 2.2s)
DB → UI visible:              0–5s   (AutoRefresh every 5s)
```

**Goal:** When a task arrives, agents get an immediate visual + audible + OS-level alert without staring at the board.

---

## Scope

### In scope
- In-page toast notification ("New task: [Shayan] Build MVP...") via sonner
- Short audible beep (~0.5s) on new task arrival
- Browser Notifications API (OS-level popup) when permitted AND on HTTPS
- Permission-request banner, shown once per user
- Works on both admin (`/tasks`) and agent (`/my-tasks`) boards
- Works in filtered/grouped views
- No false positives on first page load

### Out of scope (explicitly deferred)
- Web Push API (service worker + VAPID keys) — defer unless "notifications when tab is closed" is requested
- Push notifications to mobile devices — would require PWA install or native app
- Email/SMS alerts — separate feature
- Per-user notification preferences UI (mute, quiet hours) — defer; first version is always-on when permitted
- Bulk notification throttling — unlikely to hit high task-creation rates

---

## Prerequisites & constraints

### Hard requirement: HTTPS for browser notifications
The Browser Notifications API **requires a secure context**. Contabo is currently plain HTTP (`http://157.173.110.62`), so the OS-level popup piece will NOT work until Contabo has HTTPS. The implementation must gracefully no-op on HTTP — toast + sound will still work.

**Status check before implementing:** Run `curl -I http://157.173.110.62/tasks` and confirm the protocol. If HTTPS is live, enable the OS notification path. If not, document in code that it's HTTP-gated and proceed with toast + sound only. **Do not block the whole feature on HTTPS — ship toast + sound immediately, add OS notifications when HTTPS lands.**

### Existing infra we'll reuse
- **sonner** is already a dependency (per `package.json` / CLAUDE.md). Toast UI uses `<Toaster>` which is already mounted somewhere in the layout tree — verify during step 1.
- **AutoRefresh** component polls `router.refresh()` every 5s on task pages. We piggyback on this: each refresh re-renders the server component with fresh task data, and the notifier hook compares old vs new.
- **Zustand board store** (`src/lib/stores/board-store.ts`) already holds the current task list on the client. This is the cleanest hook attachment point.

### Asset strategy
Use **Web Audio API to generate a beep in-memory**, not a bundled MP3. Reasons:
- No asset licensing / committing binary files
- Works immediately without needing a CDN fetch
- Can be created and cached once per session
- Autoplay restrictions: first beep requires a user gesture (solved by the permission banner click)

If the generated beep sounds bad in testing, fall back to a free-licensed MP3 at `public/sounds/new-task.mp3` (~10KB).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Task Board page (server component)                          │
│   └─ getProjectTasks(projectId) → fresh DB every render     │
│   └─ passes tasks[] to <BoardView>                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ <BoardView> client component                                │
│   ├─ Zustand store hydrated with tasks                      │
│   ├─ useNewTaskNotifier(tasks, { enabled: true })           │
│   │     ├─ Tracks seen task IDs in useRef<Set<string>>      │
│   │     ├─ On each render, diffs new vs seen                │
│   │     ├─ For each new ID:                                 │
│   │     │    ├─ toast.success("New task: ...")              │
│   │     │    ├─ playBeep()                                  │
│   │     │    └─ if (canNotify) new Notification(...)        │
│   │     └─ Skips diffing on first mount (baseline)          │
│   └─ <NotificationPermissionBanner />                       │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ router.refresh() every 5s
┌─────────────────────────────────────────────────────────────┐
│ <AutoRefresh interval={5000} />  (unchanged)                │
└─────────────────────────────────────────────────────────────┘
```

**Flow on new task arrival:**
1. n8n POSTs to `/api/v1/webhooks/tasks` → task row inserted → `revalidatePath('/tasks')` fires (already implemented in 2026-04-15 fix)
2. Within 5s, `AutoRefresh` triggers `router.refresh()`
3. Server component re-renders with the new task in the list
4. `BoardView` receives new props, `useNewTaskNotifier` detects the new ID
5. Toast + sound + (if permitted) OS notification fire simultaneously
6. Agent sees/hears the task

---

## Files to create

| File | Purpose |
|------|---------|
| `src/hooks/use-new-task-notifier.ts` | The main hook. Takes a task list + options; compares to previous via useRef; fires notifications for new IDs. |
| `src/components/tasks/notification-permission-banner.tsx` | One-time banner asking agents to enable OS notifications. Dismissal persisted in localStorage. Handles `Notification.requestPermission()`. Also primes Web Audio (user-gesture unlock for autoplay). |
| `src/lib/notification-sound.ts` | Small utility: lazy-initializes a single AudioContext, exposes `playBeep()`. Uses `OscillatorNode` to generate a short chime (800Hz → 1200Hz, 200ms). |

## Files to modify

| File | Change |
|------|--------|
| `src/components/tasks/board-view.tsx` | Call `useNewTaskNotifier(tasks)` near the top. Render `<NotificationPermissionBanner />` at the top of the component. |
| `src/app/(dashboard)/tasks/page.tsx` | No change needed if BoardView owns the banner. Verify pass-through. |
| `src/app/(agent)/my-tasks/page.tsx` | Same — verify the agent board also passes `tasks` prop through BoardView so the hook sees them. If `/my-tasks` uses a different component for cross-board rendering, add the hook there too. |
| `src/app/layout.tsx` or `app/(dashboard)/layout.tsx` | Verify `<Toaster>` from sonner is mounted. If not, add it. |

**Do NOT modify:**
- `/api/v1/webhooks/tasks/route.ts` — already has `revalidatePath` fix from 2026-04-15
- `auto-refresh.tsx` — leave 5s interval as-is
- `board-store.ts` Zustand setup — the hook reads from props, not the store, to keep concerns separated

---

## Step-by-step implementation

### Step 1 — Reconnaissance (before touching anything)
- [ ] Read `src/components/tasks/board-view.tsx` in full. Confirm `tasks` is a prop and there's a stable `.id` field on each task.
- [ ] Read `src/app/(dashboard)/tasks/page.tsx` and `src/app/(agent)/my-tasks/page.tsx`. Identify the exact component tree that renders tasks. Confirm both pages render `<BoardView>` or document the differences.
- [ ] Read `src/app/layout.tsx` (or the closest layout above the task pages). Confirm `<Toaster />` from sonner is rendered. If not, add it in step 2.
- [ ] Grep for `"sonner"` imports to see existing usage patterns — match the convention (e.g., `toast.success` vs `toast`).
- [ ] Grep for `"use client"` in `board-view.tsx` — confirm it's already a client component (should be, given dnd-kit).
- [ ] Verify Contabo is still HTTP: `curl -I http://157.173.110.62/tasks 2>&1 | head -5`. If HTTPS is live, update the `canNotify` check accordingly.

### Step 2 — Build `notification-sound.ts`
Create the file with a single exported `playBeep()` function:
- Lazy-init a singleton `AudioContext` (respects autoplay gestures)
- Generate a short two-tone chime: 800Hz → 1200Hz, 200ms total, gain ramp to avoid clicks
- Swallow errors silently (never throw — must not break the UI if audio is unavailable)
- Export an `unlockAudio()` function that creates a silent oscillator and stops it immediately — called from the first user gesture to prime the AudioContext

```ts
let ctx: AudioContext | null = null;
function getCtx() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { return null; }
  }
  return ctx;
}
export function unlockAudio() { /* ... */ }
export function playBeep() { /* ... */ }
```

### Step 3 — Build `use-new-task-notifier.ts`
```ts
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { playBeep, unlockAudio } from "@/lib/notification-sound";

type TaskLike = { id: string; title: string };

export function useNewTaskNotifier(tasks: TaskLike[], opts?: { enabled?: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    // First render: establish baseline, no notifications
    if (seen.current === null) {
      seen.current = new Set(tasks.map(t => t.id));
      return;
    }

    const newOnes = tasks.filter(t => !seen.current!.has(t.id));
    for (const t of newOnes) {
      toast.success("New task", { description: t.title });
      playBeep();

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification("New task", { body: t.title, tag: t.id });
        } catch { /* HTTP context or other issue — silent */ }
      }

      seen.current.add(t.id);
    }

    // Also track tasks that disappeared (moved/deleted) — prevents false re-fires
    const currentIds = new Set(tasks.map(t => t.id));
    for (const id of Array.from(seen.current)) {
      if (!currentIds.has(id)) seen.current.delete(id);
    }
  }, [tasks, enabled]);
}
```

**Critical detail:** the **first render establishes the baseline** — existing tasks don't fire notifications. Only IDs that appear in subsequent renders count as "new".

### Step 4 — Build `notification-permission-banner.tsx`
- Client component
- On mount, check `Notification.permission`:
  - `"granted"` → render nothing
  - `"denied"` → render nothing (user already declined, don't nag)
  - `"default"` → check `localStorage.getItem('notif-banner-dismissed')` — if set, render nothing
- Otherwise, render a slim banner: "Enable desktop notifications for new tasks? [Enable] [Dismiss]"
- On [Enable] click:
  - Call `Notification.requestPermission()`
  - Call `unlockAudio()` (primes AudioContext with a user gesture)
  - Hide banner after permission resolves
- On [Dismiss] click:
  - Write `localStorage.setItem('notif-banner-dismissed', '1')`
  - Also call `unlockAudio()` so in-page sound still works
  - Hide banner
- Graceful on HTTP: if `window.isSecureContext === false`, skip the banner entirely (OS notifications won't work anyway). Optionally show a subtle "Desktop notifications require HTTPS" hint in the banner that still lets them enable sound.

### Step 5 — Wire into `board-view.tsx`
- Add imports for `useNewTaskNotifier` and `NotificationPermissionBanner`
- Call `useNewTaskNotifier(tasks)` near the top of the component
- Render `<NotificationPermissionBanner />` at the top of the component's JSX (or just above the board, below the BoardHeader)
- **Test rendering order:** the banner should not push down the board layout on first paint — use a slim height (~48px) and fixed position if needed

### Step 6 — Verify `<Toaster>` is mounted
- Read the root layout. If sonner's `<Toaster richColors position="top-right" />` is absent, add it.
- If it's already present, verify position and style match the board page (top-right is standard).

### Step 7 — Local build & type check
- Run `npm run build` locally. Fix any TS errors. Do NOT commit with `typescript.ignoreBuildErrors` masking real issues in the new code.
- Run `npm run lint` if there are lint rules for hooks (eslint-plugin-react-hooks).

### Step 8 — Commit & deploy
- Single commit: `feat(tasks): notify on new task arrival (toast, sound, browser notification)`
- Push to main
- Watch the GitHub Actions pipeline (`.github/workflows/deploy-contabo.yml`) — should deploy in ~90s
- Verify Contabo is healthy after deploy: `ssh contabo 'docker compose ... ps'`

---

## Testing plan

### Manual smoke test (after Contabo deploy)
1. Open `http://157.173.110.62/tasks` in Chrome (admin login)
2. Open DevTools → Console → Network tab → filter on Fetch/XHR
3. Wait 5s → confirm a silent `router.refresh()` is firing (no visible change)
4. In a second terminal, curl a test task into the webhook:
   ```bash
   curl -X POST http://157.173.110.62/api/v1/webhooks/tasks \
     -H "Authorization: Bearer n8n-board-sync" \
     -H "Content-Type: application/json" \
     -d '{"title":"TEST notification task","custom_fields":{"_source":"n8n","_job_id":"test-'$RANDOM'","_profile_name":"Sana"}}'
   ```
5. Within 5 seconds, expect in the browser:
   - ✅ Sonner toast "New task — TEST notification task"
   - ✅ A short audible beep
   - ✅ (If HTTPS + permission granted) OS-level notification popup
6. Refresh the page manually — confirm the toast does NOT re-fire for the existing task (baseline works).
7. Create a second test task — confirm the second notification fires normally.
8. Delete the test tasks via the UI or SQL cleanup.

### Agent-view test
Repeat steps 1–7 on `http://157.173.110.62/my-tasks` logged in as an agent.

### Edge cases to verify
- [ ] Tab hidden (minimized): after creating a test task, bring the tab back → notifications should NOT backfill for missed tasks (they were added to `seen` on the next render)
- [ ] Filtered view: apply a label filter, create a task matching the filter → toast fires. Create a task NOT matching the filter → toast still fires (the underlying `tasks` array updates regardless of filter state). If this is undesirable, add a `visibleTasks` param to the hook.
- [ ] Two browser tabs open simultaneously: both should fire notifications (each has its own seen set)
- [ ] Permission denied: permission banner should not re-appear. Toast + sound still work.
- [ ] Sound blocked (autoplay policy): toast still shows, OS notification still fires. Document in README: "click Enable or Dismiss once to unlock sound."

### SQL cleanup for test tasks
```sql
DELETE FROM tasks WHERE title LIKE 'TEST notification task%';
```

---

## Rollback plan

If notifications misbehave (spam, crashes, autoplay issues):
1. **Quick rollback:** Comment out the `useNewTaskNotifier(tasks)` line in `board-view.tsx` and commit as a hotfix. Deploy pipeline is ~90s.
2. **Full rollback:** `git revert <commit-sha>` and push. All four new files are purely additive — revert is safe and has no data implications.

No DB migrations. No server-side changes beyond the already-deployed `revalidatePath`. Zero risk to ingestion pipeline.

---

## Definition of done

- [ ] `use-new-task-notifier.ts` hook created and unit-testable in isolation
- [ ] `notification-sound.ts` utility created and plays a beep on demand
- [ ] `notification-permission-banner.tsx` renders correctly, handles all 3 permission states, persists dismissal
- [ ] `board-view.tsx` calls the hook and renders the banner
- [ ] `<Toaster>` is confirmed mounted in the layout tree
- [ ] Manual smoke test passes on `/tasks` and `/my-tasks`
- [ ] Baseline test passes (first load does not fire notifications)
- [ ] Duplicate-task webhook (200 response) does not fire notifications
- [ ] Contabo build + deploy green
- [ ] `docs/cline.md` updated with a short "What was built" entry
- [ ] This plan file marked `✅ executed` at the top with the commit SHA

---

## Known gotchas to tell the executor

1. **Sonner `<Toaster>` mount location** — if it's in a server component, it won't work. Must be in a client-component layout. Check first.
2. **Autoplay policy** — the first `playBeep()` call without a prior user gesture will silently fail in Chrome/Firefox. The permission banner click counts as a gesture; so does any other click on the page. Make `playBeep()` swallow errors.
3. **`Notification` constructor on HTTP** — throws `ReferenceError` or `TypeError` in secure-context-only browsers. Wrap in try/catch and check `window.isSecureContext`.
4. **StrictMode double-render in dev** — the baseline `seen` initialization might run twice. Not a problem since the second run sees the same IDs. Just worth noting.
5. **Router cache** — the hook depends on `router.refresh()` giving a fresh task list. This works because raw SQL in `task-data.ts` doesn't use Next.js `fetch()` cache, and the 2026-04-15 `revalidatePath` fix busts the Full Route Cache on new tasks.
6. **Filtered views in my-tasks** — agent cross-board view uses `getAgentTasksAcrossBoards`; confirm the prop name the hook should read. May differ from admin board.
7. **Task dedup (status 200)** — the webhook returns 200 for dedup'd tasks without inserting. Those don't trigger `revalidatePath` (by design). The hook won't see them, which is correct behavior.
8. **Permissions on iframe/embed** — if the board is ever embedded, `Notification` may be blocked. Not a current concern.

---

## Future enhancements (not in this plan, park for later)

- Per-user quiet hours ("mute notifications after 8 PM PKT")
- Priority-based sound variations (urgent = different chime)
- Click-through: clicking the toast/OS notification should navigate to the task detail modal
- "Tasks assigned to me" filter for the hook — only notify when the current agent is assigned
- Badge count in favicon / document title when tab is in background
- Web Push API for notifications when tab is closed (requires service worker + VAPID)
- Mobile push via Twilio/Pushover webhook (separate project)

---

## Execution log (fill in when executed)

- [ ] Plan reviewed and approved by user
- [ ] Recon step completed (file paths confirmed)
- [ ] Code written
- [ ] Local build green
- [ ] Commit SHA: `_______________`
- [ ] Contabo deploy green
- [ ] Smoke test passed on `/tasks`
- [ ] Smoke test passed on `/my-tasks`
- [ ] Plan marked executed ✅
