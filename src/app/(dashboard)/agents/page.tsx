import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { KPIMetricDrillDown } from "@/components/dashboard/kpi-metric-drilldown";
import { ResponseTimeDrillDown } from "@/components/dashboard/response-time-drilldown";
import { AgentDetailCard } from "@/components/agents/agent-detail-card";
import { CreateAgentButton } from "@/components/agents/create-agent-button";
import {
  getEnhancedAgentStats,
  getKPIMetricsWithDeltas,
  getAgentWeeklyActivity,
  getAvgResponseTime,
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

  const [agents, kpi, avgResponseTime, allAgents, allProfiles] = await Promise.all([
    getEnhancedAgentStats(range, agentId, profileId),
    getKPIMetricsWithDeltas(range, agentId, profileId),
    // Same source as the dashboard "Response time to apply" card, so the two
    // pages agree: median, both halves of the funnel, n/a excluded.
    getAvgResponseTime(range, agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

  // Fetch weekly activity for all agents in parallel
  const weeklyActivities = await Promise.all(
    agents.map((a) => getAgentWeeklyActivity(a.id))
  );

  function formatAvgTime(hours: number | null) {
    if (hours === null || hours === 0) return "—";
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  // Stage-based win rates: of every proposal sent / meeting booked, what % became
  // a win. Distinct from the headline "Win Rate" (won / (won + lost), decided deals
  // only). Guard zero denominators -> "—" (avoid 0% reading and divide-by-zero).
  const pct = (num: number, denom: number) =>
    denom > 0 ? `${Math.round((num / denom) * 1000) / 10}%` : "—";

  const winRateProposals = pct(kpi.won, kpi.proposalsSent); // won / proposals sent
  const winRateMeetings = pct(kpi.won, kpi.meetingsBooked); // won / meetings booked

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
        <StatRow className="mb-5 lg:!grid-cols-7">
          <ResponseTimeDrillDown
            label="Avg Time to Apply"
            value={formatAvgTime(avgResponseTime)}
            variant={
              avgResponseTime !== null && avgResponseTime <= 0.25
                ? "green"
                : avgResponseTime !== null && avgResponseTime <= 1
                  ? "warn"
                  : avgResponseTime === null
                    ? "default"
                    : "danger"
            }
            delta="Typical proposal response time"
            searchParams={params}
          />
          <KPIMetricDrillDown
            metric="proposals_sent"
            label="Proposals Sent"
            value={kpi.proposalsSent}
            delta={`${fmt(kpi.deltaProposals)} ${vsLabel}`}
            deltaDown={kpi.deltaProposals < 0}
            searchParams={params}
          />
          <KPIMetricDrillDown
            metric="meetings_booked"
            label="Meetings Booked"
            value={kpi.meetingsBooked}
            variant="warn"
            delta={`${fmt(kpi.deltaMeetings)} ${vsLabel}`}
            deltaDown={kpi.deltaMeetings < 0}
            searchParams={params}
          />
          <KPIMetricDrillDown
            metric="won"
            label="Jobs Won"
            value={kpi.won}
            variant="green"
            delta={`${fmt(kpi.deltaWon)} ${vsLabel}`}
            deltaDown={kpi.deltaWon < 0}
            searchParams={params}
          />
          <StatCard
            label="Win Rate"
            value={`${kpi.winRate}%`}
            variant="accent"
            delta={`${fmt(kpi.deltaWinRate)}% ${vsLabel}`}
            deltaDown={kpi.deltaWinRate < 0}
          />
          <StatCard
            label="Win Rate (Proposals)"
            value={winRateProposals}
            subtitle={`${kpi.won} / ${kpi.proposalsSent}`}
            variant="accent"
          />
          <StatCard
            label="Win Rate (Meetings)"
            value={winRateMeetings}
            subtitle={`${kpi.won} / ${kpi.meetingsBooked}`}
            variant="accent"
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
