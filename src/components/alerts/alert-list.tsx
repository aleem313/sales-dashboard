import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AlertListProps {
  alerts: Alert[];
  variant: "danger" | "warn" | "green" | "info";
}

const variantStyles = {
  danger: "border-destructive/20 bg-destructive/8",
  warn: "border-accent-warn/20 bg-accent-warn/8",
  green: "border-accent-green/20 bg-accent-green/6",
  info: "border-[var(--primary)]/15 bg-[var(--primary)]/6",
};

const variantIcons = {
  danger: "\u26A0",
  warn: "\u26A1",
  green: "\u2726",
  info: "\u2139",
};

export function AlertList({ alerts, variant }: AlertListProps) {
  if (alerts.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground">
        No {variant === "danger" ? "critical alerts" : "items"} at this time
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 text-[11px] text-foreground",
            variantStyles[variant]
          )}
        >
          <span className="mt-0.5 shrink-0 text-sm">
            {variantIcons[variant]}
          </span>
          <div>
            <div className="text-xs font-bold">
              {alert.alert_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </div>
            <div className="mt-0.5 text-muted-foreground">{alert.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
