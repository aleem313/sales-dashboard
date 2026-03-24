import type { Job } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

type SlowJob = Job & {
  agent_name: string | null;
  profile_name: string | null;
  response_minutes: number;
};

function formatWaitTime(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function SlowResponseAlert({ jobs }: { jobs: SlowJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <div className="mb-5 rounded-[10px] border border-destructive/30 bg-destructive/5">
      <div className="flex items-center justify-between border-b border-destructive/20 px-[18px] py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <h3 className="font-heading text-[15px] font-bold tracking-[0.03em] text-destructive">
            Slow Response — {jobs.length} job{jobs.length > 1 ? "s" : ""} waiting &gt; 15 min
          </h3>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Job Title
              </th>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Agent
              </th>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Profile
              </th>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Status
              </th>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Waiting
              </th>
              <th className="border-b border-destructive/15 px-3 py-2 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-destructive/5">
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] font-semibold max-w-[300px] truncate">
                  {job.job_title}
                </td>
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] text-muted-foreground">
                  {job.agent_name ?? "—"}
                </td>
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] text-muted-foreground">
                  {job.profile_name ?? "—"}
                </td>
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] text-muted-foreground">
                  {job.clickup_status}
                </td>
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] font-bold text-destructive">
                  {formatWaitTime(job.response_minutes)}
                </td>
                <td className="border-b border-destructive/10 px-3 py-2 text-[13.5px] text-muted-foreground">
                  {formatRelativeTime(job.received_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
