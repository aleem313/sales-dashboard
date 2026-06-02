"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, Info, Check, X, Flag } from "lucide-react";
import { format } from "date-fns";
import {
  RelevancyFeedbackForm,
  OVERALL_DECISION_FLAG,
  type ExistingFeedback,
} from "./relevancy-feedback-form";

type CustomFields = Record<string, unknown>;

interface RelevancyPanelProps {
  cf: CustomFields;
  // When provided, enables the "Mark wrong" affordance. Omit on read-only
  // surfaces (e.g. the audit page) where the feedback flow doesn't apply.
  taskId?: string;
  viewerRole?: "admin" | "agent";
  viewerAgentId?: string | null;
}

type GateStatus = "pass" | "fail" | "skipped_deterministic";
type GateEntry = { status?: GateStatus; evidence?: string };
type ComponentEntry = { value?: number; reason?: string };

const GATE_LABELS: Record<string, string> = {
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

const COMPONENT_LABELS: Record<string, string> = {
  skill_match: "Skill",
  portfolio_evidence: "Portfolio",
  client_quality: "Client",
  competition_position: "Competition",
  domain_match: "Domain",
  experience_level_fit: "Experience",
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

function decisionColor(decision: string | null): string {
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

export function RelevancyPanel({
  cf,
  taskId,
  viewerRole,
  viewerAgentId,
}: RelevancyPanelProps) {
  const scoreId = (cf._relevancy_score_id as number | null) ?? null;
  const dlqId = (cf._relevancy_dlq_id as number | null) ?? null;

  // Feedback affordance — only when the panel knows the task it's rendering
  // for AND there's a real score row to flag (DLQ-only entries have no
  // classifier verdict to dispute).
  const feedbackEnabled =
    taskId !== undefined && scoreId !== null && (viewerRole === "admin" || !!viewerAgentId);

  const [formOpen, setFormOpen] = useState(false);
  const [existingFeedback, setExistingFeedback] = useState<ExistingFeedback | null>(null);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Delete the viewer's existing flag straight from the summary box (the form
  // also exposes Remove, but most people look for delete here, not behind the
  // header chip). Mirrors RelevancyFeedbackForm.handleRemove.
  async function handleRemoveFlag(feedbackId: number) {
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/relevancy-feedback`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback_id: feedbackId }),
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRemoveError(body.error ?? `Remove failed (${res.status})`);
        return;
      }
      setExistingFeedback(null);
      setFormOpen(false);
    } catch (e) {
      setRemoveError((e as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  // Fetch existing feedback row when the panel mounts. The API returns null
  // when the viewer hasn't flagged this task yet; the button stays "Mark wrong"
  // in that case.
  useEffect(() => {
    if (!feedbackEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/relevancy-feedback`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          if (!cancelled) setFeedbackLoaded(true);
          return;
        }
        const json = (await res.json()) as { feedback: ExistingFeedback | null };
        if (!cancelled) {
          setExistingFeedback(json.feedback);
          setFeedbackLoaded(true);
        }
      } catch {
        if (!cancelled) setFeedbackLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedbackEnabled, taskId]);

  if (scoreId === null && dlqId === null) return null;

  const score = (cf._relevancy_score as number | null) ?? null;
  const tier = (cf._relevancy_tier as string | null) ?? null;
  const decision = (cf._relevancy_decision as string | null) ?? null;
  const effective = (cf._relevancy_effective as string | null) ?? null;
  const thresholdFlipped = (cf._relevancy_threshold_flipped as boolean) ?? false;
  const summary = (cf._relevancy_summary as string | null) ?? null;
  const reasonsRaw = cf._relevancy_reasons;
  const reasons: string[] = Array.isArray(reasonsRaw) ? (reasonsRaw as string[]) : [];
  const confidence = (cf._relevancy_confidence as number | null) ?? null;
  const evaluatedAt = (cf._relevancy_evaluated_at as string | null) ?? null;
  const mode = (cf._relevancy_mode_at_decision as string | null) ?? null;
  const model = (cf._relevancy_model as string | null) ?? null;
  const gatesRaw = cf._relevancy_gates;
  const gates: Record<string, GateEntry> =
    gatesRaw && typeof gatesRaw === "object" && !Array.isArray(gatesRaw)
      ? (gatesRaw as Record<string, GateEntry>)
      : {};
  const componentsRaw = cf._relevancy_components;
  const components: Record<string, ComponentEntry> =
    componentsRaw && typeof componentsRaw === "object" && !Array.isArray(componentsRaw)
      ? (componentsRaw as Record<string, ComponentEntry>)
      : {};
  const gateEntries = Object.entries(gates).sort(([a], [b]) => {
    const na = parseInt(a.split("_")[0], 10);
    const nb = parseInt(b.split("_")[0], 10);
    return (Number.isNaN(na) ? 99 : na) - (Number.isNaN(nb) ? 99 : nb);
  });

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

  const isDLQ = dlqId !== null && scoreId === null;
  const confidencePct = confidence !== null ? Math.round(confidence * 100) : null;

  let evaluatedDisplay = "";
  if (evaluatedAt) {
    try {
      evaluatedDisplay = format(new Date(evaluatedAt), "MMM d, h:mm a");
    } catch {
      evaluatedDisplay = evaluatedAt;
    }
  }

  // The list of reasons the agent can tick. We surface the LLM's emitted
  // rejection_reasons; if there are none (proceed verdict), the agent can
  // still flag via the fixed "Overall decision was wrong" checkbox.
  const flagableReasons: string[] = reasons;

  const flaggedSpecificReasons =
    (existingFeedback?.override_reason ?? []).filter((r) => r !== OVERALL_DECISION_FLAG);
  const flaggedDecision =
    (existingFeedback?.override_reason ?? []).includes(OVERALL_DECISION_FLAG);
  const isFlagged = existingFeedback !== null;

  return (
    <div className="mt-6 rounded-lg border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">AI Relevancy</h3>
          {mode === "shadow" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300">
              Shadow
            </Badge>
          )}
          {mode === "active" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
              Active
            </Badge>
          )}
          {modelDisplay && (
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", modelBadgeClass)} title={`Evaluated by ${modelDisplay}`}>
              via {modelDisplay}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {evaluatedDisplay && <span className="whitespace-nowrap">{evaluatedDisplay}</span>}
          {scoreId !== null && <span className="whitespace-nowrap">· #{scoreId}</span>}
          {isDLQ && <span className="whitespace-nowrap">· DLQ #{dlqId}</span>}
          {feedbackEnabled && feedbackLoaded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFormOpen((v) => !v)}
              className={cn(
                "h-6 px-2 text-[11px] gap-1",
                isFlagged
                  ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-300"
                  : "text-foreground/80"
              )}
              title={isFlagged ? "You flagged this AI classification — click to edit" : "Tell the team why the AI got this wrong"}
            >
              {isFlagged ? (
                <>
                  <Check className="h-3 w-3" />
                  Flagged
                </>
              ) : (
                <>
                  <Flag className="h-3 w-3" />
                  Mark wrong
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {isDLQ && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-medium">Classifier errored.</span> This is a synthesized fallback verdict, not a real LLM scoring. Routing-safe but treat the score/decision as a placeholder.
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-lg h-16 w-16 shrink-0 font-bold",
              scoreColor(score)
            )}
          >
            <span className="text-2xl leading-none">{score ?? "—"}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 opacity-70">score</span>
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {tier && (
                <Badge className={cn("text-xs px-2", tierColor(tier))} variant="outline">
                  {tier}
                </Badge>
              )}
              {decision && !thresholdFlipped && (
                <Badge className={cn("text-xs px-2", decisionColor(decision))} variant="outline">
                  {decision}
                </Badge>
              )}
              {thresholdFlipped && (
                <div className="flex items-center gap-1 text-xs">
                  <Badge className={cn("px-2", decisionColor(decision))} variant="outline">
                    {decision}
                  </Badge>
                  <span className="text-muted-foreground">→</span>
                  <Badge className={cn("px-2", decisionColor(effective))} variant="outline">
                    {effective}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground italic ml-0.5">flipped</span>
                </div>
              )}
            </div>

            {confidencePct !== null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[120px]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      confidencePct >= 70 ? "bg-emerald-500" : confidencePct >= 40 ? "bg-amber-500" : "bg-red-500"
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
          <div className="text-xs text-foreground/80 leading-relaxed pl-1 border-l-2 border-violet-300 dark:border-violet-800 italic pl-3">
            {summary}
          </div>
        )}

        {reasons.length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Reasons:</span>
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

        {gateEntries.length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Gates:</span>
            {gateEntries.map(([gateId, gate]) => {
              const label = GATE_LABELS[gateId] ?? gateId.replace(/^\d+_/, "").replace(/_/g, " ");
              const status = gate.status;
              const isPass = status === "pass" || status === "skipped_deterministic";
              const isFail = status === "fail";
              const evidence = gate.evidence ?? "";
              return (
                <Badge
                  key={gateId}
                  variant="outline"
                  title={evidence}
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-5 gap-0.5 inline-flex items-center",
                    isPass &&
                      "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30",
                    isFail &&
                      "border-red-200 text-red-700 dark:border-red-900 dark:text-red-300 bg-red-50/50 dark:bg-red-950/30",
                    !isPass &&
                      !isFail &&
                      "border-muted text-muted-foreground"
                  )}
                >
                  {isPass ? <Check className="h-2.5 w-2.5" /> : isFail ? <X className="h-2.5 w-2.5" /> : null}
                  {label}
                </Badge>
              );
            })}
          </div>
        )}

        {Object.keys(components).length > 0 && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Breakdown:</span>
            {Object.entries(components).map(([key, comp]) => {
              const value = typeof comp.value === "number" ? comp.value : 0;
              const max = COMPONENT_MAX[key] ?? 100;
              const ratio = max > 0 ? value / max : 0;
              const label = COMPONENT_LABELS[key] ?? key.replace(/_/g, " ");
              const reason = comp.reason ?? "";
              const isStrong = ratio >= 0.7;
              const isWeak = ratio <= 0.4;
              return (
                <Badge
                  key={key}
                  variant="outline"
                  title={reason}
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

        {!summary && !isDLQ && reasons.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>No qualitative feedback returned by classifier.</span>
          </div>
        )}

        {isFlagged && !formOpen && (
          <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3 py-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200 font-medium">
              <Flag className="h-3 w-3" />
              You flagged this classification as wrong.
            </div>
            {flaggedSpecificReasons.length > 0 && (
              <div className="mt-1 text-foreground/80">
                Wrong reasons: {flaggedSpecificReasons.join(", ")}
              </div>
            )}
            {flaggedDecision && (
              <div className="mt-1 text-foreground/80">Overall decision marked wrong.</div>
            )}
            {existingFeedback?.note && (
              <div className="mt-1 text-foreground/70 italic">&ldquo;{existingFeedback.note}&rdquo;</div>
            )}
            <div className="mt-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFormOpen(true)}
                disabled={removing}
                className="h-6 px-2 text-[11px]"
              >
                Edit
              </Button>
              {existingFeedback && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveFlag(existingFeedback.feedback_id)}
                  disabled={removing}
                  className="h-6 px-2 text-[11px] text-red-700 hover:text-red-800 dark:text-red-300"
                >
                  {removing ? "Removing…" : "Remove"}
                </Button>
              )}
            </div>
            {removeError && (
              <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">{removeError}</div>
            )}
          </div>
        )}
      </div>

      {feedbackEnabled && formOpen && scoreId !== null && taskId && (
        <RelevancyFeedbackForm
          taskId={taskId}
          scoreId={scoreId}
          reasons={flagableReasons}
          existing={existingFeedback}
          onClose={() => setFormOpen(false)}
          onSaved={(fb) => {
            setExistingFeedback({
              feedback_id: fb.feedback_id,
              override_reason: fb.override_reason,
              note: fb.note,
            });
            setFormOpen(false);
          }}
          onRemoved={() => {
            setExistingFeedback(null);
            setFormOpen(false);
          }}
        />
      )}
    </div>
  );
}
