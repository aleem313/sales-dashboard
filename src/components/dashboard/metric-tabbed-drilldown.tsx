"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MetricTaskList } from "@/components/dashboard/metric-task-list";
import type { KPIMetricKey, KPIMetricTaskRow } from "@/lib/data";

interface DashboardSearchParams {
  range?: string;
  from?: string;
  to?: string;
  tz?: string;
}

interface MetricTabbedDrillDownProps {
  metric: KPIMetricKey;
  label: string; // e.g. "Applied", "Proposals", "Won"
  count: number;
  // Exactly one scope is set: the agent (Leaderboard) or the profile (Top
  // Profiles) whose tasks this count represents. Overrides any agent/profile in
  // the page's global filter so clicking always scopes to this row.
  agentId?: string;
  profileId?: string;
  searchParams: DashboardSearchParams;
  taskRoute?: "/tasks" | "/my-tasks";
  triggerClassName?: string;
}

// Clickable count that opens a drill-down split into System / Manual tabs.
// System = card backed by an automated job row; Manual = board-created card.
export function MetricTabbedDrillDown({
  metric,
  label,
  count,
  agentId,
  profileId,
  searchParams,
  taskRoute = "/tasks",
  triggerClassName,
}: MetricTabbedDrillDownProps) {
  const [open, setOpen] = useState(false);
  const clickable = count > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        aria-label={clickable ? `Show ${label} tasks` : `${label}: ${count}`}
        className={
          triggerClassName ??
          "rounded transition enabled:cursor-pointer enabled:hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default"
        }
      >
        {count}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {label} <span className="text-muted-foreground font-normal">— {count}</span>
            </DialogTitle>
          </DialogHeader>
          {open && (
            <TabbedList
              metric={metric}
              agentId={agentId}
              profileId={profileId}
              searchParams={searchParams}
              taskRoute={taskRoute}
              label={label}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ListState {
  loading: boolean;
  error: string | null;
  tasks: KPIMetricTaskRow[];
}

function TabbedList({
  metric,
  agentId,
  profileId,
  searchParams,
  taskRoute,
  label,
}: {
  metric: KPIMetricKey;
  agentId?: string;
  profileId?: string;
  searchParams: DashboardSearchParams;
  taskRoute: "/tasks" | "/my-tasks";
  label: string;
}) {
  const [state, setState] = useState<ListState>({
    loading: true,
    error: null,
    tasks: [],
  });
  const [tab, setTab] = useState<"system" | "manual">("system");

  const { range, from, to, tz } = searchParams;

  useEffect(() => {
    const params: Record<string, string> = { metric };
    if (range) params.range = range;
    if (from) params.from = from;
    if (to) params.to = to;
    if (tz) params.tz = tz;
    if (agentId) params.agent = agentId;
    if (profileId) params.profile = profileId;
    const qs = new URLSearchParams(params).toString();

    let cancelled = false;

    fetch(`/api/dashboard/metric-tasks?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { tasks: KPIMetricTaskRow[] }) => {
        if (!cancelled) setState({ loading: false, error: null, tasks: data.tasks });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ loading: false, error: err.message, tasks: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [metric, range, from, to, tz, agentId, profileId]);

  if (state.loading) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (state.error) {
    return (
      <p className="text-sm text-destructive py-8 text-center">
        Failed to load: {state.error}
      </p>
    );
  }

  const systemTasks = state.tasks.filter((t) => !t.isManual);
  const manualTasks = state.tasks.filter((t) => t.isManual);
  const active = tab === "system" ? systemTasks : manualTasks;

  return (
    <div className="flex flex-col gap-3 overflow-hidden flex-1">
      <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
        <TabButton active={tab === "system"} onClick={() => setTab("system")}>
          System <CountBadge n={systemTasks.length} active={tab === "system"} />
        </TabButton>
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          Manual <CountBadge n={manualTasks.length} active={tab === "manual"} />
        </TabButton>
      </div>
      <div className="overflow-y-auto flex-1 -mx-1 px-1">
        <MetricTaskList
          tasks={active}
          taskRoute={taskRoute}
          emptyMessage={
            tab === "system"
              ? `No system-generated ${label.toLowerCase()} tasks.`
              : `No manually-created ${label.toLowerCase()} tasks.`
          }
        />
        {state.tasks.length === 500 && (
          <p className="mt-3 text-xs text-muted-foreground text-center">
            Showing first 500. Narrow the date range to see fewer.
          </p>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
        active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {n}
    </span>
  );
}
