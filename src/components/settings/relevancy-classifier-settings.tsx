"use client";

import { useState, useTransition, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import {
  setRelevancyModeAction,
  setMinScoreAction,
  setProfileClassifierConfigAction,
} from "@/lib/actions";
import type {
  ClassifierMode,
  RelevancySystemSettings,
  ProfileClassifierConfig,
} from "@/lib/types";

interface ThresholdPreview {
  window_days: number;
  profile_id: string | null;
  total: number;
  scored: number;
  by_decision: Record<string, number>;
  by_effective_decision: Record<string, number>;
  proceeds_total: number;
  would_flip: Array<{ threshold: number; count: number; pct_of_proceeds: number }>;
  score_distribution: Array<{ band: string; count: number }>;
}

interface Props {
  initialSettings: RelevancySystemSettings;
  initialProfiles: ProfileClassifierConfig[];
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RelevancyClassifierSettings({ initialSettings, initialProfiles }: Props) {
  const [settings, setSettings] = useState<RelevancySystemSettings>(initialSettings);
  const [profiles, setProfiles] = useState<ProfileClassifierConfig[]>(initialProfiles);
  const [minScoreDraft, setMinScoreDraft] = useState<string>(String(initialSettings.min_score));
  const [pending, startTransition] = useTransition();
  const [pendingFlip, setPendingFlip] = useState<ClassifierMode | null>(null);
  // Pre-initialised to a "loading" state to avoid synchronous setState-in-effect.
  const [preview, setPreview] = useState<ThresholdPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const globalIsShadow = settings.classifier_mode === "shadow";

  // Load the global threshold preview (last 7 days, all profiles).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/threshold-preview?days=7", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ThresholdPreview>;
      })
      .then((d) => {
        if (!cancelled) {
          setPreview(d);
          setPreviewLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewError((e as Error).message);
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Interpolated estimate for a draft min_score, based on the 5 sampled
  // thresholds [40, 50, 60, 70, 80]. Linear between two adjacent samples;
  // edge cases clamp to the nearest sample's count.
  // (React Compiler memos this; no useMemo needed.)
  let draftFlipEstimate: { threshold: number; count: number; pct_of_proceeds: number } | null = null;
  if (preview && preview.proceeds_total > 0) {
    const v = parseInt(minScoreDraft, 10);
    if (Number.isInteger(v) && v >= 0 && v <= 100) {
      const samples = preview.would_flip;
      if (samples.length > 0) {
        if (v <= samples[0].threshold) draftFlipEstimate = samples[0];
        else if (v >= samples[samples.length - 1].threshold)
          draftFlipEstimate = samples[samples.length - 1];
        else {
          for (let i = 0; i < samples.length - 1; i++) {
            const a = samples[i];
            const b = samples[i + 1];
            if (v >= a.threshold && v <= b.threshold) {
              const span = b.threshold - a.threshold;
              const t = span === 0 ? 0 : (v - a.threshold) / span;
              const count = Math.round(a.count + (b.count - a.count) * t);
              const pct = Math.round((count / preview.proceeds_total) * 1000) / 10;
              draftFlipEstimate = { threshold: v, count, pct_of_proceeds: pct };
              break;
            }
          }
        }
      }
    }
  }

  function handleModeFlip(next: ClassifierMode) {
    if (next === settings.classifier_mode) return;
    // Open the confirmation dialog — actual mutation happens in confirmFlip().
    setPendingFlip(next);
  }

  function confirmFlip() {
    if (pendingFlip === null) return;
    const target = pendingFlip;
    startTransition(async () => {
      try {
        await setRelevancyModeAction(target);
        setSettings((s) => ({ ...s, classifier_mode: target, mode_updated_at: new Date().toISOString() }));
        toast.success(`Classifier mode set to ${target}`);
        setPendingFlip(null);
      } catch (e) {
        toast.error((e as Error).message || "Failed to update mode");
      }
    });
  }

  function handleMinScoreSave() {
    const value = parseInt(minScoreDraft, 10);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      toast.error("Min score must be an integer between 0 and 100");
      return;
    }
    if (value === settings.min_score) {
      toast.info("No change");
      return;
    }
    startTransition(async () => {
      try {
        await setMinScoreAction(value);
        setSettings((s) => ({ ...s, min_score: value, score_updated_at: new Date().toISOString() }));
        toast.success(`Min score set to ${value}`);
      } catch (e) {
        toast.error((e as Error).message || "Failed to update min score");
      }
    });
  }

  function handleProfileToggle(profileId: string, enabled: boolean) {
    startTransition(async () => {
      try {
        await setProfileClassifierConfigAction(profileId, { classifier_enabled: enabled });
        setProfiles((rows) =>
          rows.map((r) =>
            r.profile_id === profileId ? { ...r, classifier_enabled: enabled } : r
          )
        );
        toast.success(`${profileId}: ${enabled ? "Enabled" : "Disabled"}`);
      } catch (e) {
        toast.error((e as Error).message || "Failed to update profile");
      }
    });
  }

  function handleProfileMinOverride(profileId: string, rawValue: string) {
    const trimmed = rawValue.trim();
    const value: number | null = trimmed === "" ? null : parseInt(trimmed, 10);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100)) {
      toast.error("Override must be empty or 0-100");
      return;
    }
    startTransition(async () => {
      try {
        await setProfileClassifierConfigAction(profileId, { min_score_override: value });
        setProfiles((rows) =>
          rows.map((r) =>
            r.profile_id === profileId ? { ...r, min_score_override: value } : r
          )
        );
        toast.success(`${profileId}: override ${value === null ? "cleared" : `= ${value}`}`);
      } catch (e) {
        toast.error((e as Error).message || "Failed to update override");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium">Relevancy Classifier</CardTitle>
          <Badge variant={globalIsShadow ? "outline" : "default"}>
            Global: {settings.classifier_mode}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Global mode</Label>
              <p className="text-xs text-muted-foreground">
                {globalIsShadow
                  ? "Every job is scored AND the existing proposal writer runs. AI verdict logged but does NOT route — all cards land in Todo with the relevancy badge. Per-profile toggles are inert."
                  : "Per-profile toggles drive routing. A profile set to Shadow here will be scored but not routed by the AI."}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-muted p-1">
              <Button
                size="sm"
                variant={globalIsShadow ? "default" : "ghost"}
                onClick={() => handleModeFlip("shadow")}
                disabled={pending}
              >
                Shadow
              </Button>
              <Button
                size="sm"
                variant={!globalIsShadow ? "default" : "ghost"}
                onClick={() => handleModeFlip("active")}
                disabled={pending}
              >
                Active
              </Button>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="min-score" className="text-sm font-medium">
                Minimum score
              </Label>
              <p className="text-xs text-muted-foreground">
                Only enforced when Active. Proceeds with total_score below this flip to reject.
              </p>
            </div>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              value={minScoreDraft}
              onChange={(e) => setMinScoreDraft(e.target.value)}
              className="w-24"
              disabled={pending}
            />
            <Button
              onClick={handleMinScoreSave}
              disabled={pending || parseInt(minScoreDraft, 10) === settings.min_score}
              size="sm"
            >
              Save
            </Button>
          </div>

          {/* Threshold preview — last 7 days */}
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">
                Threshold preview <span className="text-muted-foreground">· last 7 days</span>
              </span>
            </div>
            {previewLoading && <div className="text-muted-foreground">Loading…</div>}
            {previewError && (
              <div className="text-amber-700 dark:text-amber-300">
                Preview unavailable: {previewError}
              </div>
            )}
            {preview && !previewLoading && (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-4">
                  <span>
                    Total scored:{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {preview.scored}
                    </span>
                  </span>
                  <span>
                    Proceeds:{" "}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {preview.by_decision.proceed ?? 0}
                    </span>
                  </span>
                  <span>
                    Rejects:{" "}
                    <span className="font-semibold text-red-700 dark:text-red-300 tabular-nums">
                      {preview.by_decision.reject ?? 0}
                    </span>
                  </span>
                  <span>
                    Reviews:{" "}
                    <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                      {preview.by_decision.review ?? 0}
                    </span>
                  </span>
                </div>
                {preview.proceeds_total > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-muted-foreground">
                      At <span className="font-semibold text-foreground tabular-nums">
                        min_score = {draftFlipEstimate?.threshold ?? "—"}
                      </span>{" "}
                      —{" "}
                      <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {draftFlipEstimate?.count ?? 0}
                      </span>{" "}
                      of {preview.proceeds_total} proceeds (
                      <span className="tabular-nums">
                        {draftFlipEstimate?.pct_of_proceeds ?? 0}%
                      </span>
                      ) would flip to reject when Active.
                    </div>
                    <div className="flex gap-2 text-[11px] text-muted-foreground">
                      {preview.would_flip.map((s) => (
                        <span
                          key={s.threshold}
                          className={
                            parseInt(minScoreDraft, 10) === s.threshold
                              ? "font-semibold text-foreground"
                              : ""
                          }
                          title={`${s.count}/${preview.proceeds_total} proceeds`}
                        >
                          {s.threshold}: {s.pct_of_proceeds}%
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">
                    No proceed verdicts in window — can&apos;t estimate flips yet.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Mode last changed: {formatTimeAgo(settings.mode_updated_at)}
            {settings.mode_updated_by && ` by ${settings.mode_updated_by}`}
            {" · "}
            Min score last changed: {formatTimeAgo(settings.score_updated_at)}
            {settings.score_updated_by && ` by ${settings.score_updated_by}`}
          </div>
        </div>

        {/* Per-profile table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Per-profile overrides</Label>
            {globalIsShadow && (
              <span className="text-xs text-muted-foreground">
                Inert while global is Shadow
              </span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Min score</TableHead>
                <TableHead>Snapshot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => {
                const stateLabel = p.classifier_enabled ? "enabled" : "disabled";
                const effectiveMode = globalIsShadow ? "shadow" : p.classifier_enabled ? "active" : "shadow";
                const effectiveMin = p.min_score_override ?? settings.min_score;
                return (
                  <TableRow key={p.profile_id}>
                    <TableCell className="font-medium">{p.profile_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.classifier_enabled}
                          disabled={pending || globalIsShadow}
                          onCheckedChange={(checked) => handleProfileToggle(p.profile_id, checked)}
                          aria-label={`Toggle classifier for ${p.profile_name}`}
                        />
                        <span className={globalIsShadow ? "text-muted-foreground text-xs" : "text-xs"}>
                          {stateLabel}
                        </span>
                        {!globalIsShadow && p.classifier_enabled && (
                          <span className="text-xs text-muted-foreground">
                            → {effectiveMode}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {globalIsShadow || !p.classifier_enabled ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={p.min_score_override ?? ""}
                            placeholder={String(settings.min_score)}
                            className="w-20"
                            disabled={pending}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              const current = p.min_score_override;
                              const candidate = v === "" ? null : parseInt(v, 10);
                              if (candidate !== current) {
                                handleProfileMinOverride(p.profile_id, v);
                              }
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {p.min_score_override !== null ? "override" : `inherits ${effectiveMin}`}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.has_snapshot ? (
                        <Badge variant="outline" className="text-xs">loaded</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">missing</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Confirmation modal — Phase 14 guardrail against misclicks during rollout */}
      <Dialog
        open={pendingFlip !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFlip(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingFlip === "active" ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : (
                <Info className="h-5 w-5 text-muted-foreground" />
              )}
              Flip global mode to <span className="font-mono">{pendingFlip}</span>?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm text-foreground">
                {pendingFlip === "active" ? (
                  <>
                    <p>
                      Going <strong>Active</strong> changes the auto pipeline:
                    </p>
                    <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
                      <li>
                        Cards whose classifier verdict is{" "}
                        <code className="rounded bg-muted px-1">reject</code> (or{" "}
                        <code className="rounded bg-muted px-1">proceed</code> with{" "}
                        <code className="rounded bg-muted px-1">total_score &lt; min</code>)
                        will <strong>stop being created on the Task Board</strong>.
                      </li>
                      <li>
                        Takes effect within ~60s (cache TTL on the profile-context
                        endpoint that n8n&apos;s C1 reads).
                      </li>
                      <li>
                        Per-profile <em>classifier_enabled</em> toggles below become live
                        — a profile set to disabled stays in Shadow even after this flip.
                      </li>
                      <li>
                        Rollback: flip back to{" "}
                        <code className="rounded bg-muted px-1">Shadow</code> here, or
                        set{" "}
                        <code className="rounded bg-muted px-1">
                          RELEVANCY_CLASSIFIER_ENABLED=false
                        </code>{" "}
                        in n8n cloud env (~30s kill-switch).
                      </li>
                    </ul>
                    {preview && preview.proceeds_total > 0 && draftFlipEstimate && (
                      <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-2.5 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-200">
                        Based on last 7 days at current{" "}
                        <strong>min_score = {settings.min_score}</strong>:{" "}
                        {draftFlipEstimate.count} of {preview.proceeds_total} proceeds
                        ({draftFlipEstimate.pct_of_proceeds}%) would have been flipped to
                        reject.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      Going <strong>Shadow</strong> reverts the auto pipeline to
                      logging-only:
                    </p>
                    <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
                      <li>
                        Every job is scored AND the existing proposal writer runs.
                      </li>
                      <li>
                        All cards land in <code className="rounded bg-muted px-1">Todo</code>{" "}
                        with the relevancy badge — agents triage manually.
                      </li>
                      <li>
                        Per-profile <em>classifier_enabled</em> toggles become inert
                        (visible but no effect).
                      </li>
                      <li>Takes effect within ~60s.</li>
                    </ul>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setPendingFlip(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmFlip}
              disabled={pending}
              className={
                pendingFlip === "active"
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : ""
              }
            >
              {pending
                ? "Applying…"
                : pendingFlip === "active"
                  ? "Flip to Active"
                  : "Flip to Shadow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
