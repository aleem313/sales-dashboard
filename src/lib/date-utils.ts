/**
 * Server-side utility for parsing date range URL parameters.
 * Supports both preset ranges (range=7d, range=today, etc.)
 * and custom date ranges (from=2024-01-01&to=2024-01-31).
 *
 * Supports timezone selection via `tz` URL param:
 *   - "pkt" (default) = Pakistan Standard Time (UTC+5)
 *   - "et" = US Eastern Time (UTC-4)
 */

import type { DateRange } from "./types";

export type TZKey = "pkt" | "et";

const TZ_OFFSETS: Record<TZKey, { ms: number; utc: string }> = {
  pkt: { ms: 5 * 60 * 60 * 1000, utc: "+05:00" },
  et:  { ms: -4 * 60 * 60 * 1000, utc: "-04:00" },
};

function resolveTZ(tz?: string): TZKey {
  if (tz === "et") return "et";
  return "pkt";
}

/** Return a Date representing "now" in the selected timezone as if it were UTC. */
function nowInTZ(tz: TZKey): Date {
  const utc = new Date();
  return new Date(utc.getTime() + TZ_OFFSETS[tz].ms);
}

/** Given a TZ-shifted Date, return start-of-day as a real UTC ISO string. */
function startOfDay(d: Date, tz: TZKey): string {
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00${TZ_OFFSETS[tz].utc}`).toISOString();
}

/** Given a TZ-shifted Date, return end-of-day as a real UTC ISO string. */
function endOfDay(d: Date, tz: TZKey): string {
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T23:59:59.999${TZ_OFFSETS[tz].utc}`).toISOString();
}

export function parseDateRange(params: {
  range?: string;
  from?: string;
  to?: string;
  tz?: string;
}): DateRange {
  const tz = resolveTZ(params.tz);

  // Custom date range takes priority
  if (params.from && params.to) {
    const startDate = new Date(`${params.from}T00:00:00${TZ_OFFSETS[tz].utc}`).toISOString();
    const endDate = new Date(`${params.to}T23:59:59.999${TZ_OFFSETS[tz].utc}`).toISOString();
    return { startDate, endDate };
  }

  const now = nowInTZ(tz);
  const startDate = startOfDay(now, tz);
  const endDate = endOfDay(now, tz);

  switch (params.range) {
    case "today":
      return { startDate, endDate };
    case "yesterday": {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { startDate: startOfDay(y, tz), endDate: endOfDay(y, tz) };
    }
    case "14d": {
      const d = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDay(d, tz), endDate };
    }
    case "30d": {
      const d = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDay(d, tz), endDate };
    }
    case "this_month": {
      const iso = now.toISOString().slice(0, 7);
      const ms = new Date(`${iso}-01T00:00:00${TZ_OFFSETS[tz].utc}`).toISOString();
      return { startDate: ms, endDate };
    }
    case "last_month": {
      const lm = new Date(now);
      lm.setUTCDate(0);
      const lmIso = lm.toISOString().slice(0, 7);
      const lmStart = new Date(`${lmIso}-01T00:00:00${TZ_OFFSETS[tz].utc}`).toISOString();
      const lmEnd = endOfDay(lm, tz);
      return { startDate: lmStart, endDate: lmEnd };
    }
    case "6m": {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() - 6);
      return { startDate: startOfDay(d, tz), endDate };
    }
    case "1y": {
      const d = new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDay(d, tz), endDate };
    }
    case "7d":
    default: {
      const d = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { startDate: startOfDay(d, tz), endDate };
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
  tz?: string;
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
      const n = nowInTZ(resolveTZ(params.tz));
      return n.getUTCDate();
    }
    case "last_month": {
      const n = nowInTZ(resolveTZ(params.tz));
      return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).getUTCDate();
    }
    case "6m": return 180;
    case "1y": return 365;
    case "7d":
    default: return 7;
  }
}
