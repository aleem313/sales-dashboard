import { Suspense } from "react";
import { Separator } from "@/components/ui/separator";
import { KPICards } from "@/components/kpi-cards";
import { RevenueChart } from "@/components/revenue-chart";
import { StatusFunnelChart } from "@/components/category-chart";
import { VolumeChart } from "@/components/region-chart";
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
import { RevenueByEntityChart } from "@/components/charts/revenue-by-entity";
import { BudgetTypeSplit } from "@/components/charts/budget-type-split";
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
    </div>
  );
}
