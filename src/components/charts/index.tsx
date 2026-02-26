"use client";

import dynamic from "next/dynamic";

const ChartSkeleton = () => (
  <div className="rounded-xl border bg-card p-6 space-y-4">
    <div className="h-5 w-36 bg-muted animate-pulse rounded" />
    <div className="h-[350px] bg-muted animate-pulse rounded" />
  </div>
);

export const BudgetDistribution = dynamic(
  () =>
    import("./budget-distribution").then((mod) => mod.BudgetDistribution),
  { ssr: false, loading: ChartSkeleton }
);

export const RevenueByEntityChart = dynamic(
  () =>
    import("./revenue-by-entity").then((mod) => mod.RevenueByEntityChart),
  { ssr: false, loading: ChartSkeleton }
);

export const WinRateTrend = dynamic(
  () => import("./win-rate-trend").then((mod) => mod.WinRateTrend),
  { ssr: false, loading: ChartSkeleton }
);

export const SkillsChart = dynamic(
  () => import("./skills-chart").then((mod) => mod.SkillsChart),
  { ssr: false, loading: ChartSkeleton }
);

export const ResponseTimeChart = dynamic(
  () =>
    import("./response-time-chart").then((mod) => mod.ResponseTimeChart),
  { ssr: false, loading: ChartSkeleton }
);

export const BudgetTypeSplit = dynamic(
  () => import("./budget-type-split").then((mod) => mod.BudgetTypeSplit),
  { ssr: false, loading: ChartSkeleton }
);

export const RevenueChart = dynamic(
  () => import("../revenue-chart").then((mod) => mod.RevenueChart),
  { ssr: false, loading: ChartSkeleton }
);

export const StatusFunnelChart = dynamic(
  () => import("../category-chart").then((mod) => mod.StatusFunnelChart),
  { ssr: false, loading: ChartSkeleton }
);

export const VolumeChart = dynamic(
  () => import("../region-chart").then((mod) => mod.VolumeChart),
  { ssr: false, loading: ChartSkeleton }
);

// Phase 8 charts
export const ModelComparison = dynamic(
  () => import("./model-comparison").then((mod) => mod.ModelComparison),
  { ssr: false, loading: ChartSkeleton }
);

export const CountryHeatmap = dynamic(
  () => import("./country-heatmap").then((mod) => mod.CountryHeatmap),
  { ssr: false, loading: ChartSkeleton }
);

export const TimeHeatmap = dynamic(
  () => import("./time-heatmap").then((mod) => mod.TimeHeatmap),
  { ssr: false, loading: ChartSkeleton }
);

export const BudgetIntelligence = dynamic(
  () => import("./budget-intelligence").then((mod) => mod.BudgetIntelligence),
  { ssr: false, loading: ChartSkeleton }
);
