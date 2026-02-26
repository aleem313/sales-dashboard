import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { getJobs } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MarkAsSentButton } from "@/components/mark-as-sent-button";

export const revalidate = 0;

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const params = await searchParams;
  const agentId = session.user.agentId;

  const jobs = await getJobs({
    agent_id: agentId,
    clickup_status: params.status || undefined,
    limit: 50,
    sortBy: "received_at",
    sortDir: "desc",
  });

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Jobs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your assigned jobs and proposal queue.
        </p>
      </div>

      <Separator />

      <div className="flex gap-2 flex-wrap">
        {["", "Proposal Ready", "Sent", "Following Up"].map((status) => (
          <a
            key={status}
            href={status ? `?status=${encodeURIComponent(status)}` : "?"}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              (params.status || "") === status
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted"
            }`}
          >
            {status || "All"}
          </a>
        ))}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="w-[100px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No jobs found.
                  </TableCell>
                </TableRow>
              ) : (
                jobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-xs truncate font-medium">
                      {job.job_url ? (
                        <a
                          href={job.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {job.job_title}
                        </a>
                      ) : (
                        job.job_title
                      )}
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
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {job.proposal_sent_at
                        ? new Date(job.proposal_sent_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {!job.proposal_sent_at && job.clickup_status === "Proposal Ready" && (
                        <MarkAsSentButton
                          jobId={job.id}
                          clickupTaskId={job.clickup_task_id}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {jobs.data.length} of {jobs.total} jobs
      </p>
    </div>
  );
}
