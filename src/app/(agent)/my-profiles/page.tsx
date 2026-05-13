import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import {
  getProfilesByAgent,
  getUpworkProfileSnapshotSummaries,
} from "@/lib/data";
import { AgentProfileList } from "@/components/agent/agent-profile-list";

export const revalidate = 0;

export default async function MyProfilesPage() {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const agentId = session.user.agentId;

  const [profiles, snapshotSummaries] = await Promise.all([
    getProfilesByAgent(agentId),
    getUpworkProfileSnapshotSummaries(),
  ]);

  return (
    <>
      <Header title="My Profiles" profiles={profiles} hideAgentFilter />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6">
          <AgentProfileList
            profiles={profiles}
            snapshotSummaries={snapshotSummaries}
          />
        </div>
      </main>
    </>
  );
}
