"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { MetricTaskList } from "@/components/dashboard/metric-task-list";
import type { KPIMetricTaskRow } from "@/lib/data";

const STORAGE_KEY = "meeting_reminder_minimized";
const POLL_MS = 30_000;

interface WidgetState {
  loading: boolean;
  error: string | null;
  tasks: KPIMetricTaskRow[];
}

// Floating bottom-right reminder of cards currently in the "Meeting Scheduled"
// column. Visible on every authenticated page (mounted once in the root layout),
// for both agents and admins. Self-gates: renders nothing when logged out or when
// there are zero meetings to surface. Minimize/expand state persists in localStorage.
export function MeetingReminderWidget() {
  const { data: session } = useSession();
  const [state, setState] = useState<WidgetState>({
    loading: true,
    error: null,
    tasks: [],
  });
  // Lazy init from localStorage (SSR-guarded). The widget renders nothing until
  // the client session loads, so this never causes a hydration mismatch.
  const [minimized, setMinimized] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleMinimized = useCallback(() => {
    setMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Agents and admins both fetch; the API scopes the result by role. Poll every
  // 30s, skipping when the tab is hidden (same guard as <AutoRefresh />).
  const authed = Boolean(session?.user);
  useEffect(() => {
    if (!authed) return;

    let cancelled = false;

    const load = () => {
      if (document.hidden) return;
      fetch("/api/reminders/meeting-scheduled", { cache: "no-store" })
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
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authed]);

  if (!session?.user) return null;

  // Don't clutter the screen while loading or when there's nothing to remind about.
  if (state.loading || (!state.error && state.tasks.length === 0)) return null;

  const count = state.tasks.length;
  const taskRoute = session.user.role === "agent" ? "/my-tasks" : "/tasks";

  // Minimized: a compact pill that re-opens the panel.
  if (minimized) {
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        aria-label={`Show ${count} scheduled meetings`}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-destructive/40 bg-background px-4 py-2 text-sm font-medium shadow-lg transition hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
      >
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        <CalendarClock className="size-4 text-destructive" />
        Meetings
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">
          {count}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-h-[60vh] w-80 flex-col rounded-xl border border-destructive/30 bg-background shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-destructive" />
          Meeting Scheduled
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">
            {count}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleMinimized}
          aria-label="Minimize meetings reminder"
          className="rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div className="overflow-y-auto px-3 py-2">
        {state.error ? (
          <p className="py-6 text-center text-sm text-destructive">
            Failed to load: {state.error}
          </p>
        ) : (
          <MetricTaskList
            tasks={state.tasks}
            taskRoute={taskRoute}
            emptyMessage="No meetings scheduled."
          />
        )}
      </div>
    </div>
  );
}
