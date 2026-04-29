const presets = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 14 days", value: "14d" },
  { label: "Last 30 days", value: "30d" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" },
  { label: "Last 6 months", value: "6m" },
  { label: "1 year", value: "1y" },
] as const;

export type PresetValue = (typeof presets)[number]["value"];

export const presetList = presets;

export const presetLabels: Record<string, string> = Object.fromEntries(
  presets.map((p) => [p.value, p.label])
);

// Default to US Eastern (-04:00 EDT). Matches src/lib/date-utils.ts so server-
// rendered board filters and dashboard ranges agree on "today".
const ET_OFFSET_MS = -4 * 60 * 60 * 1000;
const ET_UTC = "-04:00";

function nowShifted(): Date {
  return new Date(Date.now() + ET_OFFSET_MS);
}

function startOfDay(d: Date): Date {
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00${ET_UTC}`);
}

function endOfDay(d: Date): Date {
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T23:59:59.999${ET_UTC}`);
}

function shiftDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function startOfMonth(d: Date): Date {
  const iso = d.toISOString().slice(0, 7);
  return new Date(`${iso}-01T00:00:00${ET_UTC}`);
}

function endOfMonth(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return new Date(`${iso}T23:59:59.999${ET_UTC}`);
}

function shiftMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

export function getDateRangeFromPreset(preset: PresetValue): { from: Date; to: Date } {
  const now = nowShifted();
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { from: today, to: endOfDay(now) };
    case "yesterday": {
      const y = shiftDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "7d":
      return { from: startOfDay(shiftDays(now, -6)), to: endOfDay(now) };
    case "14d":
      return { from: startOfDay(shiftDays(now, -13)), to: endOfDay(now) };
    case "30d":
      return { from: startOfDay(shiftDays(now, -29)), to: endOfDay(now) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "last_month": {
      const lastM = shiftMonths(now, -1);
      return { from: startOfMonth(lastM), to: endOfMonth(lastM) };
    }
    case "6m":
      return { from: startOfDay(shiftMonths(now, -6)), to: endOfDay(now) };
    case "1y":
      return { from: startOfDay(shiftDays(now, -364)), to: endOfDay(now) };
  }
}
