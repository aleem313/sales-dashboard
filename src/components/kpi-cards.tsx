import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, ShoppingCart, TrendingUp, Target } from "lucide-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { KPIMetrics } from "@/lib/types";

export function KPICards({ metrics }: { metrics: KPIMetrics }) {
  const cards = [
    {
      title: "Total Revenue",
      value: formatCurrency(metrics.totalRevenue),
      icon: DollarSign,
    },
    {
      title: "Total Orders",
      value: formatNumber(metrics.totalOrders),
      icon: ShoppingCart,
    },
    {
      title: "Avg Order Value",
      value: formatCurrency(metrics.avgOrderValue),
      icon: TrendingUp,
    },
    {
      title: "Completion Rate",
      value: formatPercent(metrics.conversionRate),
      icon: Target,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
