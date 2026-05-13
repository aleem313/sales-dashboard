"use client";

import { Copy, ExternalLink, RotateCcw, Sparkles, AlertTriangle, Check, X, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// Verdict shape returned by the n8n job-evaluate-manual workflow. Mirrors the
// classifier core's C12 Return Verdict output. Same shape that the task-card
// AI Relevancy panel reads from `custom_fields._relevancy_*`, just unprefixed
// because it comes off the wire instead of off a persisted row.
type GateStatus = "pass" | "fail" | "skipped_deterministic";
type GateEntry = { status?: GateStatus; evidence?: string };
type ComponentEntry = { value?: number; reason?: string };

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
  gates?: Record<string, GateEntry> | null;
  components?: Record<string, ComponentEntry> | null;
  proposal_angles?: string[] | null;
  summary?: string | null;
  missing_signals?: string[] | null;
  model?: string;
  prompt_version?: string;
  criteria_version?: string;
  evaluation_path?: string;
  _score_id?: number | null;
  _dlq_id?: number | null;
  request_meta?: Record<string, unknown> | null;
  task?: {
    title?: string | null;
    current_column?: string | null;
    current_assignee_name?: string | null;
    created_at?: string | null;
    stage_entered_at?: string | null;
  } | null;
  error?: string;
  detail?: string;
}

const GATE_LABELS_SHORT: Record<string, string> = {
  "1_stack_match": "Stack",
  "2_freshness": "Fresh",
  "3_proposal_saturation": "Competition",
  "4_hourly_floor": "Rate",
  "5_client_spend_floor": "Spend",
  "6_client_rating_floor": "Rating",
  "7_job_availability": "Available",
  "8_no_location_lockin": "Location",
  "9_no_video_proposal": "No Video",
  "10_portfolio_match": "Portfolio",
  "11_no_duplicate": "Unique",
};

const GATE_LABELS_FULL: Record<string, string> = {
  "1_stack_match": "Stack Match",
  "2_freshness": "Job Freshness",
  "3_proposal_saturation": "Proposal Saturation",
  "4_hourly_floor": "Hourly Rate Floor",
  "5_client_spend_floor": "Client Spend Floor",
  "6_client_rating_floor": "Client Rating Floor",
  "7_job_availability": "Job Availability",
  "8_no_location_lockin": "Location Lock-in",
  "9_no_video_proposal": "Video Proposal",
  "10_portfolio_match": "Portfolio Match",
  "11_no_duplicate": "Duplicate Check",
};

const COMPONENT_LABELS_SHORT: Record<string, string> = {
  skill_match: "Skill",
  portfolio_evidence: "Portfolio",
  client_quality: "Client",
  competition_position: "Competition",
  domain_match: "Domain",
  experience_level_fit: "Experience",
  red_flags: "Red Flags",
};

const COMPONENT_LABELS_FULL: Record<string, string> = {
  skill_match: "Skill Match",
  portfolio_evidence: "Portfolio Evidence",
  client_quality: "Client Quality",
  competition_position: "Competition Position",
  domain_match: "Domain Match",
  experience_level_fit: "Experience Level Fit",
  red_flags: "Red Flags",
};

const COMPONENT_MAX: Record<string, number> = {
  skill_match: 30,
  portfolio_evidence: 20,
  client_quality: 15,
  competition_position: 10,
  domain_match: 10,
  experience_level_fit: 10,
  red_flags: 5,
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground bg-muted";
  if (score >= 80) return "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950";
  if (score >= 60) return "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-950";
  if (score >= 40) return "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950";
  return "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-950";
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case "strong":
    case "apply_now":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    case "moderate":
      return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
    case "marginal":
    case "review":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    case "reject":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function decisionColor(decision: string | null | undefined): string {
  switch (decision) {
    case "proceed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    case "review":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    case "reject":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function gateOrder([a]: [string, unknown], [b]: [string, unknown]): number {
  const na = parseInt(a.split("_")[0], 10);
  const nb = parseInt(b.split("_")[0], 10);
  return (Number.isNaN(na) ? 99 : na) - (Number.isNaN(nb) ? 99 : nb);
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
  const score = verdict.total_score ?? null;
  const tier = verdict.tier ?? null;
  const decision = verdict.decision ?? null;
  const effective = verdict.effective_decision ?? decision;
  const thresholdFlipped = verdict.threshold_flipped ?? false;
  const confidence = verdict.confidence ?? null;
  const confidencePct = confidence !== null ? Math.round(confidence * 100) : null;
  const summary = verdict.summary ?? null;
  const reasons = verdict.rejection_reasons ?? [];
  const proposalAngles = verdict.proposal_angles ?? [];
  const confidenceWarnings = verdict.confidence_warnings ?? [];
  const mode = verdict.classifier_mode_at_decision ?? null;
  const model = verdict.model ?? null;
  const evaluationPath = verdict.evaluation_path ?? null;
  const scoreId = verdict._score_id ?? null;
  const dlqId = verdict._dlq_id ?? null;
  const isDLQ = dlqId != null && scoreId == null;

  const gates = verdict.gates ?? {};
  const gateEntries = Object.entries(gates).sort(gateOrder);
  const components = verdict.components ?? {};
  const componentEntries = Object.entries(components);

  const modelDisplay = model
    ? model.includes("deepseek")
      ? "DeepSeek R1"
      : model.includes("gemini")
        ? "Gemini 2.5 Flash"
        : model
    : null;
  const modelBadgeClass = model?.includes("deepseek")
    ? "border-purple-300 text-purple-700 dark:border-purple-800 dark:text-purple-300"
    : "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300";

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header strip — mirrors RelevancyPanel header for visual continuity */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Manual Evaluation
          </h3>
          {mode === "shadow" && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
            >
              Shadow
            </Badge>
          )}
          {mode === "active" && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
            >
              Active
            </Badge>
          )}
          {modelDisplay && (
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0 h-4", modelBadgeClass)}
              title={`Evaluated by ${modelDisplay}`}
            >
              via {modelDisplay}
            </Badge>
          )}
          {evaluationPath && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              path: {evaluationPath}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {scoreId != null && <span>#{scoreId}</span>}
          {isDLQ && <span>DLQ #{dlqId}</span>}
        </div>
      </div>

      {isDLQ && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-medium">Classifier errored.</span> Synthesized
            fallback verdict — treat score / decision as a placeholder.
          </div>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Score + decision row */}
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-lg h-16 w-16 shrink-0 font-bold",
              scoreColor(score)
            )}
          >
            <span className="text-2xl leading-none">{score ?? "—"}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 opacity-70">
              score
            </span>
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {tier && (
                <Badge className={cn("text-xs px-2", tierColor(tier))} variant="outline">
                  {tier}
                </Badge>
              )}
              {decision && !thresholdFlipped && (
                <Badge
                  className={cn("text-xs px-2", decisionColor(decision))}
                  variant="outline"
                >
                  {decision}
                </Badge>
              )}
              {thresholdFlipped && (
                <div className="flex items-center gap-1 text-xs">
                  <Badge
                    className={cn("px-2", decisionColor(decision))}
                    variant="outline"
                  >
                    {decision}
                  </Badge>
                  <span className="text-muted-foreground">→</span>
                  <Badge
                    className={cn("px-2", decisionColor(effective))}
                    variant="outline"
                  >
                    {effective}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground italic ml-0.5">
                    flipped
                  </span>
                </div>
              )}
              {verdict.min_score_at_decision != null && (
                <span className="text-[10px] text-muted-foreground">
                  min {verdict.min_score_at_decision}
                </span>
              )}
            </div>

            {confidencePct !== null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[160px]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      confidencePct >= 70
                        ? "bg-emerald-500"
                        : confidencePct >= 40
                          ? "bg-amber-500"
                          : "bg-red-500"
                    )}
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {confidencePct}% confidence
                </span>
              </div>
            )}
          </div>
        </div>

        {summary && (
          <div className="text-xs text-foreground/80 leading-relaxed border-l-2 border-violet-300 dark:border-violet-800 italic pl-3">
            {summary}
          </div>
        )}

        {confidenceWarnings.length > 0 && (
          <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-2.5 text-[11px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-200">
            <strong>Warnings:</strong> {confidenceWarnings.join(", ")}
          </div>
        )}

        {reasons.length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
              Reasons:
            </span>
            {reasons.map((r, i) => (
              <Badge
                key={`${r}-${i}`}
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-5 border-red-200 text-red-700 dark:border-red-900 dark:text-red-300"
              >
                {r}
              </Badge>
            ))}
          </div>
        )}

        {/* Gate pill row (RelevancyPanel-style) */}
        {gateEntries.length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
              Gates:
            </span>
            {gateEntries.map(([gateId, gate]) => {
              const label =
                GATE_LABELS_SHORT[gateId] ??
                gateId.replace(/^\d+_/, "").replace(/_/g, " ");
              const status = gate.status;
              const isPass = status === "pass" || status === "skipped_deterministic";
              const isFail = status === "fail";
              return (
                <Badge
                  key={gateId}
                  variant="outline"
                  title={gate.evidence ?? ""}
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-5 gap-0.5 inline-flex items-center",
                    isPass &&
                      "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30",
                    isFail &&
                      "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300 bg-red-50/50 dark:bg-red-950/30",
                    !isPass && !isFail && "border-muted text-muted-foreground"
                  )}
                >
                  {isPass ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : isFail ? (
                    <X className="h-2.5 w-2.5" />
                  ) : null}
                  {label}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Rubric pill row */}
        {componentEntries.length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
              Breakdown:
            </span>
            {componentEntries.map(([key, comp]) => {
              const value = typeof comp.value === "number" ? comp.value : 0;
              const max = COMPONENT_MAX[key] ?? 100;
              const ratio = max > 0 ? value / max : 0;
              const label = COMPONENT_LABELS_SHORT[key] ?? key.replace(/_/g, " ");
              const isStrong = ratio >= 0.7;
              const isWeak = ratio <= 0.4;
              return (
                <Badge
                  key={key}
                  variant="outline"
                  title={comp.reason ?? ""}
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-5 gap-1 inline-flex items-center tabular-nums",
                    isStrong &&
                      "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30",
                    isWeak &&
                      "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300 bg-red-50/50 dark:bg-red-950/30",
                    !isStrong &&
                      !isWeak &&
                      "border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300"
                  )}
                >
                  {label}
                  <span className="opacity-70">
                    {value}/{max}
                  </span>
                </Badge>
              );
            })}
          </div>
        )}

        {/* Manual-eval-only expanded sections start here */}
        {gateEntries.length > 0 && (
          <>
            <Separator />
            <details open className="space-y-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                Gate Details
              </summary>
              <div className="space-y-1.5">
                {gateEntries.map(([gateId, gate]) => {
                  const fullLabel =
                    GATE_LABELS_FULL[gateId] ??
                    gateId.replace(/^\d+_/, "").replace(/_/g, " ");
                  const status = gate.status;
                  const isPass =
                    status === "pass" || status === "skipped_deterministic";
                  const isFail = status === "fail";
                  const icon = isPass ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : isFail ? (
                    <X className="h-3 w-3 text-red-600" />
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  );
                  return (
                    <div
                      key={gateId}
                      className="grid grid-cols-[18px_20px_1fr_2.5fr] items-start gap-3 py-1 text-[13px]"
                    >
                      <span className="flex items-center justify-center pt-0.5">
                        {icon}
                      </span>
                      <span className="font-mono text-muted-foreground text-[12px] pt-0.5">
                        {gateId.split("_")[0]}
                      </span>
                      <span className="font-medium">{fullLabel}</span>
                      <span className="text-muted-foreground text-[12px] leading-relaxed">
                        {gate.evidence ?? (
                          <span className="italic">no evidence</span>
                        )}
                        {status === "skipped_deterministic" && (
                          <span className="ml-1 text-[10px] uppercase tracking-wider opacity-60">
                            (skipped)
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          </>
        )}

        {componentEntries.length > 0 && (
          <>
            <Separator />
            <details open className="space-y-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                Rubric Details
              </summary>
              <div className="space-y-1">
                {componentEntries.map(([key, comp]) => {
                  const value = typeof comp.value === "number" ? comp.value : null;
                  const max = COMPONENT_MAX[key] ?? 100;
                  const fullLabel = COMPONENT_LABELS_FULL[key] ?? key.replace(/_/g, " ");
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-[1fr_70px_2.5fr] items-start gap-3 py-1 text-[13px]"
                    >
                      <span className="font-medium">{fullLabel}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {value != null ? `${value}/${max}` : `—/${max}`}
                      </span>
                      <span className="text-muted-foreground text-[12px] leading-relaxed">
                        {comp.reason ?? <span className="italic">no reason</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          </>
        )}

        {proposalAngles.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top Proposal Angles
              </h4>
              <ol className="ml-5 list-decimal space-y-1 text-[13px]">
                {proposalAngles.map((angle, i) => (
                  <li key={i} className="leading-relaxed">
                    {angle}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}

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

        {gateEntries.length === 0 && componentEntries.length === 0 && !summary && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>
              No gate or rubric details in this verdict (likely a deterministic
              short-circuit reject — see <code>evaluation_path</code> above).
            </span>
          </div>
        )}

        <Separator />

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRerun} disabled={rerunDisabled}>
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
            prompt {verdict.prompt_version ?? "—"} · criteria{" "}
            {verdict.criteria_version ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
