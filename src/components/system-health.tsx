import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { formatRelativeTime, formatNumber, formatPercent } from "@/lib/utils";
import type { SystemHealth } from "@/lib/types";

function StatusDot({ status }: { status: "green" | "yellow" | "red" }) {
  const colors = {
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
  };
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
  );
}

export function SystemHealthCard({ health }: { health: SystemHealth }) {
  const syncAge = health.lastSyncAt
    ? (Date.now() - new Date(health.lastSyncAt).getTime()) / 60000
    : Infinity;

  const syncStatus: "green" | "yellow" | "red" =
    syncAge < 30 ? "green" : syncAge < 120 ? "yellow" : "red";

  const gptStatus: "green" | "yellow" | "red" =
    health.gptFailureRate < 5 ? "green" : health.gptFailureRate < 15 ? "yellow" : "red";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-muted-foreground" />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={syncStatus} />
            <span className="text-sm">Last Sync</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {health.lastSyncAt ? formatRelativeTime(health.lastSyncAt) : "Never"}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={gptStatus} />
            <span className="text-sm">GPT Failure Rate</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {formatPercent(health.gptFailureRate)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status="green" />
            <span className="text-sm">Open Jobs</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {formatNumber(health.openJobsCount)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
