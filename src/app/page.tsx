import { Suspense } from "react";
import { Separator } from "@/components/ui/separator";
import { KPICards } from "@/components/kpi-cards";
import { RevenueChart } from "@/components/revenue-chart";
import { StatusFunnelChart } from "@/components/category-chart";
import { VolumeChart } from "@/components/region-chart";
import { RecentActivityTable } from "@/components/recent-sales-table";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  getKPIMetrics,
  getRevenueOverTime,
  getJobVolumeOverTime,
  getStatusFunnel,
  getRecentActivity,
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

  const [kpiMetrics, revenueOverTime, jobVolume, statusFunnel, recentActivity] =
    await Promise.all([
      getKPIMetrics(range),
      getRevenueOverTime(range),
      getJobVolumeOverTime(range),
      getStatusFunnel(range),
      getRecentActivity(),
    ]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Vollna Analytics</h1>
            <p className="text-muted-foreground">
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

        <RecentActivityTable events={recentActivity} />
      </div>
    </div>
  );
}
