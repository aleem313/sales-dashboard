import type { FunnelStep } from "@/lib/types";

interface ConversionFunnelProps {
  steps: FunnelStep[];
}

export function ConversionFunnel({ steps }: ConversionFunnelProps) {
  const maxCount = Math.max(...steps.map((s) => s.count), 1);

  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[14px] font-bold tracking-[0.03em]">
          Conversion Funnel
        </h3>
        <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
          This Period
        </span>
      </div>
      <div className="flex flex-col gap-2 p-[18px]">
        {steps.map((step) => {
          const widthPct = Math.max((step.count / maxCount) * 100, 5);
          return (
            <div key={step.label} className="flex items-center gap-3">
              <div className="w-[120px] shrink-0 text-[11.5px] tracking-[0.05em] text-muted-foreground">
                {step.label}
              </div>
              <div className="flex-1 rounded-[3px] bg-secondary" style={{ height: 20 }}>
                <div
                  className="flex h-full items-center rounded-[3px] pl-2 text-[11.5px] font-medium text-black transition-all duration-500"
                  style={{
                    width: `${widthPct}%`,
                    background: step.color,
                    minWidth: 32,
                  }}
                >
                  {step.count}
                </div>
              </div>
              <div className="w-10 shrink-0 text-right text-[12.5px] text-muted-foreground">
                {step.count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
