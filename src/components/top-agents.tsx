import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import { formatPercent, formatCurrency } from "@/lib/utils";
import type { AgentStats } from "@/lib/types";

export function TopAgents({ agents }: { agents: AgentStats[] }) {
  if (agents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Top Agents by Win Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No agent data yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Trophy className="h-4 w-4 text-muted-foreground" />
          Top Agents by Win Rate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {agents.map((agent, i) => (
          <div key={agent.id} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium leading-none">{agent.name}</p>
                <p className="text-xs text-muted-foreground">
                  {agent.won}W / {agent.lost}L &middot; {formatCurrency(agent.total_revenue)}
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold">
              {agent.win_rate_pct !== null ? formatPercent(agent.win_rate_pct) : "—"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
