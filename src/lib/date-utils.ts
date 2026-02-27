/**
 * Server-side utility for parsing date range URL parameters.
 * Supports both preset ranges (range=7d, range=today, etc.)
 * and custom date ranges (from=2024-01-01&to=2024-01-31).
 */

import type { DateRange } from "./types";

export function parseDateRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): DateRange {
  // Custom date range takes priority
  if (params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    // Set to start/end of day
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { startDate: from.toISOString(), endDate: to.toISOString() };
  }

  const now = new Date();
  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  switch (params.range) {
    case "today":
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "yesterday": {
      const y = new Date(startDate);
      y.setDate(y.getDate() - 1);
      const yEnd = new Date(y);
      yEnd.setHours(23, 59, 59, 999);
      return { startDate: y.toISOString(), endDate: yEnd.toISOString() };
    }
    case "14d":
      startDate.setDate(startDate.getDate() - 13);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "30d":
      startDate.setDate(startDate.getDate() - 29);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "this_month":
      startDate.setDate(1);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "last_month": {
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      return { startDate: lmStart.toISOString(), endDate: lmEnd.toISOString() };
    }
    case "6m":
      startDate.setMonth(startDate.getMonth() - 6);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "1y":
      startDate.setDate(startDate.getDate() - 364);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    case "7d":
    default:
      // Default: last 7 days
      startDate.setDate(startDate.getDate() - 6);
      return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  }
}

/**
 * Calculate the number of days in a range, for use with getKPIMetricsWithDeltas
 * which needs a `days` parameter to compute period-over-period deltas.
 */
export function rangeToDays(params: {
  range?: string;
  from?: string;
  to?: string;
}): number {
  if (params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }

  switch (params.range) {
    case "today": return 1;
    case "yesterday": return 1;
    case "14d": return 14;
    case "30d": return 30;
    case "this_month": {
      const now = new Date();
      return now.getDate();
    }
    case "last_month": {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    }
    case "6m": return 180;
    case "1y": return 365;
    case "7d":
    default: return 7;
  }
}
