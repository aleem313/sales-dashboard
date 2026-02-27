import { cn } from "@/lib/utils";

type BadgeVariant = "green" | "blue" | "warn" | "danger" | "purple" | "muted";

const variantClasses: Record<BadgeVariant, string> = {
  green: "bg-accent-green/15 text-accent-green",
  blue: "bg-[var(--primary)]/10 text-[var(--primary)]",
  warn: "bg-accent-warn/15 text-accent-warn",
  danger: "bg-destructive/15 text-destructive",
  purple: "bg-accent-purple/15 text-accent-purple",
  muted: "bg-secondary text-muted-foreground",
};

interface CyberBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function CyberBadge({
  variant = "blue",
  children,
  className,
}: CyberBadgeProps) {
  return (
    <span
      className={cn(
        "inline-block rounded-md px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
