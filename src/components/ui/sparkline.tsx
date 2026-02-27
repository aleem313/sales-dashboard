"use client";

import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  className?: string;
}

export function Sparkline({ data, className }: SparklineProps) {
  const max = Math.max(...data, 1);

  return (
    <div className={cn("flex items-end gap-[3px]", className)} style={{ height: 32 }}>
      {data.map((val, i) => {
        const heightPct = (val / max) * 100;
        const isHigh = heightPct >= 70;
        return (
          <div
            key={i}
            className={cn(
              "min-w-1 flex-1 rounded-t-sm transition-colors hover:bg-[var(--primary)]",
              isHigh
                ? "bg-[var(--primary)]/70"
                : "bg-[var(--primary)]/25"
            )}
            style={{ height: `${Math.max(heightPct, 8)}%` }}
          />
        );
      })}
    </div>
  );
}
