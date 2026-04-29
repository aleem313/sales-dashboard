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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function subDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function subMonths(d: Date, n: number): Date {
  // Clamp to last day of target month so e.g. Mar 31 - 1 month = Feb 28/29.
  const x = new Date(d);
  const targetMonth = x.getMonth() - n;
  x.setDate(1);
  x.setMonth(targetMonth);
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), lastDay));
  return x;
}

export function getDateRangeFromPreset(preset: PresetValue): { from: Date; to: Date } {
  const now = new Date();
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { from: today, to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(today, 1);
      return { from: y, to: endOfDay(y) };
    }
    case "7d":
      return { from: subDays(today, 6), to: endOfDay(now) };
    case "14d":
      return { from: subDays(today, 13), to: endOfDay(now) };
    case "30d":
      return { from: subDays(today, 29), to: endOfDay(now) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "last_month": {
      const lastM = subMonths(now, 1);
      return { from: startOfMonth(lastM), to: endOfMonth(lastM) };
    }
    case "6m":
      return { from: subMonths(today, 6), to: endOfDay(now) };
    case "1y":
      return { from: subDays(today, 364), to: endOfDay(now) };
  }
}
