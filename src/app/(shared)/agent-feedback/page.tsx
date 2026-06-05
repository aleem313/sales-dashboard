import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { getAllAgents, getAllProfiles, listAgentFeedback } from "@/lib/data";
import { AgentFeedbackTable } from "@/components/relevancy-audit/agent-feedback-table";
import { AutoRefresh } from "@/components/auto-refresh";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentFeedbackPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  // Agents see only their own feedback rows. Admins see all.
  const scopeAgentId = isAdmin ? null : (session?.user?.agentId ?? null);

  const [agents, profiles, agentFeedback] = await Promise.all([
    getAllAgents(),
    getAllProfiles(),
    listAgentFeedback({ scopeAgentId, limit: 100 }),
  ]);

  return (
    <>
      {/* Auto-refresh every 15s so newly flagged classifications appear without a
          manual reload. Pauses when the tab is hidden (default). */}
      <AutoRefresh interval={15000} />
      <Header
        title="Agent Feedback"
        agents={agents}
        profiles={profiles}
        hideFilters
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              Agent Feedback on AI Classifications
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {isAdmin
                ? "Agents flagging specific reasons as wrong, with their comments. Use this signal to recalibrate the classifier prompt."
                : "Your previously flagged classifications. The criteria team reviews these to recalibrate the AI."}
            </p>
          </div>

          <Separator />

          {agentFeedback.length === 0 ? (
            <div className="rounded-md border border-border p-6 text-center text-[13px] text-muted-foreground">
              {isAdmin
                ? "No agent feedback recorded yet."
                : "You haven't flagged any classifications yet. Open a task card and click 'Mark wrong' in the AI Relevancy panel."}
            </div>
          ) : (
            <AgentFeedbackTable rows={agentFeedback} showAgent={isAdmin} />
          )}
        </div>
      </main>
    </>
  );
}
