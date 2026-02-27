"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SquareArrowOutUpRight, ShieldCheck } from "lucide-react";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/utils";
import { countryFlag } from "@/lib/country-flags";
import type { Job } from "@/lib/types";

const statusStyles: Record<string, string> = {
  won: "bg-accent-green/15 text-accent-green border-accent-green/25",
  lost: "bg-destructive/15 text-destructive border-destructive/25",
  skipped: "bg-muted text-muted-foreground border-border",
  "Following Up": "bg-accent-warn/15 text-accent-warn border-accent-warn/25",
  Sent: "bg-primary/15 text-primary border-primary/25",
  pending: "bg-accent-purple/15 text-accent-purple border-accent-purple/25",
};

function StatusBadge({ outcome, status }: { outcome: string | null; status: string }) {
  const label = outcome ?? status;
  const key = outcome ?? status;
  const style = statusStyles[key] ?? "bg-muted text-muted-foreground border-border";
  return <Badge className={style}>{label}</Badge>;
}

type JobRow = Job & { agent_name?: string | null; profile_name?: string | null };

export function JobTable({ jobs, compact }: { jobs: JobRow[]; compact?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const colSpan = compact ? 8 : 9;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="hidden sm:table-cell">Profile</TableHead>
          <TableHead className="hidden sm:table-cell">Agent</TableHead>
          <TableHead className="hidden md:table-cell">Client</TableHead>
          <TableHead className="hidden md:table-cell">Hourly</TableHead>
          <TableHead className="hidden md:table-cell">Fixed</TableHead>
          {!compact && <TableHead>Status</TableHead>}
          <TableHead className="hidden lg:table-cell">Received</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const isHourly = !!(job.hourly_min || job.hourly_max);
          const isFixed = !!job.budget_max;

          return (
            <>
              <TableRow
                key={job.id}
                className="cursor-pointer"
                onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
              >
                <TableCell>
                  <div className="font-medium max-w-[280px] truncate">{job.job_title}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">
                  {job.profile_name ?? "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">
                  {job.agent_name ?? "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    {job.client_country && (
                      <span title={job.client_country}>{countryFlag(job.client_country)}</span>
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {job.client_country ?? "—"}
                      </span>
                      <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
                        {job.client_hires != null && job.client_hires > 0 && (
                          <span>{job.client_hires} hires</span>
                        )}
                        {job.client_total_spent != null && job.client_total_spent > 0 && (
                          <span className="flex items-center gap-0.5">
                            <ShieldCheck className="h-3 w-3 text-accent-green" />
                            verified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {isHourly ? (
                    <span>${job.hourly_min ?? 0}–${job.hourly_max ?? 0}/hr</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {isFixed ? (
                    <span>{formatCurrency(job.budget_min ?? 0)} – {formatCurrency(job.budget_max!)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                {!compact && (
                  <TableCell>
                    <StatusBadge outcome={job.outcome} status={job.clickup_status} />
                  </TableCell>
                )}
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {formatRelativeTime(job.received_at)}
                </TableCell>
                <TableCell>
                  {job.job_url && (
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground inline-flex"
                      title="Open on Upwork"
                    >
                      <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </TableCell>
              </TableRow>

              {expandedId === job.id && (
                <TableRow key={`${job.id}-detail`}>
                  <TableCell colSpan={colSpan} className="bg-muted/30">
                    <JobDetail job={job} />
                  </TableCell>
                </TableRow>
              )}
            </>
          );
        })}
        {jobs.length === 0 && (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
              No jobs found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function JobDetail({ job }: { job: JobRow }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 py-2">
      {/* Timeline */}
      <Card>
        <CardContent className="pt-4 space-y-2 text-sm">
          <h4 className="font-semibold text-xs uppercase text-muted-foreground">Timeline</h4>
          <div className="space-y-1">
            {job.posted_at && (
              <p>Posted: {formatDate(job.posted_at)}</p>
            )}
            <p>Received: {formatDate(job.received_at)}</p>
            {job.proposal_sent_at && (
              <p>Proposal Sent: {formatDate(job.proposal_sent_at)}</p>
            )}
            {job.outcome_at && (
              <p>
                Outcome ({job.outcome}): {formatDate(job.outcome_at)}
              </p>
            )}
            {job.won_value && (
              <p className="font-medium">Contract Value: {formatCurrency(job.won_value)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Client Details */}
      <Card>
        <CardContent className="pt-4 space-y-2 text-sm">
          <h4 className="font-semibold text-xs uppercase text-muted-foreground">Client</h4>
          <div className="space-y-1">
            {job.client_country && (
              <p>{countryFlag(job.client_country)} {job.client_country}</p>
            )}
            {job.client_rating && <p>Rating: {job.client_rating}/5</p>}
            {job.client_total_spent != null && (
              <p className="flex items-center gap-1">
                Total Spent: {formatCurrency(job.client_total_spent)}
                {job.client_total_spent > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-accent-green/10 px-1.5 py-0.5 text-[13.5px] font-medium text-accent-green">
                    <ShieldCheck className="h-3 w-3" /> Payment Verified
                  </span>
                )}
              </p>
            )}
            {job.client_hires != null && <p>Previous Hires: {job.client_hires}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Skills */}
      {job.skills && job.skills.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2 text-sm">
            <h4 className="font-semibold text-xs uppercase text-muted-foreground">Skills</h4>
            <div className="flex flex-wrap gap-1">
              {job.skills.map((s) => (
                <Badge key={s} variant="outline" className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proposal */}
      {job.proposal_text && (
        <Card>
          <CardContent className="pt-4 space-y-2 text-sm">
            <h4 className="font-semibold text-xs uppercase text-muted-foreground">
              Proposal {job.gpt_model && `(${job.gpt_model})`}
            </h4>
            <p className="whitespace-pre-wrap text-muted-foreground line-clamp-4">
              {job.proposal_text}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Links */}
      <div className="flex gap-2 md:col-span-2">
        {job.job_url && (
          <a
            href={job.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            View on Upwork &rarr;
          </a>
        )}
        {job.clickup_task_url && (
          <a
            href={job.clickup_task_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            View in ClickUp &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
