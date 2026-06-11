"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PenLine, Copy, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/utils";

const NOTE_MAX_LEN = 2000;
const PROPOSAL_MAX_LEN = 20000;

interface ProposalFeedbackRow {
  feedback_id: number;
  author_role: "agent" | "admin";
  author_name: string | null;
  note: string | null;
  regenerated_proposal: string | null;
  status: "feedback" | "regenerated" | "regen_failed" | "manual";
  created_at: string;
}

interface Props {
  taskId: string;
  viewerRole: "admin" | "agent";
  viewerAgentId: string | null;
}

export function ManualProposalPanel({ taskId, viewerRole, viewerAgentId }: Props) {
  // Writing a proposal by hand is open to admins and any assigned agent — it does
  // not depend on a system proposal existing (an agent may write their own where
  // the AI produced none).
  const enabled = viewerRole === "admin" || !!viewerAgentId;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ProposalFeedbackRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/proposal-feedback`);
      if (res.ok) {
        const json = (await res.json()) as { feedback: ProposalFeedbackRow[] };
        setHistory((json.feedback ?? []).filter((r) => r.status === "manual"));
      }
    } catch {
      /* non-fatal — history just stays empty */
    }
  }, [taskId]);

  useEffect(() => {
    if (enabled) loadHistory();
  }, [enabled, loadHistory]);

  function resetForm() {
    setText("");
    setNote("");
    setOpen(false);
  }

  async function handleSave() {
    if (text.trim().length === 0) {
      setError("Paste your proposal first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/manual-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_text: text.trim(),
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      toast.success("Your proposal was saved");
      resetForm();
      await loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
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

  if (!enabled) return null;

  return (
    <div className="mt-4 rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-foreground">
          <PenLine className="h-3.5 w-3.5 text-primary" />
          Your own proposal
        </div>
        {!open && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="h-7 text-[12px]"
          >
            I wrote my own proposal
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Wrote the proposal yourself? Paste it here to record it. This is kept for review and
        training — it does not change the proposal shown on the card.
      </p>

      {open && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor={`mp-text-${taskId}`} className="text-[11px] font-medium text-muted-foreground">
              Your proposal
            </label>
            <textarea
              id={`mp-text-${taskId}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={PROPOSAL_MAX_LEN}
              placeholder="Paste the proposal you wrote…"
              className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] focus:border-primary focus:outline-none min-h-[160px]"
              rows={8}
            />
            <div className="text-[10px] text-muted-foreground text-right">
              {text.length}/{PROPOSAL_MAX_LEN}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={`mp-note-${taskId}`} className="text-[11px] font-medium text-muted-foreground">
              Note (optional) — why you wrote your own
            </label>
            <textarea
              id={`mp-note-${taskId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX_LEN}
              placeholder="e.g. the AI draft missed the client's compliance requirement, so I rewrote the hook"
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
              onClick={resetForm}
              disabled={saving}
              className="h-7 text-[12px]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || text.trim().length === 0}
              className="h-7 text-[12px]"
            >
              {saving ? "Saving…" : "Save my proposal"}
            </Button>
          </div>
        </div>
      )}

      {/* History (manual only) */}
      {history.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-[11px] font-medium text-muted-foreground">
            Submitted proposals ({history.length})
          </div>
          {history.map((row) => {
            const isOpen = expanded === row.feedback_id;
            const canOwn = viewerRole === "admin" || (!!viewerAgentId && row.author_role === "agent");
            return (
              <div key={row.feedback_id} className="rounded border border-border bg-background p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      Manual
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {row.author_name ?? (row.author_role === "admin" ? "Admin" : "Agent")} ·{" "}
                      {format(new Date(row.created_at), "MMM d, h:mm a")}
                    </span>
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

                {row.note && <p className="text-[11px] leading-relaxed">{row.note}</p>}

                {row.regenerated_proposal && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded(isOpen ? null : row.feedback_id)}
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {isOpen ? "Hide" : "View"} proposal
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
