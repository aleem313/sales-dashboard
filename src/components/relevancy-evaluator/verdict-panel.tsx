"use client";

import { Copy, ExternalLink, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Verdict shape returned by the n8n job-evaluate-manual workflow. Mirrors
// plan v3.3 §8.4 + the C6 + J6 stages. Anything we render gracefully
// degrades when undefined so we don't crash on edge cases.
export interface Verdict {
  decision?: "proceed" | "reject" | "review";
  effective_decision?: "proceed" | "reject" | "review";
  threshold_flipped?: boolean;
  min_score_at_decision?: number | null;
  classifier_mode_at_decision?: "shadow" | "active" | null;
  tier?: string | null;
  total_score?: number | null;
  confidence?: number | null;
  confidence_warnings?: string[] | null;
  rejection_reasons?: string[] | null;
  gates_passed?: number[] | null;
  gates_failed?: number[] | null;
  gates_evidence?: Record<string, { status?: string; evidence?: string }> | null;
  components?: Record<string, { value?: number; reason?: string }> | null;
  proposal_angles?: string[] | null;
  summary?: string | null;
  missing_signals?: string[] | null;
  model?: string;
  prompt_version?: string;
  criteria_version?: string;
  _score_id?: number;
  request_meta?: {
    classifier_mode?: string;
    min_score?: number;
    source?: string;
    task_id?: string;
  } | null;
  // Hint surface for the "Card status today" footer block.
  task?: {
    current_column?: string | null;
    current_assignee_name?: string | null;
    created_at?: string | null;
  } | null;
}

const GATE_NAMES: Record<number, string> = {
  1: "Stack Match",
  2: "Job Freshness",
  3: "Proposal Saturation",
  4: "Hourly Rate Floor",
  5: "Client Spend Floor",
  6: "Client Rating Floor",
  7: "Job Availability",
  8: "Location Lock-in",
  9: "Video Proposal",
  10: "Portfolio Match",
  11: "Duplicate Check",
};

const COMPONENT_LABELS: Record<string, { label: string; max: number }> = {
  skill_match: { label: "Skill Match", max: 30 },
  portfolio_evidence: { label: "Portfolio Evidence", max: 20 },
  client_quality: { label: "Client Quality", max: 15 },
  competition_position: { label: "Competition Position", max: 10 },
  domain_match: { label: "Domain Match", max: 10 },
  experience_level_fit: { label: "Experience Fit", max: 10 },
  red_flags: { label: "Red Flags", max: 5 },
};

function decisionTone(d?: string): string {
  if (d === "proceed") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  if (d === "reject") return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
  if (d === "review") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-muted text-foreground";
}

function scoreTone(score?: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

function gateRow(
  gateId: number,
  status: "passed" | "failed" | "skipped" | "unknown",
  evidence: string | null
) {
  const icon =
    status === "passed" ? "✓" : status === "failed" ? "✗" : status === "skipped" ? "·" : "?";
  const tone =
    status === "passed"
      ? "text-emerald-600"
      : status === "failed"
        ? "text-rose-600"
        : "text-muted-foreground";
  return (
    <div
      key={gateId}
      className="grid grid-cols-[24px_24px_1fr_2fr] items-start gap-3 py-1.5 text-[13px]"
    >
      <span className={cn("font-mono font-bold", tone)}>{icon}</span>
      <span className="font-mono text-muted-foreground">{gateId}</span>
      <span className="font-medium">{GATE_NAMES[gateId] ?? `Gate ${gateId}`}</span>
      <span className="text-muted-foreground">{evidence ?? "—"}</span>
    </div>
  );
}

interface VerdictPanelProps {
  verdict: Verdict;
  taskId: string;
  onRerun: () => void;
  onCopyJson: () => void;
  rerunDisabled: boolean;
}

export function VerdictPanel({
  verdict,
  taskId,
  onRerun,
  onCopyJson,
  rerunDisabled,
}: VerdictPanelProps) {
  const effective = verdict.effective_decision ?? verdict.decision;
  const passed = new Set(verdict.gates_passed ?? []);
  const failed = new Set(verdict.gates_failed ?? []);
  const evidence = verdict.gates_evidence ?? {};

  // Build per-gate status by walking [1..11] in order. A gate appears in
  // gates_evidence with keys like "1_stack_match"; the leading id is the
  // join key (matches the audit page's reject-row pattern).
  const evidenceByGate: Record<number, { status?: string; evidence?: string }> = {};
  for (const [key, val] of Object.entries(evidence)) {
    const m = /^(\d+)/.exec(key);
    if (m) evidenceByGate[Number(m[1])] = val;
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-5">
      {/* Headline */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={cn("text-sm uppercase tracking-wider", decisionTone(effective))}>
          {effective ?? "—"}
        </Badge>
        {verdict.threshold_flipped && (
          <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
            ⚠ Below threshold (raw: {verdict.decision})
          </Badge>
        )}
        {verdict.tier && (
          <span className="text-[13px] text-muted-foreground">
            Tier: <span className="font-semibold text-foreground">{verdict.tier}</span>
          </span>
        )}
        <span className={cn("text-[14px] font-semibold", scoreTone(verdict.total_score))}>
          {verdict.total_score != null ? `${verdict.total_score}/100` : "—"}
        </span>
        {verdict.confidence != null && (
          <span className="text-[13px] text-muted-foreground">
            Confidence: {verdict.confidence.toFixed(2)}
          </span>
        )}
        {verdict.classifier_mode_at_decision && (
          <Badge variant="secondary" className="text-[11px]">
            mode: {verdict.classifier_mode_at_decision}
          </Badge>
        )}
      </div>

      {verdict.summary && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{verdict.summary}</p>
      )}

      {verdict.confidence_warnings && verdict.confidence_warnings.length > 0 && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-200">
          <strong>Warnings:</strong> {verdict.confidence_warnings.join(", ")}
        </div>
      )}

      {verdict.rejection_reasons && verdict.rejection_reasons.length > 0 && (
        <div className="text-[13px]">
          <span className="font-semibold">Rejection reasons:</span>{" "}
          <span className="text-muted-foreground">
            {verdict.rejection_reasons.join(" · ")}
          </span>
        </div>
      )}

      <Separator />

      {/* Hard gates */}
      <div className="space-y-1">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Hard Gates
        </h3>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((gid) => {
          const ev = evidenceByGate[gid];
          const status: "passed" | "failed" | "skipped" | "unknown" = failed.has(gid)
            ? "failed"
            : passed.has(gid)
              ? "passed"
              : ev?.status === "skipped_deterministic" || ev?.status === "skipped"
                ? "skipped"
                : "unknown";
          return gateRow(gid, status, ev?.evidence ?? null);
        })}
      </div>

      <Separator />

      {/* Rubric */}
      <div className="space-y-1">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Rubric
        </h3>
        {Object.entries(COMPONENT_LABELS).map(([key, meta]) => {
          const c = verdict.components?.[key];
          const value = c?.value ?? null;
          return (
            <div
              key={key}
              className="grid grid-cols-[1fr_60px_2fr] items-start gap-3 py-1 text-[13px]"
            >
              <span className="font-medium">{meta.label}</span>
              <span className={cn("font-mono", scoreTone(value != null ? (value / meta.max) * 100 : null))}>
                {value != null ? `${value}/${meta.max}` : `—/${meta.max}`}
              </span>
              <span className="text-muted-foreground">{c?.reason ?? "—"}</span>
            </div>
          );
        })}
      </div>

      {/* Proposal angles (only on proceed) */}
      {verdict.proposal_angles && verdict.proposal_angles.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Top Proposal Angles
            </h3>
            <ol className="ml-5 list-decimal space-y-1 text-[13px]">
              {verdict.proposal_angles.map((angle, i) => (
                <li key={i}>{angle}</li>
              ))}
            </ol>
          </div>
        </>
      )}

      {/* Card status footer */}
      {verdict.task && (
        <>
          <Separator />
          <div className="grid grid-cols-1 gap-1 text-[12px] text-muted-foreground sm:grid-cols-3">
            <span>
              Column:{" "}
              <span className="font-semibold text-foreground">
                {verdict.task.current_column ?? "—"}
              </span>
            </span>
            <span>
              Assignee:{" "}
              <span className="font-semibold text-foreground">
                {verdict.task.current_assignee_name ?? "—"}
              </span>
            </span>
            <span>
              Created:{" "}
              <span className="font-semibold text-foreground">
                {verdict.task.created_at
                  ? new Date(verdict.task.created_at).toLocaleString()
                  : "—"}
              </span>
            </span>
          </div>
        </>
      )}

      <Separator />

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRerun}
          disabled={rerunDisabled}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Re-run
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/tasks?task=${taskId}`} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open card
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={onCopyJson}>
          <Copy className="mr-1 h-3.5 w-3.5" /> Copy verdict JSON
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground">
          {verdict.model ? `${verdict.model} · ` : ""}prompt{" "}
          {verdict.prompt_version ?? "—"} · criteria {verdict.criteria_version ?? "—"}
          {verdict._score_id ? ` · score #${verdict._score_id}` : ""}
        </div>
      </div>
    </div>
  );
}
