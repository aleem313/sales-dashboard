"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissAlertAction } from "@/lib/actions";
import type { Alert } from "@/lib/types";

export function AlertsBanner({ alerts: initial }: { alerts: Alert[] }) {
  const [alerts, setAlerts] = useState(initial);

  if (alerts.length === 0) return null;

  async function handleDismiss(id: string) {
    await dismissAlertAction(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="flex-1 text-amber-800 dark:text-amber-200">
            {alert.message}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => handleDismiss(alert.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
