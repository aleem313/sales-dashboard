import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "sonner";

// Route group for pages accessible to BOTH admin and agent roles, e.g.
// /relevancy-audit and /relevancy-evaluator. Auth is required, but unlike
// (dashboard)/layout.tsx there's no role redirect — middleware and the page
// itself are responsible for any per-role behavior. See spec
// docs/superpowers/specs/2026-05-21-agent-relevancy-pages-design.md.
export default async function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}
