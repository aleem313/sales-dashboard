"use client";

import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { BudgetWinRate } from "@/lib/types";

export function BudgetIntelligence({ data }: { data: BudgetWinRate[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget Intelligence</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No budget data available yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="count"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                  formatter={(value: number | undefined) => [value ?? 0]}
                />
                <Legend />
                <Bar
                  yAxisId="count"
                  dataKey="total"
                  name="Total Proposals"
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="win_rate_pct"
                  name="Win Rate %"
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS[2], r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
