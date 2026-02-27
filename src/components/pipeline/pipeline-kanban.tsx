import type { PipelineStage } from "@/lib/types";
import { CyberBadge } from "@/components/ui/cyber-badge";

interface PipelineKanbanProps {
  stages: PipelineStage[];
}

const stageColors: Record<string, string> = {
  "To Do": "var(--primary)",
  "New": "var(--primary)",
  "Submitted": "var(--muted-foreground)",
  "Sent": "var(--muted-foreground)",
  "Following Up": "var(--muted-foreground)",
  "Prototype Required": "var(--accent-warn)",
  "Prototype Done": "var(--muted-foreground)",
  "Prototype Sent": "var(--muted-foreground)",
  "Meeting Scheduled": "var(--primary)",
  "Meeting Done": "var(--muted-foreground)",
  "Negotiation": "var(--accent-green)",
  "Won": "var(--accent-green)",
  "Lost": "var(--destructive)",
  "On Hold": "var(--accent-warn)",
};

const stageBadgeVariant = (key: string) => {
  if (["Won", "Negotiation"].includes(key)) return "green" as const;
  if (["Lost"].includes(key)) return "danger" as const;
  if (["Prototype Required", "On Hold"].includes(key)) return "warn" as const;
  if (["To Do", "Meeting Scheduled", "New"].includes(key)) return "blue" as const;
  return "muted" as const;
};

export function PipelineKanban({ stages }: PipelineKanbanProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[13px] font-bold tracking-[0.03em]">
          Pipeline Stages
        </h3>
        <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
          All Profiles · Live
        </span>
      </div>
      <div className="overflow-x-auto p-[18px]">
        <div className="flex gap-2" style={{ minWidth: "max-content" }}>
          {stages.map((stage) => (
            <div
              key={stage.key}
              className="w-[130px] shrink-0 rounded-lg border border-border bg-secondary p-2.5"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {stage.label}
                </span>
                <CyberBadge variant={stageBadgeVariant(stage.key)}>
                  {stage.count}
                </CyberBadge>
              </div>
              <div
                className="font-mono-data text-base font-bold leading-none"
                style={{ color: stageColors[stage.key] || "var(--foreground)" }}
              >
                {stage.count}
              </div>
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                {stage.subtitle}
              </div>
            </div>
          ))}
          {stages.length === 0 && (
            <div className="py-6 text-center text-[11px] text-muted-foreground">
              No pipeline data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
