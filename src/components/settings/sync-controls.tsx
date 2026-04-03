"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { triggerSheetsSync } from "@/lib/actions";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export function SyncControls() {
  const [sheetsLoading, setSheetsLoading] = useState(false);

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
          onClick={handleSheetsSync}
          disabled={sheetsLoading}
          variant="outline"
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${sheetsLoading ? "animate-spin" : ""}`}
          />
          {sheetsLoading ? "Syncing..." : "Sync Google Sheets"}
        </Button>
      </CardContent>
    </Card>
  );
}
