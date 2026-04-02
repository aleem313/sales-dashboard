import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { AgentDetailCard } from "@/components/agents/agent-detail-card";
import { CreateAgentButton } from "@/components/agents/create-agent-button";
import {
  getEnhancedAgentStats,
  getKPIMetricsWithDeltas,
  getAgentWeeklyActivity,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";

export const revalidate = 300;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; agent?: string; profile?: string; tz?: string }>;
}) {
  const params = await searchParams;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const range = parseDateRange(params);

  const [agents, kpi, allAgents, allProfiles] = await Promise.all([
    getEnhancedAgentStats(range, agentId, profileId),
    getKPIMetricsWithDeltas(range, agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

  // Fetch weekly activity for all agents in parallel
  const weeklyActivities = await Promise.all(
    agents.map((a) => getAgentWeeklyActivity(a.id))
  );

  // Compute weighted avg response time from agents with data
  const agentsWithTime = agents.filter((a) => a.avg_response_hours !== null);
  const totalProposalsWithTime = agentsWithTime.reduce((s, a) => s + a.proposals_sent, 0);
  const weightedHours = totalProposalsWithTime > 0
    ? agentsWithTime.reduce((s, a) => s + (a.avg_response_hours ?? 0) * a.proposals_sent, 0) / totalProposalsWithTime
    : 0;

  function formatAvgTime(hours: number) {
    if (hours === 0) return "—";
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const comparisonLabels: Record<string, string> = {
    today: "vs yesterday",
    yesterday: "vs day before",
    "7d": "vs prev 7d",
    "14d": "vs prev 14d",
    "30d": "vs prev 30d",
    this_month: "vs last month",
    last_month: "vs month before",
    "6m": "vs prev 6m",
    "1y": "vs prev year",
  };
  const vsLabel = params.from && params.to
    ? "vs prev period"
    : comparisonLabels[params.range ?? "7d"] ?? "vs prev period";

  return (
    <>
      <Header
          title="Agent Performance"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">All Agents</h2>
          <CreateAgentButton />
        </div>
        <StatRow className="mb-5">
          <StatCard
            label="Avg Time to Apply"
            value={formatAvgTime(weightedHours)}
            variant="accent"
          />
          <StatCard
            label="Proposals Sent"
            value={kpi.proposalsSent}
            delta={`${fmt(kpi.deltaProposals)} ${vsLabel}`}
            deltaDown={kpi.deltaProposals < 0}
          />
          <StatCard
            label="Meetings Booked"
            value={kpi.meetingsBooked}
            variant="warn"
            delta={`${fmt(kpi.deltaMeetings)} ${vsLabel}`}
            deltaDown={kpi.deltaMeetings < 0}
          />
          <StatCard
            label="Jobs Won"
            value={kpi.won}
            variant="green"
            delta={`${fmt(kpi.deltaWon)} ${vsLabel}`}
            deltaDown={kpi.deltaWon < 0}
          />
          <StatCard
            label="Win Rate"
            value={`${kpi.winRate}%`}
            variant="accent"
            delta={`${fmt(kpi.deltaWinRate)}% ${vsLabel}`}
            deltaDown={kpi.deltaWinRate < 0}
          />
        </StatRow>

        {agents.length === 0 ? (
          <p className="text-muted-foreground">No agents found.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent, i) => (
              <AgentDetailCard
                key={agent.id}
                agent={agent}
                weeklyData={weeklyActivities[i].map((d) => d.count)}
                rank={i}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
