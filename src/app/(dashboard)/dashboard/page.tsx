import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConversionFunnel } from "@/components/overview/conversion-funnel";
import { PipelineNow } from "@/components/overview/pipeline-now";
import { TopProfilesTable } from "@/components/overview/top-profiles-table";
import { AgentLeaderboard } from "@/components/overview/agent-leaderboard";
import { JobTable } from "@/components/job-table";
import Link from "next/link";
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

import { parseDateRange, rangeToDays } from "@/lib/date-utils";

export const revalidate = 300;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; agent?: string; profile?: string }>;
}) {
  const params = await searchParams;
  const days = rangeToDays(params);
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const range = parseDateRange(params);

  const [kpi, funnel, pipeline, agents, profiles, allAgents, allProfiles, recentJobs] = await Promise.all([
    getKPIMetricsWithDeltas(days, agentId, profileId),
    getConversionFunnel(range, agentId, profileId),
    getPipelineNow(agentId, profileId),
    getEnhancedAgentStats(range, agentId, profileId),
    getEnhancedProfileStats(range, agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
    getJobs({ agent_id: agentId, profile_id: profileId, limit: 10, sortBy: "received_at", sortDir: "desc" }),
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

        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div>
              <h3 className="text-sm font-bold">Live Job Feed</h3>
              <p className="text-[13.5px] text-muted-foreground">
                Latest incoming jobs from Upwork
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[15px] text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse-glow" />
                Live
              </div>
              <Link
                href="/jobs"
                className="rounded-[7px] border border-border px-3 py-1 text-[15px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                View all
              </Link>
            </div>
          </div>
          <JobTable jobs={recentJobs.data} compact />
        </div>
      </main>
    </>
  );
}
