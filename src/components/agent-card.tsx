import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent, formatHours, formatNumber } from "@/lib/utils";
import type { AgentStats } from "@/lib/types";

function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
      {initials}
    </div>
  );
}

export function AgentCard({ agent }: { agent: AgentStats }) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Initials name={agent.name} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold truncate">{agent.name}</h3>
                {agent.win_rate_pct !== null && agent.win_rate_pct >= 40 && (
                  <Badge variant="secondary" className="text-xs">
                    Top performer
                  </Badge>
                )}
              </div>
              {agent.total_jobs === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">No activity yet</p>
              ) : (
                <div className="grid grid-cols-3 gap-x-4 gap-y-2 mt-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Jobs</p>
                    <p className="font-medium">{formatNumber(agent.total_jobs)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Sent</p>
                    <p className="font-medium">{formatNumber(agent.proposals_sent)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Won</p>
                    <p className="font-medium">{agent.won}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Win Rate</p>
                    <p className="font-medium">
                      {agent.win_rate_pct !== null ? formatPercent(agent.win_rate_pct) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Avg Response</p>
                    <p className="font-medium">{formatHours(agent.avg_response_hours)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Revenue</p>
                    <p className="font-medium">{formatCurrency(agent.total_revenue)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
