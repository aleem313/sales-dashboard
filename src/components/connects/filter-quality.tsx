import type { FilterQuality } from "@/lib/types";

interface FilterQualityProps {
  data: FilterQuality[];
}

function barColor(pct: number) {
  if (pct >= 30) return "var(--destructive)";
  if (pct >= 15) return "var(--accent-warn)";
  return "var(--muted-foreground)";
}

export function FilterQualityCard({ data }: FilterQualityProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[15px] font-bold tracking-[0.03em]">
          Filter Quality Analysis
        </h3>
        <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
          Rejection Breakdown
        </span>
      </div>
      <div className="p-[18px]">
        <div className="flex flex-col gap-2.5">
          {data.map((item) => (
            <div key={item.reason}>
              <div className="mb-1 flex justify-between text-[13.5px]">
                <span className="text-muted-foreground">{item.reason}</span>
                <span style={{ color: barColor(item.percentage) }}>
                  {item.percentage}%
                </span>
              </div>
              <div className="h-1.5 rounded-sm bg-border">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${item.percentage}%`,
                    background: barColor(item.percentage),
                  }}
                />
              </div>
            </div>
          ))}
          {data.length === 0 && (
            <div className="py-4 text-center text-[13.5px] text-muted-foreground">
              No rejection data tracked yet
            </div>
          )}
        </div>

        {data.length > 0 && (
          <div className="mt-4 rounded-md border-l-[3px] border-l-accent-green bg-secondary p-2.5">
            <div className="text-xs font-bold text-foreground">
              AI Recommendation
            </div>
            <div className="mt-1 text-[13.5px] text-muted-foreground">
              {data[0] && data[0].percentage >= 25
                ? `Addressing "${data[0].reason}" (${data[0].percentage}% of rejections) could significantly reduce wasted connects.`
                : "Filter quality is well balanced. Continue monitoring for patterns."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
