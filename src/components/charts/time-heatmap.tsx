"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TimeSlotStats } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getColor(winRate: number | null): string {
  if (winRate == null) return "hsl(var(--muted))";
  if (winRate >= 60) return "hsl(142, 71%, 35%)";
  if (winRate >= 40) return "hsl(142, 71%, 45%)";
  if (winRate >= 20) return "hsl(142, 50%, 60%)";
  if (winRate > 0) return "hsl(142, 30%, 75%)";
  return "hsl(var(--muted))";
}

export function TimeHeatmap({ data }: { data: TimeSlotStats[] }) {
  // Build lookup map
  const lookup = new Map<string, TimeSlotStats>();
  for (const item of data) {
    lookup.set(`${item.day}-${item.hour}`, item);
  }

  const hasData = data.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Best Time to Apply</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            No timing data available yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Hour labels */}
              <div className="flex">
                <div className="w-10 shrink-0" />
                {HOURS.filter((h) => h % 3 === 0).map((h) => (
                  <div
                    key={h}
                    className="text-xs text-muted-foreground"
                    style={{ width: `${(100 / 24) * 3}%` }}
                  >
                    {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
                  </div>
                ))}
              </div>
              {/* Grid rows */}
              {DAYS.map((day, dayIdx) => (
                <div key={day} className="flex items-center gap-0.5 mb-0.5">
                  <div className="w-10 shrink-0 text-xs text-muted-foreground text-right pr-2">
                    {day}
                  </div>
                  {HOURS.map((hour) => {
                    const slot = lookup.get(`${dayIdx}-${hour}`);
                    return (
                      <div
                        key={hour}
                        className="flex-1 aspect-square rounded-sm cursor-default transition-colors"
                        style={{
                          backgroundColor: getColor(slot?.win_rate_pct ?? null),
                          minWidth: "12px",
                          minHeight: "12px",
                        }}
                        title={
                          slot
                            ? `${day} ${hour}:00 — ${slot.total} jobs, ${slot.won} won (${slot.win_rate_pct ?? 0}%)`
                            : `${day} ${hour}:00 — no data`
                        }
                      />
                    );
                  })}
                </div>
              ))}
              {/* Legend */}
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <span>Win rate:</span>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(var(--muted))" }} />
                  <span>0%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 30%, 75%)" }} />
                  <span>1-20%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 50%, 60%)" }} />
                  <span>20-40%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 71%, 45%)" }} />
                  <span>40-60%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 71%, 35%)" }} />
                  <span>60%+</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
