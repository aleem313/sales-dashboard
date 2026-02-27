import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { AgentDetailCard } from "@/components/agents/agent-detail-card";
import {
  getEnhancedAgentStats,
  getAgentWeeklyActivity,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";

export const revalidate = 300;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const days = params.range === "30" ? 30 : params.range === "all" ? 365 * 5 : 7;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const range = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };

  const [agents, allAgents, allProfiles] = await Promise.all([
    getEnhancedAgentStats(range),
    getAllAgents(),
    getAllProfiles(),
  ]);

  // Fetch weekly activity for all agents in parallel
  const weeklyActivities = await Promise.all(
    agents.map((a) => getAgentWeeklyActivity(a.id))
  );

  const totalProposals = agents.reduce((s, a) => s + a.proposals_sent, 0);
  const totalMeetings = agents.reduce((s, a) => s + a.meetings_done, 0);
  const totalWins = agents.reduce((s, a) => s + a.won, 0);
  const avgHours = agents.length > 0
    ? agents.reduce((s, a) => s + (a.avg_response_hours ?? 0), 0) / agents.length
    : 0;
  const negotiationRate = totalMeetings > 0
    ? Math.round((agents.reduce((s, a) => s + a.won, 0) / totalMeetings) * 100)
    : 0;

  function formatAvgTime(hours: number) {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  return (
    <>
      <Header
          title="Agent Performance"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard
            label="Avg Time to Apply"
            value={formatAvgTime(avgHours)}
            variant="accent"
          />
          <StatCard label="Total Proposals" value={totalProposals} delta="This period" />
          <StatCard
            label="Meetings Booked"
            value={totalMeetings}
            variant="warn"
            delta={`${totalProposals > 0 ? Math.round((totalMeetings / totalProposals) * 100) : 0}% booking rate`}
          />
          <StatCard
            label="Total Wins"
            value={totalWins}
            variant="green"
            delta={`${negotiationRate}% close rate`}
          />
          <StatCard
            label="Negotiation Rate"
            value={`${negotiationRate}%`}
            delta="Meetings → won"
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
