import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConversionFunnel } from "@/components/overview/conversion-funnel";
import { PipelineNow } from "@/components/overview/pipeline-now";
import { TopProfilesTable } from "@/components/overview/top-profiles-table";
import { AgentLeaderboard } from "@/components/overview/agent-leaderboard";
import { LiveJobFeed } from "@/components/overview/live-job-feed";
import {
  getKPIMetricsWithDeltas,
  getConversionFunnel,
  getPipelineNow,
  getEnhancedAgentStats,
  getEnhancedProfileStats,
  getAllAgents,
  getAllProfiles,
  getJobs,
} from "@/lib/data";

export const revalidate = 300;

function parseDays(range?: string): number {
  if (range === "all") return 365 * 5;
  if (range === "30") return 30;
  return 7;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const days = parseDays(params.range);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const range = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };

  const [kpi, funnel, pipeline, agents, profiles, allAgents, allProfiles, recentJobs] = await Promise.all([
    getKPIMetricsWithDeltas(days),
    getConversionFunnel(range),
    getPipelineNow(),
    getEnhancedAgentStats(range),
    getEnhancedProfileStats(range),
    getAllAgents(),
    getAllProfiles(),
    getJobs({ limit: 10, sortBy: "received_at", sortDir: "desc" }),
  ]);

  const topProfiles = [...profiles]
    .sort((a, b) => b.interview_rate - a.interview_rate)
    .slice(0, 5);

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <>
      <Header
          title="Dashboard Overview"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard
            label="Jobs Received"
            value={kpi.totalJobs}
            variant="accent"
            delta={`${fmt(kpi.deltaJobs)} vs last period`}
            deltaDown={kpi.deltaJobs < 0}
          />
          <StatCard
            label="Proposals Sent"
            value={kpi.proposalsSent}
            delta={`${fmt(kpi.deltaProposals)} vs last period`}
            deltaDown={kpi.deltaProposals < 0}
          />
          <StatCard
            label="Meetings Booked"
            value={kpi.meetingsBooked}
            variant="warn"
            delta={`${fmt(kpi.deltaMeetings)} vs last period`}
            deltaDown={kpi.deltaMeetings < 0}
          />
          <StatCard
            label="Jobs Won"
            value={kpi.won}
            variant="green"
            delta={`${fmt(kpi.deltaWon)} vs last period`}
            deltaDown={kpi.deltaWon < 0}
          />
          <StatCard
            label="Win Rate"
            value={`${kpi.winRate}%`}
            variant="accent"
            delta={`${fmt(kpi.deltaWinRate)}% vs last period`}
            deltaDown={kpi.deltaWinRate < 0}
          />
        </StatRow>

        <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <ConversionFunnel steps={funnel} />
          <PipelineNow stages={pipeline} />
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <TopProfilesTable profiles={topProfiles} />
          <AgentLeaderboard agents={agents} />
        </div>

        <LiveJobFeed jobs={recentJobs.data} />
      </main>
    </>
  );
}
