"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const globalIsShadow = settings.classifier_mode === "shadow";

  function handleModeFlip(next: ClassifierMode) {
    if (next === settings.classifier_mode) return;
    startTransition(async () => {
      try {
        await setRelevancyModeAction(next);
        setSettings((s) => ({ ...s, classifier_mode: next, mode_updated_at: new Date().toISOString() }));
        toast.success(`Classifier mode set to ${next}`);
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
        toast.success(`${profileId}: ${enabled ? "Active" : "Shadow"}`);
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
                          {effectiveMode}
                        </span>
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
    </Card>
  );
}
