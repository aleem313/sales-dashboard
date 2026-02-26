"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { CountryStats } from "@/lib/types";

export function CountryHeatmap({ data }: { data: CountryStats[] }) {
  const top15 = data.slice(0, 15);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs by Country</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          {top15.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No country data available yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={top15}
                layout="vertical"
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="country"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0, "Total Jobs"]}
                  labelFormatter={(label) => {
                    const entry = top15.find((d) => d.country === label);
                    return `${label} — Win Rate: ${entry?.win_rate_pct ?? "N/A"}%`;
                  }}
                />
                <Bar dataKey="total" name="total" radius={[0, 4, 4, 0]}>
                  {top15.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
