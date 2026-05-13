"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverridePanel } from "./override-panel";
import { cn } from "@/lib/utils";
import type { RelevancyAuditRejectRow } from "@/lib/data";

interface RejectRowProps {
  row: RelevancyAuditRejectRow;
  expanded: boolean;
  onToggleExpand: () => void;
}

interface DetailResponse {
  summary: string | null;
  confidence: number | null;
  confidence_warnings: string[] | null;
  gates_passed: number[] | null;
  gates_failed: number[] | null;
  gates_evidence: Record<string, { status?: string; evidence?: string }> | null;
  components: Record<string, { value?: number; reason?: string }> | null;
  snapshot_id: string | null;
  min_score_at_decision: number | null;
  model: string;
  prompt_version: string;
  criteria_version: string;
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

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function RejectRow({ row, expanded, onToggleExpand }: RejectRowProps) {
  const router = useRouter();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Lazy-load row detail the first time the row expands.
  async function handleRowClick() {
    if (!expanded && detail === null && !loadingDetail) {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/relevancy-audit/rejects/${row.score_id}`);
        if (!res.ok) {
          setDetailError(`Failed to load detail (${res.status})`);
        } else {
          const data = (await res.json()) as DetailResponse;
          setDetail(data);
          setDetailError(null);
        }
      } catch (e) {
        setDetailError((e as Error).message);
      } finally {
        setLoadingDetail(false);
      }
    }
    onToggleExpand();
  }

  // Prefer the row's canonical job_url (written at scoring time, migration 022).
  // Fall back to deriving from job_external_id with proper tilde handling —
  // strip a leading `~` if Vollna gave us the canonical form so we don't
  // produce `~~01abc…` URLs.
  let jobUrl: string | null = row.job_url ?? null;
  if (!jobUrl && row.job_external_id) {
    const trimmed = row.job_external_id.replace(/^~/, "");
    // Only build a URL when the derived ID looks like Upwork's `01abc…` form.
    // Long numeric ciphertexts (e.g. 022051374…) don't resolve at /jobs/~<id>.
    if (/^0[0-9a-f]+$/i.test(trimmed)) {
      jobUrl = `https://www.upwork.com/jobs/~${trimmed}`;
    }
  }

  // Show the first 4 reasons as badges so the admin can scan multi-gate
  // rejects at a glance. Overflow → "+N more" pill with full list in tooltip.
  const reasons = row.rejection_reasons ?? [];
  const MAX_VISIBLE_REASONS = 4;
  const visibleReasons = reasons.slice(0, MAX_VISIBLE_REASONS);
  const hiddenReasonCount = Math.max(0, reasons.length - MAX_VISIBLE_REASONS);
  const hiddenReasonsTooltip = reasons.slice(MAX_VISIBLE_REASONS).join(", ");

  const isOverridden = row.override !== null;

  return (
    <>
      <tr
        className={cn(
          "border-t border-border transition-colors hover:bg-accent/30 cursor-pointer",
          expanded && "bg-accent/40",
          overrideOpen && "bg-accent/40"
        )}
        onClick={handleRowClick}
      >
        <td className="px-3 py-2 text-muted-foreground" title={new Date(row.evaluated_at).toLocaleString()}>
          {relativeTime(row.evaluated_at)}
        </td>
        <td className="px-3 py-2">
          <span className="font-medium">{row.profile_name ?? row.profile_id ?? "—"}</span>
        </td>
        <td className="px-3 py-2 max-w-[360px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{row.job_title}</span>
            {jobUrl && (
              <a
                href={jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Open on Upwork"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <span
            className={cn(
              "inline-flex h-7 w-10 items-center justify-center rounded-md font-semibold",
              scoreColor(row.total_score)
            )}
          >
            {row.total_score ?? "—"}
          </span>
        </td>
        <td className="px-3 py-2">
          <Badge variant="outline" className="text-[11px]">
            {row.tier ?? "—"}
          </Badge>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {visibleReasons.length === 0 ? (
              <Badge variant="outline" className="text-[11px] text-muted-foreground italic">
                (unspecified)
              </Badge>
            ) : (
              visibleReasons.map((r, i) => (
                <Badge
                  key={`${r}-${i}`}
                  variant="outline"
                  className="border-red-300 text-red-700 dark:border-red-900 dark:text-red-300 text-[11px]"
                  title={r}
                >
                  {r}
                </Badge>
              ))
            )}
            {hiddenReasonCount > 0 && (
              <Badge
                variant="outline"
                className="border-red-300 text-red-700 dark:border-red-900 dark:text-red-300 text-[11px]"
                title={hiddenReasonsTooltip}
              >
                +{hiddenReasonCount} more
              </Badge>
            )}
            {row.threshold_flipped && (
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300 text-[11px]"
                title="LLM said proceed but score < min_score; flipped to reject"
              >
                <Zap className="mr-0.5 h-3 w-3" />
                flipped
              </Badge>
            )}
          </div>
        </td>
        <td className="px-3 py-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[11px]",
              row.classifier_mode_at_decision === "shadow"
                ? "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300"
                : "border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
            )}
          >
            {row.classifier_mode_at_decision === "shadow" ? "Shadow" : "Active"}
          </Badge>
        </td>
        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          {isOverridden ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOverrideOpen((v) => !v)}
              className="text-emerald-700 dark:text-emerald-300"
            >
              ✓ Flagged
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOverrideOpen((v) => !v)}
            >
              Mark as wrong reject
            </Button>
          )}
        </td>
      </tr>

      {overrideOpen && (
        <tr className="border-t border-border bg-accent/20">
          <td colSpan={8} className="px-3 py-3">
            <OverridePanel
              scoreId={row.score_id}
              existingOverride={row.override}
              onClose={() => setOverrideOpen(false)}
              onSaved={() => {
                toast.success("Override saved.");
                setOverrideOpen(false);
                router.refresh();
              }}
              onRemoved={() => {
                toast.success("Override removed.");
                setOverrideOpen(false);
                router.refresh();
              }}
            />
          </td>
        </tr>
      )}

      {expanded && (
        <tr className="border-t border-border bg-accent/10">
          <td colSpan={8} className="px-3 py-4">
            {loadingDetail && (
              <div className="text-[13px] text-muted-foreground">Loading detail…</div>
            )}
            {detailError && (
              <div className="text-[13px] text-red-700 dark:text-red-300">{detailError}</div>
            )}
            {detail && (
              <div className="space-y-4 text-[13px]">
                {detail.summary && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Summary
                    </div>
                    <p className="text-foreground">{detail.summary}</p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {detail.gates_evidence && Object.keys(detail.gates_evidence).length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Gates
                      </div>
                      <ul className="space-y-1">
                        {Object.entries(detail.gates_evidence)
                          .map(([key, entry]) => {
                            // Keys look like "1_stack_match" — first segment is the gate id.
                            const gid = parseInt(key.split("_")[0] ?? "0", 10);
                            return { gid, key, entry } as const;
                          })
                          .filter((x) => x.gid > 0)
                          .sort((a, b) => a.gid - b.gid)
                          .map(({ gid, key, entry }) => {
                            const passed = entry.status === "pass" || entry.status === "skipped_deterministic";
                            return (
                              <li key={key} className="flex items-start gap-2">
                                <span
                                  className={cn(
                                    "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                                    passed
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                      : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  )}
                                >
                                  {passed ? "✓" : "✗"}
                                </span>
                                <span className="flex-1">
                                  <span className="font-medium">
                                    {gid}. {GATE_NAMES[gid] ?? "Gate"}
                                  </span>
                                  {entry.evidence && (
                                    <span className="ml-1 text-muted-foreground">— {entry.evidence}</span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  )}

                  {detail.components && (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Components
                      </div>
                      <table className="w-full text-[12.5px]">
                        <tbody>
                          {Object.entries(detail.components).map(([key, c]) => (
                            <tr key={key} className="border-b border-border/40 last:border-0">
                              <td className="py-1 pr-2 capitalize">{key.replace(/_/g, " ")}</td>
                              <td className="py-1 pr-2 text-right font-mono">
                                {c.value ?? "—"} / {COMPONENT_MAX[key] ?? "—"}
                              </td>
                              <td className="py-1 text-muted-foreground">
                                {c.reason ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                  {detail.confidence != null && (
                    <div className="flex items-center gap-2">
                      <span>Confidence:</span>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.round(detail.confidence * 100)}%` }}
                        />
                      </div>
                      <span>{Math.round(detail.confidence * 100)}%</span>
                    </div>
                  )}
                  {detail.min_score_at_decision != null && (
                    <span>min_score: {detail.min_score_at_decision}</span>
                  )}
                  <span>model: {detail.model}</span>
                  <span>prompt: {detail.prompt_version}</span>
                  <span>criteria: v{detail.criteria_version}</span>
                </div>

                {detail.confidence_warnings && detail.confidence_warnings.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.confidence_warnings.map((w) => (
                      <Badge
                        key={w}
                        variant="outline"
                        className="border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300 text-[11px]"
                      >
                        {w}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                  <span>score_id: {row.score_id}</span>
                  {detail.snapshot_id && (
                    <span className="font-mono">snapshot_id: {detail.snapshot_id}</span>
                  )}
                </div>

                {isOverridden && row.override?.note && (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      Override note
                    </div>
                    <p className="text-foreground">{row.override.note}</p>
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
