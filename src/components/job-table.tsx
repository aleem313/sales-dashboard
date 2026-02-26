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
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/utils";
import type { Job } from "@/lib/types";

function outcomeVariant(outcome: string | null, status: string) {
  if (outcome === "won") return "default" as const;
  if (outcome === "lost") return "destructive" as const;
  if (outcome === "skipped") return "outline" as const;
  if (status === "Following Up") return "secondary" as const;
  if (status === "Sent") return "secondary" as const;
  return "outline" as const;
}

type JobRow = Job & { agent_name?: string | null; profile_name?: string | null };

export function JobTable({ jobs }: { jobs: JobRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="hidden sm:table-cell">Profile</TableHead>
          <TableHead className="hidden md:table-cell">Agent</TableHead>
          <TableHead className="hidden md:table-cell">Budget</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell">Received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
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
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {job.agent_name ?? "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {job.budget_max
                  ? `${formatCurrency(job.budget_min ?? 0)} - ${formatCurrency(job.budget_max)}`
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={outcomeVariant(job.outcome, job.clickup_status)}>
                  {job.outcome ?? job.clickup_status}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {formatRelativeTime(job.received_at)}
              </TableCell>
            </TableRow>

            {expandedId === job.id && (
              <TableRow key={`${job.id}-detail`}>
                <TableCell colSpan={6} className="bg-muted/30">
                  <JobDetail job={job} />
                </TableCell>
              </TableRow>
            )}
          </>
        ))}
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
            {job.client_country && <p>Country: {job.client_country}</p>}
            {job.client_rating && <p>Rating: {job.client_rating}/5</p>}
            {job.client_total_spent && (
              <p>Total Spent: {formatCurrency(job.client_total_spent)}</p>
            )}
            {job.client_hires && <p>Hires: {job.client_hires}</p>}
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
