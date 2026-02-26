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
import { getProfileById, getProfileStats, getJobs } from "@/lib/data";
import { formatCurrency, formatPercent, formatDate, formatNumber } from "@/lib/utils";

export const revalidate = 60;

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, allStats] = await Promise.all([
    getProfileById(id),
    getProfileStats(),
  ]);

  if (!profile) notFound();

  const [profileJobs, stats] = await Promise.all([
    getJobs({ profile_id: profile.profile_id, limit: 15 }),
    Promise.resolve(allStats.find((p) => p.id === id)),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{profile.profile_name}</h1>
          <Badge variant={profile.active ? "default" : "secondary"}>
            {profile.active ? "Active" : "Inactive"}
          </Badge>
        </div>
        {profile.stack && (
          <div className="flex flex-wrap gap-1 mt-2">
            {profile.stack.split(", ").map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
          {profile.agent && (
            <span>
              Agent:{" "}
              <Link
                href={`/agents/${profile.agent.id}`}
                className="text-foreground hover:underline"
              >
                {profile.agent.name}
              </Link>
            </span>
          )}
          {profile.vollna_filter_tag && (
            <span>Filter: {profile.vollna_filter_tag}</span>
          )}
        </div>
      </div>

      <Separator />

      {/* KPI Row */}
      {stats && (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          {[
            { label: "Total Jobs", value: formatNumber(stats.total_jobs) },
            { label: "Won", value: String(stats.won) },
            { label: "Win Rate", value: stats.win_rate_pct !== null ? formatPercent(stats.win_rate_pct) : "—" },
            { label: "Avg Won Value", value: stats.avg_won_value !== null ? formatCurrency(stats.avg_won_value) : "—" },
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

      {/* Recent Jobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Recent Jobs ({profileJobs.total} total)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profileJobs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs received for this profile yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead className="hidden sm:table-cell">Agent</TableHead>
                  <TableHead className="hidden md:table-cell">Budget</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profileJobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="font-medium max-w-[250px] truncate">
                        {job.job_title}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {(job as unknown as Record<string, unknown>).agent_name as string ?? "—"}
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
