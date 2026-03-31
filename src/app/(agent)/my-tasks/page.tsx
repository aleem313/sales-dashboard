import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { BoardView } from "@/components/tasks/board-view";
import { TaskCreateModal } from "@/components/tasks/task-create-modal";
import { getDefaultProject, getProjectColumns, getProjectTasks } from "@/lib/task-data";

async function AgentBoardContent() {
  const session = await auth();
  const agentId = session?.user?.agentId;

  const project = await getDefaultProject();
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold">No project found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The task board hasn&apos;t been set up yet.
          </p>
        </div>
      </div>
    );
  }

  const [columns, allTasks] = await Promise.all([
    getProjectColumns(project.id),
    getProjectTasks(project.id, agentId ? { assignee_id: agentId } : {}),
  ]);

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">My assigned tasks</h2>
        </div>
        <TaskCreateModal projectId={project.id} columns={columns} />
      </div>
      <BoardView columns={columns} tasks={allTasks} />
    </>
  );
}

export default function MyTasksPage() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <Suspense
          fallback={
            <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
              {[1, 2, 3].map((col) => (
                <div key={col} className="w-[280px] shrink-0">
                  <div className="mb-3 h-4 w-24 rounded bg-muted animate-pulse" />
                  <div className="space-y-2">
                    {[1, 2].map((card) => (
                      <div key={card} className="h-24 rounded-lg border bg-card animate-pulse" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          }
        >
          <AgentBoardContent />
        </Suspense>
    </div>
  );
}
