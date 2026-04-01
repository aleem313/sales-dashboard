"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ExternalLink,
  Copy,
  MapPin,
  DollarSign,
  Clock,
  Briefcase,
  Globe,
  Star,
  Users,
  Loader2,
  ChevronDown,
  ChevronRight,
  Link2,
  User,
  FolderOpen,
  Hash,
  Bot,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/types";

type JobWithMeta = Job & { agent_name?: string | null; profile_name?: string | null };

interface JobDetailsProps {
  job: JobWithMeta | null;
  loading?: boolean;
  error?: string | null;
  customFields?: Record<string, unknown> | null;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

function InfoRow({ icon, label, children, className }: { icon: React.ReactNode; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 py-1.5", className)}>
      <span className="text-muted-foreground shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-muted-foreground w-[100px] shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function JobDetails({ job, loading, error, customFields }: JobDetailsProps) {
  const [descExpanded, setDescExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-2" />
        <p className="text-sm">Loading job details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // If we have a linked job from DB, use it. Otherwise read from custom_fields.
  const cf = customFields ?? {};
  const hasJob = !!job;
  const hasCustomFields = !!(cf._source === "n8n" || cf._job_url || cf._budget);

  if (!hasJob && !hasCustomFields) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Briefcase className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No job linked</p>
        <p className="text-xs mt-1">Link a job to view details here</p>
      </div>
    );
  }

  // Resolve field values — prefer DB job data, fall back to custom_fields
  const jobUrl = job?.job_url ?? (cf._job_url as string) ?? "";
  const jobTitle = job?.job_title ?? "";
  const jobId = job?.job_id ?? (cf._job_id as string) ?? "";

  const budget = hasJob
    ? (job.budget_type === "fixed"
      ? job.budget_min != null && job.budget_max != null
        ? job.budget_min === job.budget_max ? `$${job.budget_min}` : `$${job.budget_min} - $${job.budget_max}`
        : job.budget_max != null ? `$${job.budget_max}` : "Not specified"
      : job.hourly_min != null || job.hourly_max != null
        ? `$${job.hourly_min ?? "?"} - $${job.hourly_max ?? "?"}/hr`
        : "Not specified")
    : (cf._budget ? String(cf._budget) : "Not specified");

  const skills: string[] = hasJob
    ? (job.skills ?? [])
    : (Array.isArray(cf._skills) ? cf._skills as string[] : []);

  const postedDate = job?.posted_at
    ? format(new Date(job.posted_at), "MMM d, yyyy")
    : null;

  const clientCountry = job?.client_country ?? (cf._client_country as string) ?? "";
  const clientRating = job?.client_rating ?? (cf._client_rating ? parseFloat(String(cf._client_rating)) : null);
  const clientSpent = job?.client_total_spent ?? (cf._client_spent ? parseFloat(String(cf._client_spent).replace(/[^0-9.]/g, "")) : null);
  const clientHires = job?.client_hires ?? (cf._client_hires ? parseInt(String(cf._client_hires)) : null);

  const agentName = job?.agent_name ?? (cf._assigned_agent as string) ?? "";
  const profileName = job?.profile_name ?? (cf._profile_name as string) ?? "";

  // Rating display
  const ratingDisplay = clientRating != null && !isNaN(clientRating) && clientRating > 0
    ? `${"★".repeat(Math.round(clientRating))}${"☆".repeat(5 - Math.round(clientRating))} (${clientRating}/5)`
    : "No rating yet";

  // Client spend display
  const spentDisplay = clientSpent != null && clientSpent > 0
    ? clientSpent >= 1000 ? `$${(clientSpent / 1000).toFixed(0)}k+` : `$${clientSpent}`
    : "New client";

  // Hires display
  const hiresDisplay = clientHires != null && clientHires > 0 ? `${clientHires}` : "No hires yet";

  return (
    <div className="space-y-5">
      {/* Job Title + Action Buttons */}
      {jobTitle && (
        <div>
          <h3 className="text-sm font-semibold leading-snug mb-2 line-clamp-3">{jobTitle}</h3>
          <div className="flex items-center gap-2">
            {jobUrl && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => window.open(jobUrl, "_blank")}>
                <ExternalLink className="h-3 w-3" />
                View Job
              </Button>
            )}
            {jobUrl && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(jobUrl, "Job URL")}>
                <Copy className="h-3 w-3" />
                Copy URL
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ═══ JOB DETAILS Section ═══ */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5" />
          Job Details
        </h4>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
          {jobUrl && (
            <InfoRow icon={<Link2 className="h-3.5 w-3.5" />} label="Job Link">
              <a href={jobUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs truncate block">
                View on Upwork
              </a>
            </InfoRow>
          )}
          <InfoRow icon={<DollarSign className="h-3.5 w-3.5" />} label="Budget">
            <span className="font-medium">{budget}</span>
          </InfoRow>
          {skills.length > 0 && (
            <InfoRow icon={<Layers className="h-3.5 w-3.5" />} label="Skills">
              <div className="flex flex-wrap gap-1">
                {skills.map((skill, i) => (
                  <span key={i} className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {skill}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}
          {(postedDate || job?.posted_at) && (
            <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Posted">
              <span>
                {postedDate}
                {job?.posted_at && (
                  <span className="text-xs text-muted-foreground ml-1.5">
                    ({formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })})
                  </span>
                )}
              </span>
            </InfoRow>
          )}
        </div>
      </div>

      {/* ═══ CLIENT INFO Section ═══ */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Client Info
        </h4>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
          <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location">
            <span>{clientCountry || "Not specified"}</span>
          </InfoRow>
          <InfoRow icon={<Star className="h-3.5 w-3.5" />} label="Rating">
            <span>{ratingDisplay}</span>
          </InfoRow>
          <InfoRow icon={<DollarSign className="h-3.5 w-3.5" />} label="Total Spent">
            <span className={clientSpent != null && clientSpent > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
              {spentDisplay}
            </span>
          </InfoRow>
          <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Past Hires">
            <span>{hiresDisplay}</span>
          </InfoRow>
        </div>
      </div>

      {/* ═══ ROUTING INFO Section ═══ */}
      {(agentName || profileName || jobId) && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            Routing Info
          </h4>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
            {agentName && (
              <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Agent">
                <span>{agentName}</span>
              </InfoRow>
            )}
            {profileName && (
              <InfoRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="Profile">
                <span>{profileName}</span>
              </InfoRow>
            )}
            {(cf._stack as string) && (
              <InfoRow icon={<Layers className="h-3.5 w-3.5" />} label="Stack">
                <span>{cf._stack as string}</span>
              </InfoRow>
            )}
            {jobId && (
              <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="Job ID">
                <span className="text-xs font-mono truncate block">{jobId}</span>
              </InfoRow>
            )}
            {(cf._generated as string) && (
              <InfoRow icon={<Bot className="h-3.5 w-3.5" />} label="Generated">
                <span className="text-xs">{cf._generated as string}</span>
              </InfoRow>
            )}
          </div>
        </div>
      )}

      {/* ═══ Status & Outcome (from DB job only) ═══ */}
      {hasJob && (job.clickup_status || job.outcome) && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            Status
          </h4>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
            {job.clickup_status && (
              <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="Status">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {job.clickup_status}
                </span>
              </InfoRow>
            )}
            {job.outcome && (
              <InfoRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Outcome">
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  job.outcome === "won" && "bg-green-500/15 text-green-600 dark:text-green-400",
                  job.outcome === "lost" && "bg-red-500/15 text-red-600 dark:text-red-400",
                  job.outcome === "pending" && "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
                  job.outcome === "skipped" && "bg-muted text-muted-foreground",
                )}>
                  {job.outcome}
                </span>
              </InfoRow>
            )}
          </div>
        </div>
      )}

      {/* Job Description (collapsible) */}
      {hasJob && job.job_description && (
        <div>
          <button
            onClick={() => setDescExpanded(!descExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
          >
            {descExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Job Description
          </button>
          {descExpanded && (
            <div className="rounded-lg border bg-muted/20 p-3 max-h-[300px] overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{job.job_description}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
