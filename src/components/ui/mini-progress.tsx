import { cn } from "@/lib/utils";

interface MiniProgressProps {
  value: number;
  max?: number;
  color?: "accent" | "green" | "warn" | "danger";
  className?: string;
}

const colorMap = {
  accent: "bg-[var(--primary)]",
  green: "bg-accent-green",
  warn: "bg-accent-warn",
  danger: "bg-destructive",
};

export function MiniProgress({
  value,
  max = 100,
  color = "accent",
  className,
}: MiniProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={cn("h-[3px] rounded-sm bg-border", className)}>
      <div
        className={cn("h-full rounded-sm transition-all duration-500", colorMap[color])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
