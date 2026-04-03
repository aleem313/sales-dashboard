# Agent Dashboard Access + Smart Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents access to Pipeline, Connects, and Analytics views (scoped to their own data), add middleware role enforcement, and add smart polling for auto-refresh across all dashboard pages.

**Architecture:** Three independent workstreams: (1) Middleware role enforcement blocks agents from admin routes, (2) New `/my-pipeline`, `/my-connects`, `/my-analytics` pages mirror admin pages but force `agentId` from session — no filter dropdowns, (3) A reusable `<AutoRefresh>` client component calls `router.refresh()` on a timer to re-run server components. Analytics data functions get `agentId` parameter added.

**Tech Stack:** Next.js 16 App Router, React 19, `@vercel/postgres` raw SQL, `useRouter().refresh()` for polling.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/auto-refresh.tsx` | Client component: polls `router.refresh()` on interval, pauses when tab hidden |
| Create | `src/app/(agent)/my-pipeline/page.tsx` | Agent pipeline page — forced agentId from session |
| Create | `src/app/(agent)/my-pipeline/loading.tsx` | Loading skeleton |
| Create | `src/app/(agent)/my-connects/page.tsx` | Agent connects page — forced agentId from session |
| Create | `src/app/(agent)/my-connects/loading.tsx` | Loading skeleton |
| Create | `src/app/(agent)/my-analytics/page.tsx` | Agent analytics page — forced agentId from session |
| Create | `src/app/(agent)/my-analytics/loading.tsx` | Loading skeleton |
| Modify | `src/middleware.ts` | Add role-based redirect: agents on admin routes → `/my-dashboard` |
| Modify | `src/lib/auth.ts` | Ensure `role` is available in middleware session |
| Modify | `src/lib/data.ts` | Add `agentId` param to `getProposalAnalytics`, `getCountryStats`, `getBestTimeToApply`, `getBudgetWinRate` |
| Modify | `src/components/layout/sidebar.tsx` | Add Pipeline, Connects, Analytics to agent nav |
| Modify | `src/app/(agent)/my-dashboard/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(agent)/my-pipeline/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(agent)/my-connects/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(agent)/my-analytics/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(agent)/my-tasks/page.tsx` | Add `<AutoRefresh interval={5000} />` |
| Modify | `src/app/(dashboard)/dashboard/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(dashboard)/pipeline/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(dashboard)/connects/page.tsx` | Add `<AutoRefresh interval={15000} />` |
| Modify | `src/app/(dashboard)/tasks/page.tsx` | Add `<AutoRefresh interval={5000} />` |

---

### Task 1: Create AutoRefresh Component

**Files:**
- Create: `src/components/auto-refresh.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/auto-refresh.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ interval = 15000 }: { interval?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) {
        router.refresh();
      }
    }, interval);

    return () => clearInterval(id);
  }, [interval, router]);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auto-refresh.tsx
git commit -m "feat: add AutoRefresh client component for smart polling"
```

---

### Task 2: Add agentId Filtering to Analytics Data Functions

**Files:**
- Modify: `src/lib/data.ts` — functions `getProposalAnalytics`, `getCountryStats`, `getBestTimeToApply`, `getBudgetWinRate`

- [ ] **Step 1: Update `getProposalAnalytics` signature and SQL**

Change from:
```typescript
export async function getProposalAnalytics(
  range?: DateRange
): Promise<ProposalAnalytics[]> {
```

To:
```typescript
export async function getProposalAnalytics(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<ProposalAnalytics[]> {
```

Add to the WHERE clause of the SQL query:
```sql
AND (${agentId ?? null}::uuid IS NULL OR j.agent_id = ${agentId ?? null}::uuid)
AND (${profileId ?? null}::text IS NULL OR j.profile_id = ${profileId ?? null}::text)
```

- [ ] **Step 2: Update `getCountryStats` the same way**

Add `agentId?: string, profileId?: string` params. Add same WHERE filters to SQL.

- [ ] **Step 3: Update `getBestTimeToApply` the same way**

Add `agentId?: string, profileId?: string` params. Add same WHERE filters to SQL.

- [ ] **Step 4: Update `getBudgetWinRate`**

Change from `(profileId?: string)` to `(profileId?: string, agentId?: string)`. Add agent filter to SQL.

- [ ] **Step 5: Update admin analytics page to pass filters**

In `src/app/(dashboard)/analytics/page.tsx`, update the data fetching calls to pass `agentId` and `profileId`:

```typescript
const [modelData, countryData, timeData, budgetData, allAgents, allProfiles] = await Promise.all([
  getProposalAnalytics(range, agentId, profileId),
  getCountryStats(range, agentId, profileId),
  getBestTimeToApply(range, agentId, profileId),
  getBudgetWinRate(profileId, agentId),
  getAllAgents(),
  getAllProfiles(),
]);
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/data.ts src/app/(dashboard)/analytics/page.tsx
git commit -m "feat: add agentId filtering to analytics data functions"
```

---

### Task 3: Middleware Role Enforcement

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add role check to redirect agents from admin routes**

```typescript
import { auth } from "@/lib/auth";

// Admin-only route prefixes — agents get redirected
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks"];

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  // Redirect agents away from admin routes
  const role = req.auth.user?.role;
  if (role === "agent") {
    const path = req.nextUrl.pathname;
    const isAdminRoute = ADMIN_ROUTES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
    if (isAdminRoute) {
      return Response.redirect(new URL("/my-dashboard", req.url));
    }
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agents/:path*",
    "/profiles/:path*",
    "/jobs/:path*",
    "/settings/:path*",
    "/pipeline/:path*",
    "/connects/:path*",
    "/alerts/:path*",
    "/api/stats/:path*",
    "/api/sync/sheets",
    "/api/jobs/:path*",
    "/api/settings/:path*",
    "/analytics/:path*",
    "/my-dashboard/:path*",
    "/my-jobs/:path*",
    "/my-performance/:path*",
    "/my-pipeline/:path*",
    "/my-connects/:path*",
    "/my-analytics/:path*",
    "/tasks/:path*",
    "/my-tasks/:path*",
    "/api/projects/:path*",
    "/api/tasks/:path*",
  ],
};
```

- [ ] **Step 2: Verify auth session includes role**

Read `src/lib/auth.ts` and confirm the session callback exposes `user.role`. The existing code should already do this via the JWT/session callbacks. If `req.auth.user.role` is not available in middleware, add it to the JWT callback.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: enforce role-based routing — agents redirected from admin routes"
```

---

### Task 4: Agent Pipeline Page

**Files:**
- Create: `src/app/(agent)/my-pipeline/page.tsx`
- Create: `src/app/(agent)/my-pipeline/loading.tsx`

- [ ] **Step 1: Create loading skeleton**

```tsx
// src/app/(agent)/my-pipeline/loading.tsx
export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto bg-background p-6">
      <div className="h-8 w-48 bg-muted animate-pulse rounded mb-6" />
      <div className="grid grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-muted animate-pulse rounded-xl" />
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```tsx
// src/app/(agent)/my-pipeline/page.tsx
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { PipelineKanban } from "@/components/pipeline/pipeline-kanban";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import { getPipelineStages, getActiveJobsInPipeline } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [stages, jobs] = await Promise.all([
    getPipelineStages(range, agentId),
    getActiveJobsInPipeline(agentId),
  ]);

  const cardBuckets: Record<string, string> = {
    "to do": "todo", "todo": "todo", "new": "todo", "proposal ready": "todo",
    "proposal submitted": "submitted", "submitted": "submitted", "sent": "submitted", "following up": "submitted",
    "prototype required": "proto", "prototype done": "proto", "prototype sent": "proto",
    "meeting scheduled": "meeting", "meeting done": "meeting",
    "negotiation": "negotiation",
  };

  const counts: Record<string, number> = { todo: 0, submitted: 0, proto: 0, meeting: 0, negotiation: 0 };
  for (const s of stages) {
    const bucket = cardBuckets[s.key.toLowerCase()];
    if (bucket) counts[bucket] += s.count;
  }

  const { todo, submitted, proto, meeting, negotiation } = counts;

  return (
    <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
      <AutoRefresh interval={15000} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">My Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">Your active proposals and their current stages.</p>
      </div>
      <Separator className="mb-5" />

      <StatRow className="mb-5">
        <StatCard label="To Do" value={todo} variant="accent" delta="Awaiting action" />
        <StatCard label="Submitted" value={submitted} delta="Awaiting response" />
        <StatCard label="Prototype" value={proto} variant="warn" delta="In progress" />
        <StatCard label="Meeting Stage" value={meeting} delta="Scheduled / done" />
        <StatCard label="Negotiation" value={negotiation} variant="green" delta="High priority" />
      </StatRow>

      <div className="mb-5">
        <PipelineKanban stages={stages} />
      </div>

      <PipelineTable jobs={jobs} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(agent)/my-pipeline/"
git commit -m "feat: add agent pipeline page (/my-pipeline) with scoped data"
```

---

### Task 5: Agent Connects Page

**Files:**
- Create: `src/app/(agent)/my-connects/page.tsx`
- Create: `src/app/(agent)/my-connects/loading.tsx`

- [ ] **Step 1: Create loading skeleton**

Same pattern as Task 4 loading — create `src/app/(agent)/my-connects/loading.tsx` with stat cards + chart placeholders.

- [ ] **Step 2: Create the page**

```tsx
// src/app/(agent)/my-connects/page.tsx
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConnectsUsageBars } from "@/components/connects/connects-usage-bars";
import { ConnectROITable } from "@/components/connects/connect-roi-table";
import { FilterQualityCard } from "@/components/connects/filter-quality";
import { getConnectsUsageByProfile, getConnectROIByNiche, getFilterQualityAnalysis } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyConnectsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [usage, roi, filterQuality] = await Promise.all([
    getConnectsUsageByProfile(range, agentId),
    getConnectROIByNiche(range, agentId),
    getFilterQualityAnalysis(range, agentId),
  ]);

  const totalUsed = usage.reduce((s, u) => s + u.connects_used, 0);
  const totalWins = roi.reduce((s, r) => s + r.wins, 0);
  const connectsPerWin = totalWins > 0 ? Math.round(totalUsed / totalWins) : 0;
  const wasted = roi.filter((r) => r.wins === 0).reduce((s, r) => s + r.connects_spent, 0);

  return (
    <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
      <AutoRefresh interval={15000} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">My Connects</h1>
        <p className="text-sm text-muted-foreground mt-1">Your connects usage, ROI, and efficiency.</p>
      </div>
      <Separator className="mb-5" />

      <StatRow className="mb-5">
        <StatCard label="Total Used" value={totalUsed} variant="accent" delta="Estimated from proposals" />
        <StatCard label="Per Win" value={connectsPerWin} delta="Connects per closed deal" />
        <StatCard label="Wasted" value={wasted} variant="danger" delta="On 0-win niches" />
        <StatCard label="Total Wins" value={totalWins} variant="green" delta="Won jobs" />
      </StatRow>

      <ConnectsUsageBars data={usage} />
      <div className="mt-5">
        <ConnectROITable data={roi} />
      </div>
      <div className="mt-5">
        <FilterQualityCard data={filterQuality} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(agent)/my-connects/"
git commit -m "feat: add agent connects page (/my-connects) with scoped data"
```

---

### Task 6: Agent Analytics Page

**Files:**
- Create: `src/app/(agent)/my-analytics/page.tsx`
- Create: `src/app/(agent)/my-analytics/loading.tsx`

- [ ] **Step 1: Create loading skeleton**

Same pattern — create `src/app/(agent)/my-analytics/loading.tsx`.

- [ ] **Step 2: Create the page**

```tsx
// src/app/(agent)/my-analytics/page.tsx
import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { ModelComparison, CountryHeatmap, TimeHeatmap, BudgetIntelligence } from "@/components/charts";
import { getProposalAnalytics, getCountryStats, getBestTimeToApply, getBudgetWinRate } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [modelData, countryData, timeData, budgetData] = await Promise.all([
    getProposalAnalytics(range, agentId),
    getCountryStats(range, agentId),
    getBestTimeToApply(range, agentId),
    getBudgetWinRate(undefined, agentId),
  ]);

  return (
    <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
      <AutoRefresh interval={15000} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">My Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Proposal models, geography, timing, and budget insights for your jobs.</p>
      </div>
      <Separator className="mb-5" />

      <div className="grid gap-6">
        <ModelComparison data={modelData} />
        <div className="grid gap-6 lg:grid-cols-2">
          <CountryHeatmap data={countryData} />
          <TimeHeatmap data={timeData} />
        </div>
        <BudgetIntelligence data={budgetData} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(agent)/my-analytics/"
git commit -m "feat: add agent analytics page (/my-analytics) with scoped data"
```

---

### Task 7: Update Agent Sidebar Navigation

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add new pages to agentNavSections**

Import the missing icons and add the new nav items:

```typescript
import {
  // ... existing imports
  Filter,      // Pipeline
  Zap,         // Connects
  TrendingUp,  // already imported
  BarChart3,   // Analytics (add import)
} from "lucide-react";
```

Update `agentNavSections`:

```typescript
const agentNavSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/my-dashboard", label: "My Dashboard", icon: Gauge },
      { href: "/my-pipeline", label: "My Pipeline", icon: Filter },
      { href: "/my-jobs", label: "My Jobs", icon: Briefcase },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/my-performance", label: "My Performance", icon: TrendingUp },
      { href: "/my-connects", label: "My Connects", icon: Zap },
      { href: "/my-analytics", label: "My Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Tasks",
    items: [
      { href: "/my-tasks", label: "My Tasks", icon: KanbanSquare },
    ],
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add pipeline, connects, analytics to agent sidebar nav"
```

---

### Task 8: Add AutoRefresh to All Dashboard Pages

**Files:**
- Modify: `src/app/(agent)/my-dashboard/page.tsx`
- Modify: `src/app/(agent)/my-tasks/page.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Modify: `src/app/(dashboard)/pipeline/page.tsx`
- Modify: `src/app/(dashboard)/connects/page.tsx`
- Modify: `src/app/(dashboard)/tasks/page.tsx`

- [ ] **Step 1: Add AutoRefresh to agent my-dashboard**

Add import at top of `src/app/(agent)/my-dashboard/page.tsx`:
```typescript
import { AutoRefresh } from "@/components/auto-refresh";
```

Add inside the returned JSX, as the first child of the outer container div:
```tsx
<AutoRefresh interval={15000} />
```

- [ ] **Step 2: Add AutoRefresh to agent my-tasks (5s interval)**

Add import and `<AutoRefresh interval={5000} />` to `src/app/(agent)/my-tasks/page.tsx`.

- [ ] **Step 3: Add AutoRefresh to admin dashboard (15s)**

Add import and `<AutoRefresh interval={15000} />` to `src/app/(dashboard)/dashboard/page.tsx`.

Note: The admin dashboard page uses `<Header>` at the top. Add `<AutoRefresh>` right after `<Header>` inside the fragment/main wrapper.

- [ ] **Step 4: Add AutoRefresh to admin pipeline (15s)**

Add import and `<AutoRefresh interval={15000} />` to `src/app/(dashboard)/pipeline/page.tsx`.

- [ ] **Step 5: Add AutoRefresh to admin connects (15s)**

Add import and `<AutoRefresh interval={15000} />` to `src/app/(dashboard)/connects/page.tsx`.

- [ ] **Step 6: Add AutoRefresh to admin tasks (5s)**

Add import and `<AutoRefresh interval={5000} />` to `src/app/(dashboard)/tasks/page.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(agent\)/my-dashboard/page.tsx src/app/\(agent\)/my-tasks/page.tsx \
  src/app/\(dashboard\)/dashboard/page.tsx src/app/\(dashboard\)/pipeline/page.tsx \
  src/app/\(dashboard\)/connects/page.tsx src/app/\(dashboard\)/tasks/page.tsx
git commit -m "feat: add smart polling auto-refresh to all dashboard and task board pages"
```

---

### Task 9: Update Middleware Matcher for New Routes

**Files:**
- Modify: `src/middleware.ts` (already updated in Task 3, but verify matcher includes new routes)

- [ ] **Step 1: Verify matcher includes new agent routes**

Ensure the matcher array in `src/middleware.ts` includes:
```typescript
"/my-pipeline/:path*",
"/my-connects/:path*",
"/my-analytics/:path*",
```

These should already be added in Task 3. Verify and add if missing.

- [ ] **Step 2: Type-check the entire project**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add src/middleware.ts
git commit -m "fix: ensure middleware matcher covers all new agent routes"
```

---

### Task 10: Final Verification & Cleanup

- [ ] **Step 1: Verify build succeeds**

```bash
npm run build
```

Expected: successful build, no errors.

- [ ] **Step 2: Update plan.md with completion status**

Mark any relevant items as done in `plan.md` if applicable.

- [ ] **Step 3: Update cline.md with new agent pages**

Add note about new agent-accessible pages and smart polling.

- [ ] **Step 4: Final commit**

```bash
git add plan.md cline.md
git commit -m "docs: update project docs with agent dashboard access and smart polling"
```
