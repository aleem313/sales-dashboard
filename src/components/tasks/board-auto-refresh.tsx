"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import { parseBoardFiltersFromSearchParams, serializeBoardFiltersToQuery } from "@/lib/board-filters";

/**
 * Polls every `interval` ms and asks the board store to refresh the loaded
 * window per column with current URL filters. Pauses while a card is being
 * dragged and (optionally) while the tab is hidden.
 */
export function BoardAutoRefresh({
  interval = 5000,
  runInBackground = false,
}: {
  interval?: number;
  runInBackground?: boolean;
}) {
  const sp = useSearchParams();
  const refreshBoard = useBoardStore((s) => s.refreshBoard);

  useEffect(() => {
    // `cancelled` short-circuits any tick that's mid-flight when the effect
    // tears down (e.g. URL navigation / modal open). The store's own
    // paginationVersion guard handles the orthogonal filter-change race.
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      if (!runInBackground && document.hidden) return;
      const params = sp ?? new URLSearchParams();
      const filters = parseBoardFiltersFromSearchParams(params);
      const query = serializeBoardFiltersToQuery(filters, {
        cf_created: params.get("cf_created") ?? undefined,
        cf_updated: params.get("cf_updated") ?? undefined,
        cf_due_after: params.get("cf_due_after") ?? undefined,
        cf_due_before: params.get("cf_due_before") ?? undefined,
      });
      refreshBoard(query);
    }, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [interval, runInBackground, sp, refreshBoard]);

  return null;
}
