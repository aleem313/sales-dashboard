import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: string;
  deltaDown?: boolean;
  variant?: "accent" | "green" | "warn" | "danger" | "default";
  className?: string;
}

const variantColors: Record<string, string> = {
  accent: "text-[var(--primary)]",
  green: "text-accent-green",
  warn: "text-accent-warn",
  danger: "text-destructive",
  default: "text-foreground",
};

export function StatCard({
  label,
  value,
  subtitle,
  delta,
  deltaDown,
  variant = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "group rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        "animate-slide-in",
        className
      )}
    >
      <div className="text-[13.5px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono-data text-[28px] font-bold leading-none",
            variantColors[variant]
          )}
        >
          {value}
        </span>
        {subtitle && (
          <span className="text-[13.5px] font-medium text-muted-foreground/50">
            {subtitle}
          </span>
        )}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1.5 text-[13.5px]",
            deltaDown ? "text-destructive" : "text-accent-green"
          )}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5",
        className
      )}
    >
      {children}
    </div>
  );
}
