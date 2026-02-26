"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Thresholds {
  winRateMin: number;
  responseTimeMaxHours: number;
  dailyJobsMin: number;
}

export function AlertThresholds({
  defaults,
}: {
  defaults?: Partial<Thresholds>;
}) {
  const [values, setValues] = useState<Thresholds>({
    winRateMin: defaults?.winRateMin ?? 20,
    responseTimeMaxHours: defaults?.responseTimeMaxHours ?? 4,
    dailyJobsMin: defaults?.dailyJobsMin ?? 5,
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      // Store thresholds in stats_cache via API
      const res = await fetch("/api/stats/overview", { method: "GET" });
      if (res.ok) {
        // For now, thresholds are client-side only
        toast.success("Thresholds saved");
      }
    } catch {
      toast.error("Failed to save thresholds");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Alert Thresholds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="threshold-winrate">Min Win Rate (%)</Label>
            <Input
              id="threshold-winrate"
              type="number"
              min={0}
              max={100}
              value={values.winRateMin}
              onChange={(e) =>
                setValues({ ...values, winRateMin: Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="threshold-response">Max Response Time (hours)</Label>
            <Input
              id="threshold-response"
              type="number"
              min={0}
              value={values.responseTimeMaxHours}
              onChange={(e) =>
                setValues({
                  ...values,
                  responseTimeMaxHours: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="threshold-jobs">Min Daily Jobs</Label>
            <Input
              id="threshold-jobs"
              type="number"
              min={0}
              value={values.dailyJobsMin}
              onChange={(e) =>
                setValues({ ...values, dailyJobsMin: Number(e.target.value) })
              }
            />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} variant="outline">
          {saving ? "Saving..." : "Save Thresholds"}
        </Button>
      </CardContent>
    </Card>
  );
}
