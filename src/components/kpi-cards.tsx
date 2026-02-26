import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, Send, Trophy, TrendingUp, DollarSign } from "lucide-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { KPIMetrics } from "@/lib/types";

export function KPICards({ metrics }: { metrics: KPIMetrics }) {
  const cards = [
    {
      title: "Total Jobs",
      value: formatNumber(metrics.totalJobs),
      icon: Briefcase,
    },
    {
      title: "Proposals Sent",
      value: formatNumber(metrics.proposalsSent),
      icon: Send,
    },
    {
      title: "Won",
      value: formatNumber(metrics.won),
      icon: Trophy,
    },
    {
      title: "Win Rate",
      value: formatPercent(metrics.winRate),
      icon: TrendingUp,
    },
    {
      title: "Revenue",
      value: formatCurrency(metrics.totalRevenue),
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
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
