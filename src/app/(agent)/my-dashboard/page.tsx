import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { KPICards } from "@/components/kpi-cards";
import { ConversionFunnel } from "@/components/overview/conversion-funnel";
import { PipelineNow } from "@/components/overview/pipeline-now";
import { WinRateTrend } from "@/components/charts";
import { AlertsBanner } from "@/components/alerts-banner";
import {
  getAgentKPIMetrics,
  getConversionFunnel,
  getPipelineNow,
  getAgentWinRateTrend,
  getJobs,
  getActiveAlerts,
} from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
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
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [kpi, funnel, pipeline, winRateTrend, recentJobs, alerts] = await Promise.all([
    getAgentKPIMetrics(agentId, range),
    getConversionFunnel(range, agentId),
    getPipelineNow(agentId),
    getAgentWinRateTrend(agentId),
    getJobs({ agent_id: agentId, startDate: range.startDate, endDate: range.endDate, limit: 10, sortBy: "received_at", sortDir: "desc" }),
    getActiveAlerts(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your personal performance overview.
        </p>
      </div>

      <Separator />

      <AlertsBanner alerts={alerts} />

      <KPICards metrics={kpi} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ConversionFunnel steps={funnel} />
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
                      <Badge variant="outline">{job.clickup_status}</Badge>
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
  );
}
