"use client";

import type { EnhancedAgentStats } from "@/lib/types";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { CyberBadge } from "@/components/ui/cyber-badge";

interface AgentDetailCardProps {
  agent: EnhancedAgentStats;
  weeklyData: number[];
  rank: number;
}

function formatTime(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function AgentDetailCard({ agent, weeklyData, rank }: AgentDetailCardProps) {
  const badge =
    rank === 0
      ? { label: "Top Agent", variant: "green" as const }
      : agent.score_pct >= 60
        ? { label: "Steady", variant: "blue" as const }
        : { label: "Needs Review", variant: "warn" as const };

  const scoreColor =
    agent.score_pct >= 70
      ? "var(--accent-green)"
      : agent.score_pct >= 50
        ? "var(--primary)"
        : "var(--accent-warn)";

  return (
    <div className="animate-slide-in rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[14px] font-bold tracking-[0.03em]">
          {agent.name}
        </h3>
        <CyberBadge variant={badge.variant}>{badge.label}</CyberBadge>
      </div>
      <div className="p-[18px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="font-mono-data text-[32px] font-bold leading-none text-accent-green">
              {agent.won}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              Wins this period
            </div>
          </div>
          <ScoreRing percentage={agent.score_pct} color={scoreColor} />
        </div>

        <div className="flex flex-col gap-2">
          <MetricRow
            label="Time to apply (avg)"
            value={formatTime(agent.avg_response_hours)}
            color={
              agent.avg_response_hours !== null && agent.avg_response_hours <= 1
                ? "var(--accent-green)"
                : agent.avg_response_hours !== null && agent.avg_response_hours <= 2
                  ? "var(--accent-warn)"
                  : "var(--destructive)"
            }
          />
          <MetricRow label="Proposals sent" value={String(agent.proposals_sent)} />
          <MetricRow label="Meetings done" value={String(agent.meetings_done)} />
          <MetricRow
            label="Conversion rate"
            value={`${agent.conversion_rate}%`}
            color={
              agent.conversion_rate >= 8
                ? "var(--accent-green)"
                : agent.conversion_rate >= 5
                  ? "var(--accent-warn)"
                  : "var(--destructive)"
            }
          />
          <MetricRow
            label="Bonus earned"
            value={`$${agent.bonus_earned}`}
            color="var(--accent-green)"
            bold
          />
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Weekly Activity
          </div>
          <Sparkline data={weeklyData} />
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  color,
  bold,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        style={color ? { color } : undefined}
        className={bold ? "font-bold" : ""}
      >
        {value}
      </span>
    </div>
  );
}
