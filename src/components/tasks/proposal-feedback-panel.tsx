"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Sparkles, RefreshCw, Copy, RotateCcw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, copyText } from "@/lib/utils";
import { PROPOSAL_FEEDBACK_OPTIONS } from "@/lib/proposal-feedback-reasons";

const NOTE_MAX_LEN = 2000;

interface ProposalFeedbackRow {
  feedback_id: number;
  author_role: "agent" | "admin";
  author_name: string | null;
  categories: string[];
  note: string | null;
  regenerated_proposal: string | null;
  model: string | null;
  status: "feedback" | "regenerated" | "regen_failed" | "manual";
  applied: boolean;
  created_at: string;
}

interface Props {
  taskId: string;
  currentProposal: string | null;
  viewerRole: "admin" | "agent";
  viewerAgentId: string | null;
  // Applies a proposal version to the card (persists + reflects in the open view).
  // Parent wires this to updateCustomField("_proposal", text).
  onProposalApplied: (text: string) => void;
  // When rendered inside the proposal tab, the tab label replaces the panel's own
  // header and the top margin is dropped (the tab provides the framing).
  embedded?: boolean;
}

const STATUS_BADGE: Record<ProposalFeedbackRow["status"], { label: string; cls: string }> = {
  feedback: { label: "Feedback", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  regenerated: { label: "Regenerated", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  regen_failed: { label: "Regen failed", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  // Manual proposals are rendered by ManualProposalPanel and filtered out of this
  // timeline — this entry just keeps the Record exhaustive for the type checker.
  manual: { label: "Manual", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
};

export function ProposalFeedbackPanel({
  taskId,
  currentProposal,
  viewerRole,
  viewerAgentId,
  onProposalApplied,
  embedded = false,
}: Props) {
  const router = useRouter();
  const enabled = !!currentProposal && (viewerRole === "admin" || !!viewerAgentId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ProposalFeedbackRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/proposal-feedback`);
      if (res.ok) {
        const json = (await res.json()) as { feedback: ProposalFeedbackRow[] };
        // Manual proposals (agent-pasted) have their own panel — keep this
        // timeline to AI feedback/regeneration only.
        setHistory((json.feedback ?? []).filter((r) => r.status !== "manual"));
      }
    } catch {
      /* non-fatal — history just stays empty */
    }
  }, [taskId]);

  useEffect(() => {
    if (enabled) loadHistory();
  }, [enabled, loadHistory]);

  function toggle(cat: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    setError(null);
  }

  function resetForm() {
    setSelected(new Set());
    setNote("");
  }

  async function handleSaveFeedback() {
    if (selected.size === 0) {
      setError("Pick at least one problem category.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/proposal-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: Array.from(selected),
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success("Feedback saved");
      resetForm();
      await loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    if (selected.size === 0) {
      setError("Pick at least one problem category so the AI knows what to fix.");
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          categories: Array.from(selected),
          note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) {
          setError(`Rate limit reached (${body.exceeded}). Try again later.`);
        } else if (res.status === 502 || res.status === 504) {
          setError("The proposal generator is unavailable right now. Your feedback was saved — try regenerating again later.");
        } else {
          setError(body.error ?? `Regenerate failed (${res.status})`);
        }
        await loadHistory(); // surface the regen_failed attempt
        return;
      }
      if (typeof body.proposal === "string") {
        onProposalApplied(body.proposal);
        toast.success("Proposal regenerated");
        resetForm();
        await loadHistory();
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDelete(feedbackId: number) {
    try {
      const res = await fetch(`/api/tasks/${taskId}/proposal-feedback`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback_id: feedbackId }),
      });
      if (res.ok || res.status === 204) {
        setHistory((prev) => prev.filter((r) => r.feedback_id !== feedbackId));
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to remove");
      }
    } catch {
      toast.error("Failed to remove");
    }
  }

  function handleRestore(row: ProposalFeedbackRow) {
    if (!row.regenerated_proposal) return;
    onProposalApplied(row.regenerated_proposal);
    toast.success("Proposal restored to this version");
  }

  if (!enabled) {
    return (
      <div className={cn("rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground", !embedded && "mt-4")}>
        Proposal feedback becomes available once a proposal has been generated.
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border border-border bg-muted/20 p-3 space-y-3", !embedded && "mt-4")}>
      {!embedded && (
        <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Improve this proposal
        </div>
      )}

      {/* Category chips */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-muted-foreground">
          What&apos;s wrong with it? (pick any)
        </div>
        <div className="flex flex-wrap gap-2">
          {PROPOSAL_FEEDBACK_OPTIONS.map((c) => {
            const checked = selected.has(c);
            return (
              <label
                key={c}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] cursor-pointer transition-colors ${
                  checked
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                <input type="checkbox" className="h-3 w-3" checked={checked} onChange={() => toggle(c)} />
                <span>{c}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Note */}
      <div className="space-y-1">
        <label htmlFor={`pf-note-${taskId}`} className="text-[11px] font-medium text-muted-foreground">
          Details (optional) — what specifically should change?
        </label>
        <textarea
          id={`pf-note-${taskId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX_LEN}
          placeholder="e.g. hook is generic — lead with the live-sync risk; drop the portfolio claim, we never built that"
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] focus:border-primary focus:outline-none min-h-[60px]"
          rows={3}
        />
        <div className="text-[10px] text-muted-foreground text-right">
          {note.length}/{NOTE_MAX_LEN}
        </div>
      </div>

      {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSaveFeedback}
          disabled={saving || regenerating}
          className="h-7 text-[12px]"
        >
          {saving ? "Saving…" : "Save feedback"}
        </Button>
        <Button
          size="sm"
          onClick={handleRegenerate}
          disabled={saving || regenerating}
          className="h-7 text-[12px] gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          {regenerating ? "Regenerating…" : "Regenerate"}
        </Button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-[11px] font-medium text-muted-foreground">
            History ({history.length})
          </div>
          {history.map((row) => {
            const badge = STATUS_BADGE[row.status];
            const isOpen = expanded === row.feedback_id;
            const canOwn = viewerRole === "admin" || (!!viewerAgentId && row.author_role === "agent");
            return (
              <div key={row.feedback_id} className="rounded border border-border bg-background p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {row.author_name ?? (row.author_role === "admin" ? "Admin" : "Agent")} ·{" "}
                      {format(new Date(row.created_at), "MMM d, h:mm a")}
                    </span>
                    {row.model && (
                      <span className="text-[10px] text-muted-foreground">· {row.model}</span>
                    )}
                  </div>
                  {canOwn && (
                    <button
                      onClick={() => handleDelete(row.feedback_id)}
                      className="text-muted-foreground hover:text-red-600 shrink-0"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {row.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {row.categories.map((c) => (
                      <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {row.note && <p className="text-[11px] leading-relaxed">{row.note}</p>}

                {row.regenerated_proposal && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded(isOpen ? null : row.feedback_id)}
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {isOpen ? "Hide" : "View"} this version
                      </button>
                      <button
                        onClick={() => {
                          copyText(row.regenerated_proposal!).then((ok) =>
                            ok ? toast.success("Copied") : toast.error("Copy failed")
                          );
                        }}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                      <button
                        onClick={() => handleRestore(row)}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    </div>
                    {isOpen && (
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] leading-relaxed">
                        {row.regenerated_proposal}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
