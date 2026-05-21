# Agent-Side Relevancy Pages — Design

**Date:** 2026-05-21
**Status:** Brainstormed, ready for implementation plan
**Scope:** Expose existing `/relevancy-audit` and `/relevancy-evaluator` pages to agent role, with full admin parity. No new routes, no schema changes, no data-layer changes.

## Problem

Two relevancy-related pages exist today and are visible only to admins:

- **`/relevancy-audit`** — lists classifier rejects in a time window, lets the viewer override wrong-rejects to feed calibration. Shipped 2026-05-12 (spec: `2026-05-12-relevancy-audit-page-design.md`).
- **`/relevancy-evaluator`** — read-only on-demand classifier run against a chosen Task Board card and profile. Used to sanity-check classifier behavior without touching the live workflow.

Agents — the people closest to the jobs being scored — currently have no visibility into either. They can see the per-card Relevancy panel on their own tasks, but cannot review the global reject stream, cannot flag wrong rejects, and cannot run the evaluator against a profile + task pair.

The admin asked to expose both pages to agents **with full admin parity** — same data, same filters, same override action, same evaluator inputs. Agents should land on the exact same React components admins do.

## Goal

After this change:

1. An agent navigating to `/relevancy-audit` or `/relevancy-evaluator` sees the identical page an admin sees, with no functional differences.
2. The agent sidebar has a new "Relevancy" section mirroring the admin sidebar, containing both items.
3. The sidebar correctly shows agent navigation for an agent who's sitting on a non-`/my-` shared route.

## Non-goals

- No role-aware rendering inside either page. (Earlier draft considered scoping audit to the agent's own profiles and hiding overrides — explicitly rejected by the admin in favor of full parity.)
- No new `/my-relevancy-*` routes — agents and admins share the same paths.
- No changes to either page component, to the override API, or to any data function.
- No schema migration. No new API endpoint.
- No changes to `<Header>` agent/profile filter behavior on these pages (both pages already pass `hideFilters`).

## Approach

Three surgical edits, in two files.

### 1. Middleware — stop redirecting agents

**File:** `src/middleware.ts`

Currently `ADMIN_ROUTES` contains:

```ts
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks", "/relevancy-audit", "/relevancy-evaluator"];
```

An agent hitting either path is redirected to `/my-dashboard`. Remove both entries:

```ts
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks"];
```

The matcher entries for `/relevancy-audit/:path*`, `/relevancy-evaluator/:path*`, and `/api/relevancy-audit/:path*` stay — auth is still enforced, only the admin-only redirect is dropped. Both agent and admin sessions can now reach the routes.

### 2. Sidebar — add the agent "Relevancy" section

**File:** `src/components/layout/sidebar.tsx`

Insert a new section in `agentNavSections`, after the existing "Tasks" section and before "Profiles", mirroring the admin layout exactly (same labels, same icons, same order):

```ts
{
  label: "Relevancy",
  items: [
    { href: "/relevancy-evaluator", label: "Relevancy Evaluator", icon: Microscope },
    { href: "/relevancy-audit", label: "Relevancy Audit", icon: ShieldCheck },
  ],
},
```

The `Microscope` and `ShieldCheck` icons are already imported (used by `adminNavSections`); no new imports needed.

Hrefs are the existing `/relevancy-audit` and `/relevancy-evaluator` paths — agents and admins share the same routes.

The `PERSISTENT_PARAMS` list (`range`, `from`, `to`, `agent`, `profile`, `tz`) is preserved across nav by the existing `buildHrefWithParams` helper. The audit page reads `range`, `from`, `to`, and `profile_ids` (not `profile`) from its own search params — the existing preservation rules are good enough; no change needed.

### 3. Sidebar — fix nav-section selection for shared routes

**File:** `src/components/layout/sidebar.tsx`

Current logic:

```ts
function useNavSections() {
  const pathname = usePathname();
  const isAgentRoute = pathname.startsWith("/my-");
  return isAgentRoute ? agentNavSections : adminNavSections;
}
```

Problem: once agents can visit `/relevancy-audit` and `/relevancy-evaluator`, those paths don't start with `/my-`, so an agent on either page sees the **admin** sidebar (Dashboard, Pipeline, Agents, Profiles, etc.) — paths the agent isn't authorized to view. Clicking any of them redirects back to `/my-dashboard` via middleware. Broken UX.

Fix: drive the selection from the user's role via `useSession()` from `next-auth/react`. The session provider already wraps the tree (`src/components/session-provider.tsx` → mounted in `src/app/layout.tsx`), so `useSession()` is callable from `Sidebar` (already a client component).

Replacement:

```ts
function useNavSections() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // While the session is loading on first paint, fall back to the URL heuristic
  // to avoid a brief flash of the admin nav for an authenticated agent. Once
  // the session resolves, role is authoritative.
  if (status === "loading") {
    return pathname.startsWith("/my-") ? agentNavSections : adminNavSections;
  }
  return session?.user?.role === "agent" ? agentNavSections : adminNavSections;
}
```

This also fixes the `homeHref` derivation in both `Sidebar` and `MobileSidebar` — they already key off `sections === agentNavSections`, so they'll point to `/my-dashboard` for agents and `/dashboard` for admins automatically.

`MobileSidebar` reuses `useNavSections`, so the same fix applies to mobile.

## Data flow

Unchanged. Both pages run their existing queries:

- `/relevancy-audit` → `listRelevancyAuditRejects({ from, to, profileIds, hideOverridden })`. No `agentId` parameter. Agents see the same global reject stream admins do.
- `/relevancy-evaluator` → `listProfilesForManualEval()`. Agents see all active profiles in the dropdown.
- Override POST/DELETE → `/api/relevancy-audit/overrides/*`. Already requires auth; will accept agent submissions identically to admin.

## Components

No component changes. `AuditFilters`, `RejectsTable`, `RejectRow`, `OverridePanel`, `EvaluatorForm` all render unchanged.

## Testing checklist

After implementation, manually verify in a browser:

1. **As admin** — sidebar still shows the existing "Relevancy" section; both pages render identically to before.
2. **As agent** — sidebar shows a new "Relevancy" section with both items.
3. **Agent navigates to `/relevancy-audit`** — page renders, sidebar stays on agent nav (not admin nav), rejects table loads with global data.
4. **Agent navigates to `/relevancy-evaluator`** — page renders, sidebar stays on agent nav, profile dropdown shows all active profiles.
5. **Agent posts an override** on a reject row — succeeds; the row updates the same way it does for an admin.
6. **Agent on mobile** — `MobileSidebar` opens with the new section visible; tap-through navigation works.
7. **Hard-refresh on `/relevancy-audit` as agent** — no flash of admin nav (the loading-state fallback uses the URL heuristic for a `/relevancy-*` path, which doesn't start with `/my-`, so the admin nav would briefly render). **Acceptance:** the flash, if visible, is sub-100ms and session resolves to agent immediately after. If perceptible in practice, escalate to "render no sections during `loading`."

## Risks

- **Sidebar loading-state flash** — addressed in the testing checklist above. The fallback heuristic during `status === "loading"` is imperfect for non-`/my-` shared routes; if it's visible in practice, swap to "render nothing while loading" rather than guess wrong.
- **Override API trust boundary** — exposing override write access to agents is intentional per the admin's instruction. The override API does not currently restrict by role; if a future requirement re-tightens this, that's a separate change on the API route, not on the page.
- **Future shared routes** — the role-based `useNavSections` future-proofs the sidebar for any other admin/agent shared route; no special-casing required.

## Files touched

| File | Change |
|------|--------|
| `src/middleware.ts` | Remove `/relevancy-audit` and `/relevancy-evaluator` from `ADMIN_ROUTES` |
| `src/components/layout/sidebar.tsx` | Add "Relevancy" section to `agentNavSections`; replace `useNavSections` with role-based variant using `useSession()` |

## CLAUDE.md write-back

Per the project's write-back rule, after implementation update `docs/claude/n8n-integration.md` and/or a relevant topic file only if a new gotcha emerges (e.g., the loading-state flash needs a real fix). If everything lands cleanly, no docs update is needed — the change is self-evident from the routes-and-roles section of CLAUDE.md.
