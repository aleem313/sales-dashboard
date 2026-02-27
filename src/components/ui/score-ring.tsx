"use client";

import { cn } from "@/lib/utils";

interface ScoreRingProps {
  percentage: number;
  size?: number;
  color?: string;
  className?: string;
}

export function ScoreRing({
  percentage,
  size = 44,
  color = "var(--primary)",
  className,
}: ScoreRingProps) {
  const pct = Math.max(0, Math.min(100, percentage));

  return (
    <div
      className={cn("relative flex items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${pct * 3.6}deg, var(--secondary) 0deg)`,
      }}
    >
      <div
        className="absolute rounded-full bg-card"
        style={{
          inset: 5,
        }}
      />
      <span className="relative z-10 font-mono-data text-[13.5px] font-bold text-foreground">
        {pct}%
      </span>
    </div>
  );
}
