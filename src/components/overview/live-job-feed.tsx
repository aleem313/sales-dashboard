import Link from "next/link";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { countryFlag } from "@/lib/country-flags";
import type { Job } from "@/lib/types";

type FeedJob = Job & { profile_name?: string | null };

interface LiveJobFeedProps {
  jobs: FeedJob[];
}

function budgetLabel(job: FeedJob): string {
  if (job.budget_max) return `${formatCurrency(job.budget_min ?? 0)} – ${formatCurrency(job.budget_max)}`;
  if (job.hourly_min || job.hourly_max) return `$${job.hourly_min ?? 0}–$${job.hourly_max ?? 0}/hr`;
  return "—";
}

export function LiveJobFeed({ jobs }: LiveJobFeedProps) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h3 className="text-sm font-bold">Live Job Feed</h3>
          <p className="text-[13.5px] text-muted-foreground">
            Latest incoming jobs from Upwork via Vollna
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Job Title", "Budget", "Profile Match", "Client", "Received"].map((h) => (
                <th
                  key={h}
                  className="border-b border-border px-4 py-2.5 text-left text-[13.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-secondary/50">
                <td className="border-b border-border px-4 py-2.5 text-[15px] font-medium">
                  <div className="max-w-[300px] truncate">{job.job_title}</div>
                </td>
                <td className="border-b border-border px-4 py-2.5 font-mono-data text-[15px]">
                  {budgetLabel(job)}
                </td>
                <td className="border-b border-border px-4 py-2.5 text-[15px] text-muted-foreground">
                  {job.profile_name ?? "—"}
                </td>
                <td className="border-b border-border px-4 py-2.5 text-[15px]">
                  <div className="flex items-center gap-1.5">
                    {job.client_country && (
                      <span title={job.client_country}>{countryFlag(job.client_country)}</span>
                    )}
                    <span className="text-muted-foreground">
                      {job.client_country ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="border-b border-border px-4 py-2.5 text-[15px] text-muted-foreground">
                  {formatRelativeTime(job.received_at)}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[15px] text-muted-foreground">
                  Waiting for jobs…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
