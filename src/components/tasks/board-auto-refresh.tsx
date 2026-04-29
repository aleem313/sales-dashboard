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
  runInBackground = true,
}: {
  interval?: number;
  runInBackground?: boolean;
}) {
  const sp = useSearchParams();
  const refreshBoard = useBoardStore((s) => s.refreshBoard);

  useEffect(() => {
    const id = setInterval(() => {
      if (!runInBackground && document.hidden) return;
      const filters = parseBoardFiltersFromSearchParams(sp ?? new URLSearchParams());
      const query = serializeBoardFiltersToQuery(filters);
      refreshBoard(query);
    }, interval);
    return () => clearInterval(id);
  }, [interval, runInBackground, sp, refreshBoard]);

  return null;
}
