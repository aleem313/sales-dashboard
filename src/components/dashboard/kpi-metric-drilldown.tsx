"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/ui/stat-card";
import type { KPIMetricKey, KPIMetricTaskRow } from "@/lib/data";

interface DashboardSearchParams {
  range?: string;
  from?: string;
  to?: string;
  agent?: string;
  profile?: string;
  tz?: string;
}

interface KPIMetricDrillDownProps {
  metric: KPIMetricKey;
  label: string;
  value: number;
  subtitle?: string;
  delta?: string;
  deltaDown?: boolean;
  variant?: "accent" | "green" | "warn" | "danger" | "default";
  searchParams: DashboardSearchParams;
  emptyMessage?: string;
  // Route to deep-link task titles to. Admins use "/tasks"; agents use
  // "/my-tasks" (middleware redirects agents away from "/tasks"). The parent
  // page knows its own audience and passes the right one.
  taskRoute?: "/tasks" | "/my-tasks";
}

export function KPIMetricDrillDown({
  metric,
  label,
  value,
  searchParams,
  emptyMessage,
  taskRoute = "/tasks",
  ...statCardProps
}: KPIMetricDrillDownProps) {
  const [open, setOpen] = useState(false);
  const clickable = value > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        aria-label={clickable ? `Show tasks for ${label}` : `${label}: ${value}`}
        className="block text-left w-full h-full rounded-xl transition disabled:cursor-default enabled:cursor-pointer enabled:hover:ring-2 enabled:hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <StatCard label={label} value={value} className="h-full" {...statCardProps} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {label} <span className="text-muted-foreground font-normal">— {value}</span>
            </DialogTitle>
          </DialogHeader>
          {open && (
            <DrillDownList
              metric={metric}
              searchParams={searchParams}
              taskRoute={taskRoute}
              emptyMessage={emptyMessage ?? `No ${label.toLowerCase()} found.`}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface DrillDownListProps {
  metric: KPIMetricKey;
  searchParams: DashboardSearchParams;
  taskRoute: "/tasks" | "/my-tasks";
  emptyMessage: string;
}

interface ListState {
  loading: boolean;
  error: string | null;
  tasks: KPIMetricTaskRow[];
}

function DrillDownList({ metric, searchParams, taskRoute, emptyMessage }: DrillDownListProps) {
  const [state, setState] = useState<ListState>({
    loading: true,
    error: null,
    tasks: [],
  });

  // Destructure to primitive deps — searchParams object identity changes on
  // every parent render (AutoRefresh re-renders the dashboard), but the
  // primitive values inside it only change when the user actually changes a
  // filter. Primitive deps keep the effect stable.
  const { range, from, to, agent, profile, tz } = searchParams;

  useEffect(() => {
    const params: Record<string, string> = { metric };
    if (range) params.range = range;
    if (from) params.from = from;
    if (to) params.to = to;
    if (agent) params.agent = agent;
    if (profile) params.profile = profile;
    if (tz) params.tz = tz;
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
      .then((data: { count: number; tasks: KPIMetricTaskRow[] }) => {
        if (!cancelled) {
          setState({ loading: false, error: null, tasks: data.tasks });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ loading: false, error: err.message, tasks: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [metric, range, from, to, agent, profile, tz]);

  if (state.loading) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-12 rounded-md bg-muted animate-pulse"
          />
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

  if (state.tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 -mx-1 px-1">
      <ul className="divide-y divide-border">
        {state.tasks.map((t) => (
          <li key={t.id}>
            <a
              href={`${taskRoute}?task=${t.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md px-2 py-2.5 -mx-2 hover:bg-secondary/50 transition"
            >
              <div className="text-sm font-medium text-foreground line-clamp-2">
                {t.title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t.columnName}</span>
                {t.firstAt && (
                  <>
                    <span>·</span>
                    <span>{new Date(t.firstAt).toLocaleString()}</span>
                  </>
                )}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {state.tasks.length === 500 && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Showing first 500. Narrow the date range to see fewer.
        </p>
      )}
    </div>
  );
}
