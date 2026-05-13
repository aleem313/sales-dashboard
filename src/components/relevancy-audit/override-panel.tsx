"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface OverridePanelProps {
  scoreId: number;
  existingOverride: { override_id: number; note: string | null; created_at: string } | null;
  onClose: () => void;
  onSaved: () => void;
  onRemoved: () => void;
}

const NOTE_MAX_LEN = 2000;

export function OverridePanel({
  scoreId,
  existingOverride,
  onClose,
  onSaved,
  onRemoved,
}: OverridePanelProps) {
  const [note, setNote] = useState(existingOverride?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = existingOverride !== null;

  async function handleSave() {
    setSubmitting(true);
    setError(null);

    try {
      // Edit-mode = delete-and-recreate (the spec describes it as "Update" but
      // the simpler implementation is destructive: the API doesn't yet have a
      // PATCH route, and admins can only edit their own overrides anyway).
      if (isEditMode && existingOverride) {
        const del = await fetch(
          `/api/relevancy-audit/overrides/${existingOverride.override_id}`,
          { method: "DELETE" }
        );
        if (!del.ok && del.status !== 204) {
          const body = await del.json().catch(() => ({}));
          setError(body.error ?? `Delete failed (${del.status})`);
          setSubmitting(false);
          return;
        }
      }

      const res = await fetch("/api/relevancy-audit/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score_id: scoreId,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Save failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!existingOverride) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/relevancy-audit/overrides/${existingOverride.override_id}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Remove failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={`override-note-${scoreId}`}
        className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Why is this a wrong reject? (optional)
      </label>
      <textarea
        id={`override-note-${scoreId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={NOTE_MAX_LEN}
        placeholder="Add a note for future calibration… (e.g. 'client mentioned AI integration despite the stack mismatch')"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:border-primary focus:outline-none min-h-[80px]"
        rows={3}
        autoFocus
      />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {note.length}/{NOTE_MAX_LEN}
        </div>
        <div className="flex items-center gap-2">
          {isEditMode && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={submitting}
              className="text-red-700 hover:text-red-800 dark:text-red-300"
            >
              Remove override
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : isEditMode ? "Update" : "Save"}
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-[12px] text-red-700 dark:text-red-300">{error}</p>
      )}
    </div>
  );
}
