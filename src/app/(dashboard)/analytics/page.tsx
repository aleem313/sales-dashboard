import { Separator } from "@/components/ui/separator";
import {
  ModelComparison,
  CountryHeatmap,
  TimeHeatmap,
  BudgetIntelligence,
} from "@/components/charts";
import {
  getProposalAnalytics,
  getCountryStats,
  getBestTimeToApply,
  getBudgetWinRate,
} from "@/lib/data";

export const revalidate = 300;

export default async function AnalyticsPage() {
  const [modelData, countryData, timeData, budgetData] = await Promise.all([
    getProposalAnalytics(),
    getCountryStats(),
    getBestTimeToApply(),
    getBudgetWinRate(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Proposal intelligence, country insights, and timing analysis.
        </p>
      </div>

      <Separator />

      <ModelComparison data={modelData} />

      <div className="grid gap-4 md:grid-cols-2">
        <CountryHeatmap data={countryData} />
        <BudgetIntelligence data={budgetData} />
      </div>

      <TimeHeatmap data={timeData} />
    </div>
  );
}
