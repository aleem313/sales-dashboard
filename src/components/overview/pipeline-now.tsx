interface PipelineNowProps {
  stages: { label: string; count: number; color: string }[];
}

export function PipelineNow({ stages }: PipelineNowProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[14px] font-bold tracking-[0.03em]">
          Pipeline Now
        </h3>
        <span className="rounded-md bg-accent-warn/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-accent-warn">
          Live
        </span>
      </div>
      <div className="flex flex-col gap-2 p-[18px]">
        {stages.map((stage) => (
          <div
            key={stage.label}
            className="flex items-center justify-between rounded-md bg-secondary p-2"
            style={{ borderLeft: `3px solid ${stage.color}` }}
          >
            <span className="text-[12.5px] text-muted-foreground">
              {stage.label}
            </span>
            <span
              className="font-mono-data text-lg font-bold"
              style={{ color: stage.color }}
            >
              {stage.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
