// src/lib/board-filters.ts
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { TaskPriority } from "@/lib/task-data";

export const INITIAL_PER_COLUMN = 5;
export const PAGE_SIZE = 10;

export interface BoardServerFilters {
  search?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  tagId?: string;
  /** When set, only this column's bucket is populated (used by single-column queries). */
  columnId?: string;
}

type SearchParamsLike =
  | URLSearchParams
  | ReadonlyURLSearchParams
  | Record<string, string | string[] | undefined>;

// ReadonlyURLSearchParams is not exposed as a runtime class, so duck-type by .get().
// Safe within this union: the Record variant carries strings/arrays/undefined values only,
// never a `get` function.
function hasGetMethod(sp: SearchParamsLike): sp is URLSearchParams | ReadonlyURLSearchParams {
  return sp instanceof URLSearchParams || typeof (sp as { get?: unknown }).get === "function";
}

/**
 * Extract a single string value for `key`, normalizing across the three input
 * variants (URLSearchParams, ReadonlyURLSearchParams, Record). When the Record
 * variant carries an array (e.g. `?board=a&board=b`), the first element wins.
 */
export function firstSearchParam(sp: SearchParamsLike, key: string): string | undefined {
  if (hasGetMethod(sp)) {
    const v = sp.get(key);
    return v ?? undefined;
  }
  const raw = (sp as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

const get = firstSearchParam;

export function parseBoardFiltersFromSearchParams(sp: SearchParamsLike): BoardServerFilters {
  const priority = get(sp, "priority");
  return {
    search: get(sp, "search") || undefined,
    priority: priority === "urgent" || priority === "high" || priority === "medium" || priority === "low"
      ? priority
      : undefined,
    assigneeId: get(sp, "assignee") || undefined,
    tagId: get(sp, "tag") || undefined,
    columnId: get(sp, "column") || undefined,
  };
}

export function serializeBoardFiltersToQuery(f: BoardServerFilters): string {
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.priority) params.set("priority", f.priority);
  if (f.assigneeId) params.set("assignee", f.assigneeId);
  if (f.tagId) params.set("tag", f.tagId);
  if (f.columnId) params.set("column", f.columnId);
  return params.toString();
}
