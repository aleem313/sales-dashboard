"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { triggerClickUpSync, triggerSheetsSync } from "@/lib/actions";
import { toast } from "sonner";
import { RefreshCw, Link } from "lucide-react";

export function SyncControls() {
  const [clickupLoading, setClickupLoading] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const searchParams = useSearchParams();

  // Show toast based on ClickUp OAuth redirect params
  useEffect(() => {
    const clickup = searchParams.get("clickup");
    const webhook = searchParams.get("webhook");
    if (clickup === "connected" && webhook === "created") {
      toast.success("ClickUp connected and webhook created!");
    } else if (clickup === "connected") {
      toast.success("ClickUp connected!");
      if (webhook === "failed") {
        toast.error("Failed to create webhook — create it manually in ClickUp settings");
      }
    } else if (clickup === "error") {
      toast.error(`ClickUp connection failed: ${searchParams.get("reason") ?? "unknown error"}`);
    }
  }, [searchParams]);

  async function handleClickUpSync() {
    setClickupLoading(true);
    try {
      const result = await triggerClickUpSync();
      if (result.error) {
        toast.error(`ClickUp sync failed: ${result.error}`);
      } else {
        toast.success(
          `ClickUp sync complete: ${result.synced ?? 0} checked, ${result.updated ?? 0} updated`
        );
      }
    } catch {
      toast.error("ClickUp sync failed");
    } finally {
      setClickupLoading(false);
    }
  }

  async function handleSheetsSync() {
    setSheetsLoading(true);
    try {
      const result = await triggerSheetsSync();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Sheets sync complete");
      }
    } catch {
      toast.error("Sheets sync failed");
    } finally {
      setSheetsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Data Sync</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button
          onClick={handleClickUpSync}
          disabled={clickupLoading}
          variant="outline"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${clickupLoading ? "animate-spin" : ""}`}
          />
          {clickupLoading ? "Syncing..." : "Sync ClickUp"}
        </Button>
        <Button
          onClick={handleSheetsSync}
          disabled={sheetsLoading}
          variant="outline"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${sheetsLoading ? "animate-spin" : ""}`}
          />
          {sheetsLoading ? "Syncing..." : "Sync Google Sheets"}
        </Button>
        <Button asChild variant="outline">
          <a href="/api/auth/clickup">
            <Link className="mr-2 h-4 w-4" />
            Connect ClickUp
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
