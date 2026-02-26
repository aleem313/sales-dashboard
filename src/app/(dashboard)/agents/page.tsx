import { Separator } from "@/components/ui/separator";
import { AgentCard } from "@/components/agent-card";
import { getAgentStats } from "@/lib/data";

export const revalidate = 300;

export default async function AgentsPage() {
  const agents = await getAgentStats();

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Performance tracking for all {agents.length} agents.
        </p>
      </div>

      <Separator />

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents found. Add agents in Settings.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
