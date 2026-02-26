import { notFound } from "next/navigation";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAgentById,
  getJobs,
  getAgentStats,
  getAgentWinRateTrend,
  getResponseTimeDistribution,
} from "@/lib/data";
import { formatCurrency, formatPercent, formatHours, formatDate, formatNumber } from "@/lib/utils";
import { WinRateTrend } from "@/components/charts/win-rate-trend";
import { ResponseTimeChart } from "@/components/charts/response-time-chart";

export const revalidate = 60;

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [agent, agentStatsAll, recentJobs, winRateTrend, responseTimeDist] =
    await Promise.all([
      getAgentById(id),
      getAgentStats(),
      getJobs({ agent_id: id, limit: 15 }),
      getAgentWinRateTrend(id),
      getResponseTimeDistribution(id),
    ]);

  if (!agent) notFound();

  const stats = agentStatsAll.find((a) => a.id === id);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold">
          {agent.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            <Badge variant={agent.active ? "default" : "secondary"}>
              {agent.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          {agent.email && (
            <p className="text-sm text-muted-foreground">{agent.email}</p>
          )}
        </div>
      </div>

      <Separator />

      {/* KPI Row */}
      {stats && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total Jobs", value: formatNumber(stats.total_jobs) },
            { label: "Proposals Sent", value: formatNumber(stats.proposals_sent) },
            { label: "Won", value: String(stats.won) },
            { label: "Win Rate", value: stats.win_rate_pct !== null ? formatPercent(stats.win_rate_pct) : "—" },
            { label: "Avg Response", value: formatHours(stats.avg_response_hours) },
            { label: "Revenue", value: formatCurrency(stats.total_revenue) },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-bold">{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <WinRateTrend data={winRateTrend} />
        <ResponseTimeChart data={responseTimeDist} />
      </div>

      {/* Assigned Profiles */}
      {agent.profiles.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Assigned Profiles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {agent.profiles.map((p) => (
                <Link key={p.id} href={`/profiles/${p.id}`}>
                  <Badge variant="outline" className="hover:bg-muted cursor-pointer">
                    {p.profile_name}
                    {p.stack && <span className="ml-1 text-muted-foreground">({p.stack})</span>}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Jobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Recent Jobs ({recentJobs.total} total)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs assigned yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="hidden sm:table-cell">Profile</TableHead>
                  <TableHead className="hidden md:table-cell">Budget</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="font-medium max-w-[250px] truncate">
                        {job.job_title}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {(job as unknown as Record<string, unknown>).profile_name as string ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {job.budget_max ? formatCurrency(job.budget_max) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.outcome === "won"
                            ? "default"
                            : job.outcome === "lost"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {job.outcome ?? job.clickup_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {formatDate(job.received_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
