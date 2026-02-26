import { Suspense } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KPICards } from "@/components/kpi-cards";
import {
  RevenueChart,
  StatusFunnelChart,
  VolumeChart,
  RevenueByEntityChart,
  BudgetTypeSplit,
} from "@/components/charts";
import { RecentActivityTable } from "@/components/recent-sales-table";
import { DateRangePicker } from "@/components/date-range-picker";
import { TopAgents } from "@/components/top-agents";
import { TopProfiles } from "@/components/top-profiles";
import { SystemHealthCard } from "@/components/system-health";
import {
  getKPIMetrics,
  getRevenueOverTime,
  getJobVolumeOverTime,
  getStatusFunnel,
  getRecentActivity,
  getTopAgentsByWinRate,
  getTopProfilesByVolume,
  getSystemHealth,
  getRevenueByAgent,
  getRevenueByBudgetType,
} from "@/lib/data";
import type { DateRange } from "@/lib/types";

export const revalidate = 300;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const days = parseInt(params.range || "30", 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const range: DateRange = {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };

  const [
    kpiMetrics,
    revenueOverTime,
    jobVolume,
    statusFunnel,
    recentActivity,
    topAgents,
    topProfiles,
    systemHealth,
    revenueByAgent,
    revenueByBudgetType,
  ] = await Promise.all([
    getKPIMetrics(range),
    getRevenueOverTime(range),
    getJobVolumeOverTime(range),
    getStatusFunnel(range),
    getRecentActivity(),
    getTopAgentsByWinRate(3, range),
    getTopProfilesByVolume(3, range),
    getSystemHealth(),
    getRevenueByAgent(range),
    getRevenueByBudgetType(range),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Job proposals, win rates, and revenue at a glance.
          </p>
        </div>
        <Suspense>
          <DateRangePicker />
        </Suspense>
      </div>

      <Separator />

      {kpiMetrics.totalJobs === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <Briefcase className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Welcome to Vollna Analytics</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                No job data yet. Connect your Google Sheet or sync from ClickUp to get started.
              </p>
            </div>
            <Button asChild>
              <Link href="/settings">Go to Settings</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
      <>
      <KPICards metrics={kpiMetrics} />

      <RevenueChart data={revenueOverTime} />

      <div className="grid gap-4 md:grid-cols-2">
        <VolumeChart data={jobVolume} />
        <StatusFunnelChart data={statusFunnel} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RevenueByEntityChart data={revenueByAgent} title="Revenue by Agent" />
        <BudgetTypeSplit data={revenueByBudgetType} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TopAgents agents={topAgents} />
        <TopProfiles profiles={topProfiles} />
        <SystemHealthCard health={systemHealth} />
      </div>

      <RecentActivityTable events={recentActivity} />
      </>
      )}
    </div>
  );
}
