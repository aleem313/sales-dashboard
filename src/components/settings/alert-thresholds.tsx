"use client";

import { useState, useEffect } from "react";
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

const DEFAULTS: Thresholds = {
  winRateMin: 20,
  responseTimeMaxHours: 4,
  dailyJobsMin: 5,
};

export function AlertThresholds() {
  const [values, setValues] = useState<Thresholds>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/thresholds")
      .then((res) => res.json())
      .then((data: Thresholds) => {
        setValues(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        toast.success("Thresholds saved");
      } else {
        toast.error("Failed to save thresholds");
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
              disabled={!loaded}
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
              disabled={!loaded}
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
              disabled={!loaded}
              onChange={(e) =>
                setValues({ ...values, dailyJobsMin: Number(e.target.value) })
              }
            />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || !loaded} variant="outline">
          {saving ? "Saving..." : "Save Thresholds"}
        </Button>
      </CardContent>
    </Card>
  );
}
