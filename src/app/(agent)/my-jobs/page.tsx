import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
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
    status: params.status || undefined,
    limit: 50,
    sortBy: "received_at",
    sortDir: "desc",
  });

  return (
    <>
      <Header title="My Jobs" hideFilters />
      <div className="container mx-auto px-4 py-6 space-y-6 flex-1 overflow-y-auto">

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
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {job.proposal_sent_at
                        ? new Date(job.proposal_sent_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {!job.proposal_sent_at && job.status === "Proposal Ready" && (
                        <MarkAsSentButton
                          jobId={job.id}
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
    </>
  );
}
