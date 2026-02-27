"use client";

import { useState, useEffect } from "react";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { type DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

function getInitialState(): { preset: PresetValue | null; from: Date | undefined; to: Date | undefined } {
  const params = new URLSearchParams(window.location.search);
  const rangeParam = params.get("range");
  const fromParam = params.get("from");
  const toParam = params.get("to");

  if (fromParam && toParam) {
    return { preset: null, from: new Date(fromParam), to: new Date(toParam) };
  }

  if (rangeParam && rangeParam in presetLabels) {
    const r = getDateRangeFromPreset(rangeParam as PresetValue);
    return { preset: rangeParam as PresetValue, from: r.from, to: r.to };
  }

  // Default: last 7 days
  const r = getDateRangeFromPreset("7d");
  return { preset: "7d", from: r.from, to: r.to };
}

function getDisplayLabel(preset: PresetValue | null, from: Date | undefined, to: Date | undefined): string {
  if (preset) return presetLabels[preset];
  if (from && to) {
    if (format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd")) {
      return format(from, "MMM d, yyyy");
    }
    return `${format(from, "MMM d")} - ${format(to, "MMM d, yyyy")}`;
  }
  return "Select dates";
}

export function DateRangePicker() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetValue | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  useEffect(() => {
    const state = getInitialState();
    setActivePreset(state.preset);
    setDateRange({ from: state.from, to: state.to });
    setMounted(true);
  }, []);

  function applyPreset(preset: PresetValue) {
    const r = getDateRangeFromPreset(preset);
    setActivePreset(preset);
    setDateRange({ from: r.from, to: r.to });

    const url = new URL(window.location.href);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    if (preset === "7d") {
      url.searchParams.delete("range");
    } else {
      url.searchParams.set("range", preset);
    }
    setOpen(false);
    window.location.href = url.toString();
  }

  function handleCalendarSelect(range: DateRange | undefined) {
    setDateRange(range);
    setActivePreset(null);

    if (range?.from && range?.to) {
      const url = new URL(window.location.href);
      url.searchParams.delete("range");
      url.searchParams.set("from", format(range.from, "yyyy-MM-dd"));
      url.searchParams.set("to", format(range.to, "yyyy-MM-dd"));
      setOpen(false);
      window.location.href = url.toString();
    }
  }

  if (!mounted) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[7px] border border-border bg-transparent px-3 py-1.5 text-[13.5px] font-semibold text-muted-foreground min-w-[160px]">
        <CalendarIcon className="h-3.5 w-3.5" />
        <span>Last 7 days</span>
      </div>
    );
  }

  const label = getDisplayLabel(activePreset, dateRange?.from, dateRange?.to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-[7px] border border-border bg-transparent px-3 py-1.5 text-[13.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none cursor-pointer min-w-[160px]",
            open && "border-[var(--primary)] text-foreground"
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <span className="ml-auto text-[12px]">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="end"
        sideOffset={8}
      >
        <div className="flex">
          {/* Presets sidebar */}
          <div className="border-r border-border p-2 space-y-0.5 w-[150px]">
            <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Presets
            </p>
            {presets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => applyPreset(preset.value)}
                className={cn(
                  "w-full text-left rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground",
                  activePreset === preset.value &&
                    "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground font-medium"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-2">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              defaultMonth={dateRange?.from ? subDays(dateRange.from, 0) : subMonths(new Date(), 1)}
              disabled={{ after: new Date() }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
