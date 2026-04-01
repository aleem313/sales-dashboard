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
  Shield,
  Globe,
  Star,
  Users,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/types";

type JobWithMeta = Job & { agent_name?: string | null; profile_name?: string | null };

interface JobDetailsProps {
  job: JobWithMeta | null;
  loading?: boolean;
  error?: string | null;
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

export function JobDetails({ job, loading, error }: JobDetailsProps) {
  const [descExpanded, setDescExpanded] = useState(true);
  const [payloadExpanded, setPayloadExpanded] = useState(false);

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

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Briefcase className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No job linked</p>
        <p className="text-xs mt-1">Link a job to view details here</p>
      </div>
    );
  }

  const budget =
    job.budget_type === "fixed"
      ? job.budget_min != null && job.budget_max != null
        ? job.budget_min === job.budget_max
          ? `$${job.budget_min}`
          : `$${job.budget_min} - $${job.budget_max}`
        : job.budget_max != null
          ? `$${job.budget_max}`
          : "Not specified"
      : job.hourly_min != null || job.hourly_max != null
        ? `$${job.hourly_min ?? "?"} - $${job.hourly_max ?? "?"}/hr`
        : "Not specified";

  return (
    <div className="space-y-4">
      {/* Job Title + Action Buttons */}
      <div>
        <h3 className="text-sm font-semibold leading-snug mb-2 line-clamp-3">
          {job.job_title}
        </h3>
        <div className="flex items-center gap-2">
          {job.job_url && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => window.open(job.job_url!, "_blank")}
            >
              <ExternalLink className="h-3 w-3" />
              View Job
            </Button>
          )}
          {job.job_url && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => copyToClipboard(job.job_url!, "Job URL")}
            >
              <Copy className="h-3 w-3" />
              Copy URL
            </Button>
          )}
        </div>
      </div>

      {/* Structured Fields */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
        <InfoRow icon={<DollarSign className="h-3.5 w-3.5" />} label="Budget">
          <span className="font-medium">{budget}</span>
        </InfoRow>

        <InfoRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Job Type">
          <span className="capitalize">{job.budget_type ?? "Not specified"}</span>
        </InfoRow>

        {job.posted_at && (
          <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Posted">
            <span>
              {formatDistanceToNow(new Date(job.posted_at), { addSuffix: true })}
              <span className="text-xs text-muted-foreground ml-1.5">
                ({format(new Date(job.posted_at), "MMM d, yyyy h:mm a")})
              </span>
            </span>
          </InfoRow>
        )}

        {job.client_country && (
          <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location">
            <span>{job.client_country}</span>
          </InfoRow>
        )}

        <InfoRow icon={<Shield className="h-3.5 w-3.5" />} label="Payment">
          <span className={job.client_total_spent && job.client_total_spent > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
            {job.client_total_spent != null ? `$${job.client_total_spent.toLocaleString()} spent` : "Not verified"}
          </span>
        </InfoRow>

        {job.client_rating != null && (
          <InfoRow icon={<Star className="h-3.5 w-3.5" />} label="Rating">
            <span>{job.client_rating.toFixed(1)} / 5.0</span>
          </InfoRow>
        )}

        {job.client_hires != null && (
          <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Hires">
            <span>{job.client_hires} hires</span>
          </InfoRow>
        )}

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

        {job.agent_name && (
          <InfoRow icon={<Users className="h-3.5 w-3.5" />} label="Agent">
            <span>{job.agent_name}</span>
          </InfoRow>
        )}

        {job.profile_name && (
          <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="Profile">
            <span>{job.profile_name}</span>
          </InfoRow>
        )}
      </div>

      {/* Skills */}
      {job.skills && job.skills.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Skills</p>
          <div className="flex flex-wrap gap-1">
            {job.skills.map((skill, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Job Description */}
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
            {job.job_description ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{job.job_description}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description available</p>
            )}
          </div>
        )}
      </div>

      {/* Client Raw Payload */}
      <div>
        <button
          onClick={() => setPayloadExpanded(!payloadExpanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
        >
          {payloadExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Client Payload (JSON)
        </button>
        {payloadExpanded && (
          <div className="rounded-lg border bg-muted/20 p-3 max-h-[250px] overflow-y-auto">
            <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(
                {
                  job_url: job.job_url,
                  budget: budget,
                  budget_type: job.budget_type,
                  posted_at: job.posted_at,
                  client_country: job.client_country,
                  client_total_spent: job.client_total_spent,
                  client_rating: job.client_rating,
                  client_hires: job.client_hires,
                  skills: job.skills,
                  outcome: job.outcome,
                  clickup_status: job.clickup_status,
                  gpt_model: job.gpt_model,
                  gpt_tokens_used: job.gpt_tokens_used,
                },
                null,
                2
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
