import type { PipelineJob } from "@/lib/types";
import { CyberBadge } from "@/components/ui/cyber-badge";

interface PipelineTableProps {
  jobs: PipelineJob[];
}

const statusBadgeVariant = (status: string) => {
  if (["Negotiation", "Won"].includes(status)) return "green" as const;
  if (["Meeting Scheduled", "Meeting Done"].includes(status)) return "warn" as const;
  if (["Lost"].includes(status)) return "danger" as const;
  if (["Submitted", "Sent", "To Do", "New"].includes(status)) return "blue" as const;
  return "muted" as const;
};

const priorityBadgeVariant = (priority: string) => {
  if (priority === "high") return "danger" as const;
  if (priority === "medium") return "warn" as const;
  return "muted" as const;
};

export function PipelineTable({ jobs }: PipelineTableProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[13px] font-bold tracking-[0.03em]">
          Active Jobs in Pipeline
        </h3>
        <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
          Sorted by stage
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Job Title", "Profile", "Agent", "Stage", "Time in Stage", "Priority"].map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-border px-3 py-2.5 text-left text-[9px] font-normal uppercase tracking-[0.15em] text-muted-foreground"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-secondary">
                <td className="border-b border-border px-3 py-2.5 text-[11px] font-semibold">
                  {job.job_title}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[11px]">
                  {job.profile_name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[11px]">
                  {job.agent_name || "—"}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[11px]">
                  <CyberBadge variant={statusBadgeVariant(job.clickup_status)}>
                    {job.clickup_status}
                  </CyberBadge>
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[11px] text-accent-green">
                  {job.time_in_stage}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[11px]">
                  <CyberBadge variant={priorityBadgeVariant(job.priority)}>
                    {job.priority.toUpperCase()}
                  </CyberBadge>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[11px] text-muted-foreground"
                >
                  No active jobs in pipeline
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
