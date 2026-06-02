"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RELEVANCY_REASON_OPTIONS } from "@/lib/relevancy-reasons";

// Sentinel value used in override_reason[] when the agent says "overall
// decision was wrong" (rather than ticking a specific emitted reason).
export const OVERALL_DECISION_FLAG = "__decision__";

const NOTE_MAX_LEN = 2000;

export interface ExistingFeedback {
  feedback_id: number;
  override_reason: string[] | null;
  note: string | null;
}

interface Props {
  taskId: string;
  scoreId: number;
  reasons: string[]; // The LLM-emitted rejection_reasons / red_flags
  // assertMode = the AI APPROVED this job (proceed verdict, no reasons emitted).
  // The agent disputes it by asserting which standard red-flags the AI missed,
  // picked from the fixed canonical list; those mirror into the card's _reason.
  // !assertMode = the AI REJECTED it; the agent disputes which of the AI's own
  // emitted reasons are wrong (those must NOT mirror to the card).
  assertMode: boolean;
  existing: ExistingFeedback | null;
  onClose: () => void;
  onSaved: (fb: { feedback_id: number; override_reason: string[]; note: string | null }) => void;
  onRemoved: () => void;
}

export function RelevancyFeedbackForm({
  taskId,
  scoreId,
  reasons,
  assertMode,
  existing,
  onClose,
  onSaved,
  onRemoved,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(existing?.override_reason ?? [])
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = existing !== null;

  function toggle(reason: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  }

  function renderChip(r: string) {
    const checked = selected.has(r);
    return (
      <label
        key={r}
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] cursor-pointer transition-colors ${
          checked
            ? "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
            : "border-border bg-background hover:bg-muted"
        }`}
      >
        <input
          type="checkbox"
          className="h-3 w-3"
          checked={checked}
          onChange={() => toggle(r)}
        />
        <span>{r}</span>
      </label>
    );
  }

  // Whether there are any reason chips the agent can tick: the fixed canonical
  // list in assert mode, or the AI's emitted reasons in dispute mode.
  const hasPickableReasons = assertMode || reasons.length > 0;
  const fallbackLabel = assertMode
    ? "Wrong — none of these fit"
    : "Overall decision was wrong";

  async function handleSave() {
    if (selected.size === 0) {
      // Nothing ticked. Tailor the message: when there are no reason chips at all
      // (a dispute on a reject verdict that emitted no reasons), don't tell the
      // agent to pick a reason that doesn't exist.
      setError(
        hasPickableReasons
          ? `Pick at least one reason or check '${fallbackLabel}'.`
          : `Check '${fallbackLabel}' to submit your feedback.`
      );
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Edit-via-delete-then-insert (matches admin override flow). The API has
      // no PATCH route; deleting the old row first lets the unique-per-agent
      // insert succeed.
      if (isEditMode && existing) {
        const del = await fetch(
          `/api/tasks/${taskId}/relevancy-feedback`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback_id: existing.feedback_id }),
          }
        );
        if (!del.ok && del.status !== 204) {
          const body = await del.json().catch(() => ({}));
          setError(body.error ?? `Delete failed (${del.status})`);
          setSubmitting(false);
          return;
        }
      }

      const overrideReason = Array.from(selected);
      const trimmedNote = note.trim();
      const payload = {
        score_id: scoreId,
        override_reason: overrideReason,
        note: trimmedNote.length > 0 ? trimmedNote : null,
        // In assert mode the ticked labels are red-flags the agent says apply to
        // this wrongly-approved job → the server mirrors them into the card's
        // _reason field. Never set in dispute mode (those ticks mean the opposite).
        assert: assertMode,
      };

      const res = await fetch(`/api/tasks/${taskId}/relevancy-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Save failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      const json = (await res.json()) as { feedback_id: number };
      onSaved({
        feedback_id: json.feedback_id,
        override_reason: overrideReason,
        note: trimmedNote.length > 0 ? trimmedNote : null,
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!existing) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/relevancy-feedback`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback_id: existing.feedback_id }),
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Remove failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onRemoved();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-4 mb-4 mt-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-3">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
        Mark this classification wrong
      </div>

      {assertMode ? (
        // AI approved this job — agent asserts which standard red-flags it missed.
        // These mirror into the card's _reason field on save.
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            This job should NOT have been approved — what&apos;s wrong with it? (pick any)
          </div>
          <div className="flex flex-wrap gap-2">
            {RELEVANCY_REASON_OPTIONS.map((r) => renderChip(r))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Ticked reasons are also saved to the card&apos;s Reasons field.
          </p>
        </div>
      ) : (
        // AI rejected this job — agent disputes which of the AI's OWN reasons are wrong.
        <>
          {reasons.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              This verdict listed no specific reasons to dispute. To flag it, tick
              &ldquo;{fallbackLabel}&rdquo; below.
            </p>
          )}
          {reasons.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                Which of the AI&apos;s reasons are wrong? (tick all that apply)
              </div>
              <div className="flex flex-wrap gap-2">
                {reasons.map((r) => renderChip(r))}
              </div>
            </div>
          )}
        </>
      )}

      <label className="flex items-start gap-2 text-[12px] cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5"
          checked={selected.has(OVERALL_DECISION_FLAG)}
          onChange={() => toggle(OVERALL_DECISION_FLAG)}
        />
        <span>
          <span className="font-medium">{fallbackLabel}</span>
          <span className="text-muted-foreground">
            {" "}
            {assertMode
              ? "— the job is bad, but not for any of the reasons listed."
              : "— the verdict itself is incorrect, even if the listed reasons aren't."}
          </span>
        </span>
      </label>

      <div className="space-y-1">
        <label
          htmlFor={`feedback-note-${taskId}`}
          className="text-[11px] font-medium text-muted-foreground"
        >
          Why? (optional)
        </label>
        <textarea
          id={`feedback-note-${taskId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX_LEN}
          placeholder="e.g. client actually has $145k total spent — LLM saw null"
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] focus:border-primary focus:outline-none min-h-[64px]"
          rows={3}
        />
        <div className="text-[10px] text-muted-foreground text-right">
          {note.length}/{NOTE_MAX_LEN}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {isEditMode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={submitting}
            className="h-7 text-[12px] text-red-700 hover:text-red-800 dark:text-red-300"
          >
            Remove
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={submitting}
          className="h-7 text-[12px]"
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={submitting} className="h-7 text-[12px]">
          {submitting ? "Saving…" : isEditMode ? "Update" : "Save feedback"}
        </Button>
      </div>
      {error && (
        <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
      )}
    </div>
  );
}
