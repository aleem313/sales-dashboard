import type { EnhancedAgentStats } from "@/lib/types";
import { MetricTabbedDrillDown } from "@/components/dashboard/metric-tabbed-drilldown";

interface DashboardSearchParams {
  range?: string;
  from?: string;
  to?: string;
  tz?: string;
}

interface AgentLeaderboardProps {
  agents: EnhancedAgentStats[];
  searchParams: DashboardSearchParams;
}

const numberBase =
  "font-mono-data text-base font-bold rounded transition enabled:cursor-pointer enabled:hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-default";

const avatarGradients = [
  "linear-gradient(135deg, #1a56db, #4d8af0)",
  "linear-gradient(135deg, #059669, #10b981)",
  "linear-gradient(135deg, #d97706, #f59e0b)",
  "linear-gradient(135deg, #dc2626, #ef4444)",
  "linear-gradient(135deg, #5b21b6, #7c3aed)",
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AgentLeaderboard({ agents, searchParams }: AgentLeaderboardProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[15px] font-bold tracking-[0.03em]">
          Agent Leaderboard
        </h3>
        <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
          This Period
        </span>
      </div>
      <div className="p-[18px]">
        {agents.map((agent, i) => (
          <div
            key={agent.id}
            className="flex items-center gap-3.5 border-b border-border py-3 last:border-b-0"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: avatarGradients[i % avatarGradients.length] }}
            >
              {getInitials(agent.name)}
            </div>
            <div className="flex-1">
              <div className="text-[15px] font-semibold">
                {agent.name}
              </div>
              <div className="text-[13.5px] text-muted-foreground">
                {agent.proposals_sent} proposals
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <MetricTabbedDrillDown
                  metric="proposals_sent"
                  label="Applied"
                  count={agent.proposals_sent}
                  agentId={agent.id}
                  searchParams={searchParams}
                  triggerClassName={`${numberBase} text-[var(--primary)]`}
                />
                <div className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                  Applied
                </div>
              </div>
              <div className="text-center">
                <MetricTabbedDrillDown
                  metric="meetings_done"
                  label="Meetings"
                  count={agent.meetings_done}
                  agentId={agent.id}
                  searchParams={searchParams}
                  triggerClassName={`${numberBase} text-accent-warn`}
                />
                <div className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                  Meetings
                </div>
              </div>
              <div className="text-center">
                <MetricTabbedDrillDown
                  metric="won"
                  label="Won"
                  count={agent.won}
                  agentId={agent.id}
                  searchParams={searchParams}
                  triggerClassName={`${numberBase} text-accent-green`}
                />
                <div className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                  Won
                </div>
              </div>
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <div className="py-6 text-center text-[13.5px] text-muted-foreground">
            No agent data yet
          </div>
        )}
      </div>
    </div>
  );
}
