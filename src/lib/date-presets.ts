import { subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";

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
