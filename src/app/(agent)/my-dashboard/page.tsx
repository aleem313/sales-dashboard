import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConversionFunnel } from "@/components/overview/conversion-funnel";
import { PipelineNow } from "@/components/overview/pipeline-now";
import { WinRateTrend } from "@/components/charts";
import { AlertsBanner } from "@/components/alerts-banner";
import {
  getKPIMetricsWithDeltas,
  getAvgResponseTime,
  getConversionFunnel,
  getPipelineNow,
  getAgentWinRateTrend,
  getJobs,
  getActiveAlerts,
  getAllProfiles,
} from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { KPIMetricDrillDown } from "@/components/dashboard/kpi-metric-drilldown";
import { ResponseTimeDrillDown } from "@/components/dashboard/response-time-drilldown";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const revalidate = 300;

export default async function MyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string; profile?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);
  const profileId = params.profile || undefined;

  const [kpi, avgResponseTime, funnel, pipeline, winRateTrend, recentJobs, alerts, allProfiles] = await Promise.all([
    getKPIMetricsWithDeltas(range, agentId, profileId),
    getAvgResponseTime(range, agentId, profileId),
    getConversionFunnel(range, agentId, profileId),
    getPipelineNow(agentId, profileId),
    getAgentWinRateTrend(agentId),
    getJobs({ agent_id: agentId, profile_id: profileId, startDate: range.startDate, endDate: range.endDate, limit: 10, sortBy: "received_at", sortDir: "desc" }),
    getActiveAlerts(),
    getAllProfiles(),
  ]);
  const agentProfiles = allProfiles.filter((p) => p.agent_id === agentId);

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

  function formatAvgTime(hours: number | null) {
    if (hours === null) return "—";
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  return (
    <>
      <Header title="My Dashboard" profiles={agentProfiles} hideAgentFilter />
      <div className="container mx-auto px-4 py-6 space-y-6 flex-1 overflow-y-auto">
        <AutoRefresh interval={15000} />

      <AlertsBanner alerts={alerts} />

      <StatRow className="lg:!grid-cols-8">
        <KPIMetricDrillDown
          metric="total_jobs"
          label="Jobs Received"
          value={kpi.totalJobs}
          variant="accent"
          delta={`${fmt(kpi.deltaJobs)} ${vsLabel}`}
          deltaDown={kpi.deltaJobs < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <KPIMetricDrillDown
          metric="proposals_sent"
          label="Proposals Sent"
          value={kpi.proposalsSent}
          subtitle={kpi.totalJobs > 0 ? `${Math.round((kpi.proposalsSent / kpi.totalJobs) * 100)}%` : undefined}
          delta={`${fmt(kpi.deltaProposals)} ${vsLabel}`}
          deltaDown={kpi.deltaProposals < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <KPIMetricDrillDown
          metric="untouched"
          label="Un Touched"
          value={kpi.untouched}
          subtitle={kpi.totalJobs > 0 ? `${Math.round((kpi.untouched / kpi.totalJobs) * 100)}%` : undefined}
          variant="warn"
          delta={`${fmt(kpi.deltaUntouched)} ${vsLabel}`}
          deltaDown={kpi.deltaUntouched < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <KPIMetricDrillDown
          metric="meetings_booked"
          label="Meetings Booked"
          value={kpi.meetingsBooked}
          variant="warn"
          delta={`${fmt(kpi.deltaMeetings)} ${vsLabel}`}
          deltaDown={kpi.deltaMeetings < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <KPIMetricDrillDown
          metric="won"
          label="Jobs Won"
          value={kpi.won}
          variant="green"
          delta={`${fmt(kpi.deltaWon)} ${vsLabel}`}
          deltaDown={kpi.deltaWon < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <StatCard
          label="Win Rate"
          value={`${kpi.winRate}%`}
          variant="accent"
          delta={`${fmt(kpi.deltaWinRate)}% ${vsLabel}`}
          deltaDown={kpi.deltaWinRate < 0}
        />
        <ResponseTimeDrillDown
          label="Response time to apply"
          value={formatAvgTime(avgResponseTime)}
          variant={avgResponseTime !== null && avgResponseTime <= 0.25 ? "green" : avgResponseTime !== null && avgResponseTime <= 1 ? "warn" : "danger"}
          delta="Typical proposal response time"
          searchParams={params}
          taskRoute="/my-tasks"
        />
        <KPIMetricDrillDown
          metric="bad_leads"
          label="Bad Leads"
          value={kpi.badLeads}
          subtitle={kpi.totalJobs > 0 ? `${Math.round((kpi.badLeads / kpi.totalJobs) * 100)}%` : undefined}
          variant="danger"
          delta={`${fmt(kpi.deltaBadLeads)} ${vsLabel}`}
          deltaDown={kpi.deltaBadLeads < 0}
          searchParams={params}
          taskRoute="/my-tasks"
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ConversionFunnel steps={funnel.filter((s) => s.label !== "Passed Filter")} />
        <PipelineNow stages={pipeline} />
      </div>

      <WinRateTrend data={winRateTrend} />

      <div className="rounded-xl border bg-card">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium">Recent Jobs</h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentJobs.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No jobs assigned yet.
                  </TableCell>
                </TableRow>
              ) : (
                recentJobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-xs truncate font-medium">
                      {job.job_title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.outcome ? (
                        <Badge
                          variant={
                            job.outcome === "won"
                              ? "default"
                              : job.outcome === "lost"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {job.outcome}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(job.received_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
    </>
  );
}
