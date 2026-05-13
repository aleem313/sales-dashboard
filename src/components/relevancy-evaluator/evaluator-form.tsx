"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VerdictPanel, type Verdict } from "./verdict-panel";

interface ProfileOption {
  profile_id: string;
  profile_name: string;
  has_snapshot: boolean;
}

interface EvaluatorFormProps {
  profiles: ProfileOption[];
  initialTaskInput: string;
  initialProfileId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_URL_RE = /\/(?:tasks|my-tasks)\?(?:[^#]*&)?task=([0-9a-f-]{36})(?:[&#].*)?$/i;

function extractTaskIdFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
  const m = trimmed.match(TASK_URL_RE);
  if (m) return m[1].toLowerCase();
  // Fallback: parse as URL
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    if (path !== "/tasks" && path !== "/my-tasks") return null;
    const tp = u.searchParams.get("task");
    if (tp && UUID_RE.test(tp)) return tp.toLowerCase();
  } catch {
    /* not a URL */
  }
  return null;
}

export function EvaluatorForm({
  profiles,
  initialTaskInput,
  initialProfileId,
}: EvaluatorFormProps) {
  const [taskInput, setTaskInput] = useState(initialTaskInput);
  const [profileId, setProfileId] = useState(
    initialProfileId && profiles.find((p) => p.profile_id === initialProfileId)?.has_snapshot
      ? initialProfileId
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "validate" | "load" | "classify">("idle");

  const parsedTaskId = extractTaskIdFromInput(taskInput);
  const canSubmit = !!parsedTaskId && !!profileId && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !parsedTaskId) return;

    setLoading(true);
    setVerdict(null);
    setStage("validate");
    setResolvedTaskId(parsedTaskId);

    try {
      // Tiny artificial stage hop so the user sees something move in the
      // sub-2s warm path. The actual progress events are wrapped in one
      // network round-trip per the v3.3 plan (no SSE at this stage).
      setTimeout(() => setStage((s) => (s === "validate" ? "load" : s)), 250);
      setTimeout(() => setStage((s) => (s === "load" ? "classify" : s)), 600);

      const res = await fetch("/api/relevancy/evaluate-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: parsedTaskId,
          profile_id: profileId,
        }),
      });

      const data: {
        verdict?: Verdict;
        error?: string;
        detail?: string;
        exceeded?: string;
        upstream_status?: number;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          data?.error === "rate_limited"
            ? `Rate limit reached (${data.exceeded ?? "per-hour"}). Try again later.`
            : data?.error === "task_not_found"
              ? "Task not found on the Task Board."
              : data?.error === "profile_snapshot_missing"
                ? "This profile has no Upwork snapshot. Upload one in Settings first."
                : data?.error === "n8n_timeout"
                  ? "Classifier timed out. Retry in a moment."
                  : data?.error === "n8n_unreachable"
                    ? "Classifier service is unreachable."
                    : data?.error ?? `Request failed (HTTP ${res.status})`;
        toast.error(msg);
        return;
      }

      if (data.verdict) {
        setVerdict(data.verdict);
        toast.success("Verdict received");
      } else {
        toast.error("Empty verdict from classifier");
      }
    } catch (err) {
      toast.error("Network error: " + (err as Error).message);
    } finally {
      setLoading(false);
      setStage("idle");
    }
  }

  function handleRerun() {
    if (!parsedTaskId || !profileId) return;
    void handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  }

  function handleCopyJson() {
    if (!verdict) return;
    navigator.clipboard
      .writeText(JSON.stringify(verdict, null, 2))
      .then(() => toast.success("Verdict JSON copied"))
      .catch(() => toast.error("Copy failed"));
  }

  const stageLabel =
    stage === "validate"
      ? "Loading task…"
      : stage === "load"
        ? "Loading profile context…"
        : stage === "classify"
          ? "Running classifier…"
          : "";

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-border bg-card p-5"
      >
        <div className="space-y-2">
          <Label htmlFor="task-input">Task card URL or UUID</Label>
          <Input
            id="task-input"
            type="text"
            placeholder="http://157.173.110.62/tasks?task=0378386f-9717-…"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          {taskInput && !parsedTaskId && (
            <p className="text-[12px] text-destructive">
              Couldn&rsquo;t find a task UUID. Paste a URL like{" "}
              <code className="rounded bg-muted px-1">/tasks?task=…</code> or a
              bare UUID.
            </p>
          )}
          {parsedTaskId && (
            <p className="text-[12px] text-muted-foreground">
              Resolved task: <code className="text-foreground">{parsedTaskId}</code>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-select">Profile</Label>
          <Select
            value={profileId}
            onValueChange={setProfileId}
            disabled={loading}
          >
            <SelectTrigger id="profile-select" className="w-full">
              <SelectValue placeholder="Select a profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-muted-foreground">
                  No active profiles
                </div>
              ) : (
                profiles.map((p) => (
                  <SelectItem
                    key={p.profile_id}
                    value={p.profile_id}
                    disabled={!p.has_snapshot}
                  >
                    {p.profile_name}
                    {!p.has_snapshot && (
                      <span className="ml-2 text-[12px] text-muted-foreground">
                        (no snapshot)
                      </span>
                    )}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-[12px] text-muted-foreground">
            Profiles without a current Upwork snapshot are disabled.{" "}
            <a href="/settings" className="underline">
              Upload one
            </a>{" "}
            to enable.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {stageLabel}
              </span>
            ) : (
              "Read-only — does not move the card or send anything to Upwork."
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {loading ? "Evaluating…" : "Evaluate"}
            </Button>
          </div>
        </div>
      </form>

      {verdict && resolvedTaskId && (
        <VerdictPanel
          verdict={verdict}
          taskId={resolvedTaskId}
          onRerun={handleRerun}
          onCopyJson={handleCopyJson}
          rerunDisabled={loading || !parsedTaskId || !profileId}
        />
      )}

      {!verdict && resolvedTaskId && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {stageLabel}
            </span>
          ) : (
            <>
              No verdict yet — submit the form to evaluate{" "}
              <code className="text-foreground">{resolvedTaskId}</code>.
              <a
                href={`/tasks?task=${resolvedTaskId}`}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 underline"
              >
                Open card <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
