"use client";

import { useEffect, useRef } from "react";
import { notifyNewTask } from "@/lib/notified-tasks";

type TaskLike = { id: string; title: string };

/**
 * Polling-based new-task notifier: watches the board's task list (prop-driven)
 * and announces any id it hasn't seen before. This is now the FALLBACK path —
 * the real-time SSE stream (see BoardAutoRefresh `realtime`) is the primary
 * trigger. Both route through `notifyNewTask`, which dedups by id, so a task is
 * never beeped twice regardless of which path observes it first.
 */
export function useNewTaskNotifier(tasks: TaskLike[], opts?: { enabled?: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    if (seen.current === null) {
      seen.current = new Set(tasks.map((t) => t.id));
      return;
    }

    const currentIds = new Set(tasks.map((t) => t.id));
    const newOnes = tasks.filter((t) => !seen.current!.has(t.id));

    for (const t of newOnes) {
      // Idempotent against the SSE path — no-ops if SSE already announced it.
      notifyNewTask(t);
      seen.current!.add(t.id);
    }

    for (const id of Array.from(seen.current)) {
      if (!currentIds.has(id)) seen.current.delete(id);
    }
  }, [tasks, enabled]);
}
