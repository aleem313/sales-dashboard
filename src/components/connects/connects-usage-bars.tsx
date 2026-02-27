import type { ConnectsUsage } from "@/lib/types";

interface ConnectsUsageBarsProps {
  data: ConnectsUsage[];
}

function barColor(pct: number) {
  if (pct <= 50) return "var(--accent-green)";
  if (pct <= 75) return "var(--accent-warn)";
  return "var(--destructive)";
}

export function ConnectsUsageBars({ data }: ConnectsUsageBarsProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[14px] font-bold tracking-[0.03em]">
          Connects Usage by Profile
        </h3>
        <span className="rounded-md bg-accent-warn/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-accent-warn">
          Budget Watch
        </span>
      </div>
      <div className="p-[18px]">
        <div className="flex flex-wrap gap-3">
          {data.map((item) => {
            const pct = item.connects_budget > 0
              ? Math.round((item.connects_used / item.connects_budget) * 100)
              : 0;
            return (
              <div
                key={item.profile_name}
                className="flex-1 min-w-[160px] rounded-lg border border-border bg-secondary p-3"
              >
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  {item.profile_name} · {item.niche || "—"}
                </div>
                <div className="mb-1.5 h-1.5 rounded-sm bg-border">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      background: barColor(pct),
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span style={{ color: "var(--accent-warn)" }}>
                    {item.connects_used} used
                  </span>
                  <span>{item.connects_budget} total</span>
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div className="w-full py-6 text-center text-[12.5px] text-muted-foreground">
              No connects data tracked yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
