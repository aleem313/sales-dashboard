"use client";

import { useState, useEffect, Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/ui/stat-card";
import type { ResponseTimeJobRow } from "@/lib/data";

interface DashboardSearchParams {
  range?: string;
  from?: string;
  to?: string;
  agent?: string;
  profile?: string;
  tz?: string;
}

interface ResponseTimeDrillDownProps {
  label: string;
  value: string; // pre-formatted, e.g. "13m" / "2h 5m" / "—"
  delta?: string;
  variant?: "accent" | "green" | "warn" | "danger" | "default";
  searchParams: DashboardSearchParams;
  taskRoute?: "/tasks" | "/my-tasks";
}

// Drill-down for the "Response time to apply" card. Unlike the count cards
// (KPIMetricDrillDown, backed by the task CTE), this lists the exact jobs that
// feed getAvgResponseTime's median — each with its per-job elapsed time, sorted
// ascending — so the median is verifiable by eye.
export function ResponseTimeDrillDown({
  label,
  value,
  delta,
  variant,
  searchParams,
  taskRoute = "/tasks",
}: ResponseTimeDrillDownProps) {
  const [open, setOpen] = useState(false);
  const clickable = value !== "—";

  return (
    <>
      <button
        type="button"
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        aria-label={clickable ? `Show jobs behind ${label}` : `${label}: ${value}`}
        className="block text-left w-full h-full rounded-xl transition disabled:cursor-default enabled:cursor-pointer enabled:hover:ring-2 enabled:hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <StatCard label={label} value={value} delta={delta} variant={variant} className="h-full" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {label}{" "}
              <span className="text-muted-foreground font-normal">— median {value}</span>
            </DialogTitle>
          </DialogHeader>
          {open && (
            <DrillDownList searchParams={searchParams} taskRoute={taskRoute} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ListState {
  loading: boolean;
  error: string | null;
  jobs: ResponseTimeJobRow[];
  medianMinutes: number | null;
}

function fmtElapsed(min: number): string {
  if (min < 0) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

function DrillDownList({
  searchParams,
  taskRoute,
}: {
  searchParams: DashboardSearchParams;
  taskRoute: "/tasks" | "/my-tasks";
}) {
  const [state, setState] = useState<ListState>({
    loading: true,
    error: null,
    jobs: [],
    medianMinutes: null,
  });

  // Primitive deps — searchParams object identity changes on every AutoRefresh
  // re-render; the values inside only change on a real filter change.
  const { range, from, to, agent, profile, tz } = searchParams;

  useEffect(() => {
    const params: Record<string, string> = {};
    if (range) params.range = range;
    if (from) params.from = from;
    if (to) params.to = to;
    if (agent) params.agent = agent;
    if (profile) params.profile = profile;
    if (tz) params.tz = tz;
    const qs = new URLSearchParams(params).toString();

    let cancelled = false;

    fetch(`/api/dashboard/response-time-jobs?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { medianMinutes: number | null; jobs: ResponseTimeJobRow[] }) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            jobs: data.jobs,
            medianMinutes: data.medianMinutes,
          });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ loading: false, error: err.message, jobs: [], medianMinutes: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [range, from, to, agent, profile, tz]);

  if (state.loading) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
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

  if (state.jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No jobs in this period.
      </p>
    );
  }

  // The median line sits before the first row whose elapsed ≥ median, so the
  // user can see exactly which jobs are above/below the headline number.
  const { medianMinutes } = state;
  const medianIdx =
    medianMinutes === null
      ? -1
      : state.jobs.findIndex((j) => j.elapsedMinutes >= medianMinutes);

  return (
    <div className="overflow-y-auto flex-1 -mx-1 px-1">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {state.jobs.length} job{state.jobs.length === 1 ? "" : "s"} · sorted by wait time
        </span>
        {medianMinutes !== null && (
          <span>
            median <span className="font-mono-data text-foreground">{fmtElapsed(medianMinutes)}</span>
          </span>
        )}
      </div>
      <ul className="divide-y divide-border">
        {state.jobs.map((j, i) => (
          <Fragment key={j.id}>
            {i === medianIdx && (
              <li className="flex items-center gap-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <span className="h-px flex-1 bg-primary/40" />
                median · {fmtElapsed(medianMinutes!)}
                <span className="h-px flex-1 bg-primary/40" />
              </li>
            )}
            <li>
              <RowInner job={j} taskRoute={taskRoute} />
            </li>
          </Fragment>
        ))}
      </ul>
      {state.jobs.length === 500 && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Showing first 500 (median above is over the full set). Narrow the date range to see fewer.
        </p>
      )}
    </div>
  );
}

function RowInner({
  job,
  taskRoute,
}: {
  job: ResponseTimeJobRow;
  taskRoute: "/tasks" | "/my-tasks";
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-foreground line-clamp-2">{job.title}</div>
        <div
          className={`shrink-0 font-mono-data text-sm font-semibold ${
            job.pending ? "text-destructive" : "text-accent-green"
          }`}
        >
          {fmtElapsed(job.elapsedMinutes)}
        </div>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${
            job.pending
              ? "bg-destructive/15 text-destructive"
              : "bg-accent-green/15 text-accent-green"
          }`}
        >
          {job.pending ? "waiting" : "sent"}
        </span>
        <span className="truncate">{job.profileName ?? "—"}</span>
        <span>·</span>
        <span className="truncate">{job.agentName ?? "Unassigned"}</span>
        {job.receivedAt && (
          <>
            <span>·</span>
            <span className="whitespace-nowrap">
              {job.pending
                ? `recv ${new Date(job.receivedAt).toLocaleString()}`
                : `sent ${job.proposalSentAt ? new Date(job.proposalSentAt).toLocaleString() : "—"}`}
            </span>
          </>
        )}
      </div>
    </>
  );

  if (job.taskId) {
    return (
      <a
        href={`${taskRoute}?task=${job.taskId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-md px-2 py-2.5 -mx-2 hover:bg-secondary/50 transition"
      >
        {body}
      </a>
    );
  }
  return <div className="px-2 py-2.5 -mx-2">{body}</div>;
}
