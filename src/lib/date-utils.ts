/**
 * Server-side utility for parsing date range URL parameters.
 * Supports both preset ranges (range=7d, range=today, etc.)
 * and custom date ranges (from=2024-01-01&to=2024-01-31).
 *
 * All date calculations use Pakistan Standard Time (UTC+5)
 * so "today" matches the user's local day, not UTC.
 */

import type { DateRange } from "./types";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5

/** Return a Date representing "now" in PKT as if it were UTC. */
function nowInPKT(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + PKT_OFFSET_MS);
}

/** Given a PKT-shifted Date, return start-of-day as a real UTC ISO string. */
function startOfDayPKT(d: Date): string {
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD in PKT
  return new Date(`${iso}T00:00:00+05:00`).toISOString();
}

/** Given a PKT-shifted Date, return end-of-day as a real UTC ISO string. */
function endOfDayPKT(d: Date): string {
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD in PKT
  return new Date(`${iso}T23:59:59.999+05:00`).toISOString();
}

export function parseDateRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): DateRange {
  // Custom date range takes priority
  if (params.from && params.to) {
    // Treat custom dates as PKT dates
    const startDate = new Date(`${params.from}T00:00:00+05:00`).toISOString();
    const endDate = new Date(`${params.to}T23:59:59.999+05:00`).toISOString();
    return { startDate, endDate };
  }

  const pkt = nowInPKT();
  const startDate = startOfDayPKT(pkt);
  const endDate = endOfDayPKT(pkt);

  switch (params.range) {
    case "today":
      return { startDate, endDate };
    case "yesterday": {
      const y = new Date(pkt.getTime() - 24 * 60 * 60 * 1000);
      return { startDate: startOfDayPKT(y), endDate: endOfDayPKT(y) };
    }
    case "14d": {
      const d = new Date(pkt.getTime() - 13 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDayPKT(d), endDate };
    }
    case "30d": {
      const d = new Date(pkt.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDayPKT(d), endDate };
    }
    case "this_month": {
      const iso = pkt.toISOString().slice(0, 7); // YYYY-MM
      const ms = new Date(`${iso}-01T00:00:00+05:00`).toISOString();
      return { startDate: ms, endDate };
    }
    case "last_month": {
      const lm = new Date(pkt);
      lm.setUTCDate(0); // last day of previous month
      const lmIso = lm.toISOString().slice(0, 7); // YYYY-MM of previous month
      const lmStart = new Date(`${lmIso}-01T00:00:00+05:00`).toISOString();
      const lmEnd = endOfDayPKT(lm);
      return { startDate: lmStart, endDate: lmEnd };
    }
    case "6m": {
      const d = new Date(pkt);
      d.setUTCMonth(d.getUTCMonth() - 6);
      return { startDate: startOfDayPKT(d), endDate };
    }
    case "1y": {
      const d = new Date(pkt.getTime() - 364 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDayPKT(d), endDate };
    }
    case "7d":
    default: {
      const d = new Date(pkt.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDayPKT(d), endDate };
    }
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
      const pkt = nowInPKT();
      return pkt.getUTCDate();
    }
    case "last_month": {
      const pkt = nowInPKT();
      return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), 0)).getUTCDate();
    }
    case "6m": return 180;
    case "1y": return 365;
    case "7d":
    default: return 7;
  }
}
