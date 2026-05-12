"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle, Info } from "lucide-react";
import { format } from "date-fns";

type CustomFields = Record<string, unknown>;

interface RelevancyPanelProps {
  cf: CustomFields;
}

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

export function RelevancyPanel({ cf }: RelevancyPanelProps) {
  const scoreId = (cf._relevancy_score_id as number | null) ?? null;
  const dlqId = (cf._relevancy_dlq_id as number | null) ?? null;

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

  return (
    <div className="mt-6 rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {evaluatedDisplay && <span>{evaluatedDisplay}</span>}
          {scoreId !== null && <span>· #{scoreId}</span>}
          {isDLQ && <span>· DLQ #{dlqId}</span>}
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

        {!summary && !isDLQ && reasons.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>No qualitative feedback returned by classifier.</span>
          </div>
        )}
      </div>
    </div>
  );
}
