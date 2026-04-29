"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import { parseBoardFiltersFromSearchParams, serializeBoardFiltersToQuery } from "@/lib/board-filters";

/**
 * Attaches an IntersectionObserver to the returned ref. When it intersects and
 * the column has more tasks to load, triggers loadMoreForColumn with the current
 * URL filters serialized into the API query.
 */
export function useColumnLoadMore(columnId: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sp = useSearchParams();
  const loadMoreForColumn = useBoardStore((s) => s.loadMoreForColumn);
  const hasMore = useBoardStore((s) => s.columnHasMore[columnId] ?? false);
  const loading = useBoardStore((s) => s.columnLoading[columnId] ?? false);

  useEffect(() => {
    if (!ref.current) return;
    if (!hasMore) return;

    const el = ref.current;
    // Find the column's own scroll container so the observer fires only on
    // intra-column scroll, not on initial page render where short columns
    // would already be inside the page viewport.
    const scrollRoot = el.closest("[data-column-scroll]") as HTMLElement | null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !useBoardStore.getState().columnLoading[columnId]) {
            const filters = parseBoardFiltersFromSearchParams(sp ?? new URLSearchParams());
            const query = serializeBoardFiltersToQuery(filters);
            loadMoreForColumn(columnId, query);
          }
        }
      },
      { root: scrollRoot, rootMargin: "200px 0px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
    // `loading` is intentionally excluded from deps: the callback reads fresh
    // state via useBoardStore.getState() to avoid stale-closure double-fire.
    // `sp` recycles the observer on every URL navigation (including unrelated
    // ones like ?task=); cheap at 14 columns, document if it becomes hot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnId, hasMore, loadMoreForColumn, sp]);

  return { ref, hasMore, loading };
}
