import type { EnhancedProfileStats } from "@/lib/types";
import { MiniProgress } from "@/components/ui/mini-progress";
import { cn } from "@/lib/utils";

interface ProfileGridCardProps {
  profile: EnhancedProfileStats;
  isTop?: boolean;
}

function progressColor(rate: number): "accent" | "green" | "warn" | "danger" {
  if (rate >= 40) return "green";
  if (rate >= 20) return "accent";
  if (rate >= 10) return "warn";
  return "danger";
}

export function ProfileGridCard({ profile, isTop }: ProfileGridCardProps) {
  return (
    <div
      className={cn(
        "animate-slide-in cursor-default rounded-lg border bg-secondary p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        isTop ? "border-[var(--primary)]/30" : "border-border"
      )}
    >
      <div className="text-xs font-semibold text-foreground">
        {profile.profile_name}
      </div>
      <div className="mb-3 text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
        {profile.niche || profile.stack || "—"}
      </div>

      <div className="mb-1 flex justify-between text-[13.5px] text-muted-foreground">
        <span>Response Rate</span>
        <span
          style={{
            color:
              profile.response_rate >= 40
                ? "var(--accent-green)"
                : profile.response_rate >= 20
                  ? "var(--foreground)"
                  : profile.response_rate >= 10
                    ? "var(--accent-warn)"
                    : "var(--destructive)",
          }}
          className="font-medium"
        >
          {profile.response_rate}%
        </span>
      </div>
      <div className="mb-1 flex justify-between text-[13.5px] text-muted-foreground">
        <span>Interview Rate</span>
        <span
          style={{
            color:
              profile.interview_rate >= 30
                ? "var(--accent-green)"
                : profile.interview_rate >= 15
                  ? "var(--foreground)"
                  : profile.interview_rate >= 8
                    ? "var(--accent-warn)"
                    : "var(--destructive)",
          }}
          className="font-medium"
        >
          {profile.interview_rate}%
        </span>
      </div>
      <div className="mb-1 flex justify-between text-[13.5px] text-muted-foreground">
        <span>Win Rate</span>
        <span
          style={{
            color:
              (profile.win_rate_pct ?? 0) >= 15
                ? "var(--accent-green)"
                : (profile.win_rate_pct ?? 0) >= 5
                  ? "var(--foreground)"
                  : "var(--destructive)",
          }}
          className="font-medium"
        >
          {profile.win_rate_pct ?? 0}%
        </span>
      </div>

      <MiniProgress
        value={profile.response_rate}
        color={progressColor(profile.response_rate)}
        className="mt-2.5"
      />
    </div>
  );
}
