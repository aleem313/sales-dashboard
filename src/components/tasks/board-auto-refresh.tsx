"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import { parseBoardFiltersFromSearchParams, serializeBoardFiltersToQuery } from "@/lib/board-filters";
import { notifyNewTask } from "@/lib/notified-tasks";

/**
 * Keeps the board fresh via two mechanisms:
 *  - `interval` polling — also catches edits/moves by others, and re-syncs if
 *    the SSE stream drops. Pauses while a card is dragged and (unless
 *    `runInBackground`) while the tab is hidden.
 *  - `realtime` SSE — when enabled, opens a Server-Sent Events stream so a card
 *    created by n8n fires the new-task bell INSTANTLY and pulls the card in,
 *    even while the agent is working in another tab (the poll can't, when the
 *    tab is hidden and timers are throttled). Agent boards only.
 */
export function BoardAutoRefresh({
  interval = 5000,
  runInBackground = false,
  realtime = false,
}: {
  interval?: number;
  runInBackground?: boolean;
  realtime?: boolean;
}) {
  const sp = useSearchParams();
  const refreshBoard = useBoardStore((s) => s.refreshBoard);

  // Stable getter for the current filter query, reassigned every render so it
  // always reflects the latest URL filters WITHOUT forcing the effects (and the
  // SSE connection) to tear down and rebuild on each filter change.
  const queryRef = useRef<() => string>(() => "");
  queryRef.current = () => {
    const params = sp ?? new URLSearchParams();
    const filters = parseBoardFiltersFromSearchParams(params);
    return serializeBoardFiltersToQuery(filters, {
      cf_created: params.get("cf_created") ?? undefined,
      cf_updated: params.get("cf_updated") ?? undefined,
      cf_due_after: params.get("cf_due_after") ?? undefined,
      cf_due_before: params.get("cf_due_before") ?? undefined,
    });
  };

  // Polling fallback.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      if (!runInBackground && document.hidden) return;
      refreshBoard(queryRef.current());
    }, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [interval, runInBackground, refreshBoard]);

  // Real-time SSE path.
  useEffect(() => {
    if (!realtime) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const es = new EventSource("/api/events/tasks", { withCredentials: true });
    es.addEventListener("task-created", (e) => {
      try {
        const task = JSON.parse((e as MessageEvent).data) as { id: string; title: string };
        notifyNewTask(task); // bell — deduped against the polling notifier
        refreshBoard(queryRef.current()); // pull the new card onto the board now
      } catch {
        // malformed payload — ignore
      }
    });
    // EventSource auto-reconnects on transient drops; the poll above covers gaps.

    return () => es.close();
  }, [realtime, refreshBoard]);

  return null;
}
