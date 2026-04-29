// src/lib/board-filters.ts
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { TaskPriority } from "@/lib/task-data";
import { getDateRangeFromPreset, type PresetValue } from "@/components/date-range-picker";

export const INITIAL_PER_COLUMN = 5;
export const PAGE_SIZE = 10;

export interface BoardServerFilters {
  search?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  tagId?: string;
  /** When set, only this column's bucket is populated (used by single-column queries). */
  columnId?: string;
  /**
   * Date predicates pushed down to SQL so per-column pagination operates on the
   * date-filtered set, not the unfiltered top-N. ISO timestamp strings (UTC).
   * `createdFrom/To` and `updatedFrom/To` come from preset ranges (Today,
   * Last 7 days, …); `dueFrom/To` is set by Due Date before/after/is filters.
   */
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  dueFrom?: string;
  dueTo?: string;
}

const DATE_PRESETS = new Set<PresetValue>([
  "today",
  "yesterday",
  "7d",
  "14d",
  "30d",
  "this_month",
  "last_month",
  "6m",
  "1y",
]);

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

function presetToRange(raw: string | undefined): { from: string; to: string } | undefined {
  if (!raw) return undefined;
  if (!DATE_PRESETS.has(raw as PresetValue)) return undefined;
  const { from, to } = getDateRangeFromPreset(raw as PresetValue);
  return { from: from.toISOString(), to: to.toISOString() };
}

function isoOrUndefined(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

export function parseBoardFiltersFromSearchParams(sp: SearchParamsLike): BoardServerFilters {
  const priority = get(sp, "priority");
  const createdRange = presetToRange(get(sp, "cf_created"));
  const updatedRange = presetToRange(get(sp, "cf_updated"));
  // Due Date uses raw operators (before/after/is) — values are ISO date strings.
  const dueAfter = isoOrUndefined(get(sp, "cf_due_after"));
  const dueBefore = isoOrUndefined(get(sp, "cf_due_before"));
  return {
    search: get(sp, "search") || undefined,
    priority: priority === "urgent" || priority === "high" || priority === "medium" || priority === "low"
      ? priority
      : undefined,
    assigneeId: get(sp, "assignee") || undefined,
    tagId: get(sp, "tag") || undefined,
    columnId: get(sp, "column") || undefined,
    createdFrom: createdRange?.from,
    createdTo: createdRange?.to,
    updatedFrom: updatedRange?.from,
    updatedTo: updatedRange?.to,
    dueFrom: dueAfter,
    dueTo: dueBefore,
  };
}

/**
 * Mirror of the source params consumed by `parseBoardFiltersFromSearchParams`.
 * `serializeBoardFiltersToQuery` round-trips the *raw* preset/ISO values that
 * came in from the URL; callers building this from scratch should pass the
 * preset/ISO inputs directly via these source fields.
 */
export interface BoardFilterSource {
  cf_created?: string;
  cf_updated?: string;
  cf_due_after?: string;
  cf_due_before?: string;
}

export function serializeBoardFiltersToQuery(
  f: BoardServerFilters,
  source?: BoardFilterSource
): string {
  const params = new URLSearchParams();
  if (f.search) params.set("search", f.search);
  if (f.priority) params.set("priority", f.priority);
  if (f.assigneeId) params.set("assignee", f.assigneeId);
  if (f.tagId) params.set("tag", f.tagId);
  if (f.columnId) params.set("column", f.columnId);
  if (source?.cf_created) params.set("cf_created", source.cf_created);
  if (source?.cf_updated) params.set("cf_updated", source.cf_updated);
  if (source?.cf_due_after) params.set("cf_due_after", source.cf_due_after);
  if (source?.cf_due_before) params.set("cf_due_before", source.cf_due_before);
  return params.toString();
}
