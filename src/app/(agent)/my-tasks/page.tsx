import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { BoardView } from "@/components/tasks/board-view";
import { TaskCreateModal } from "@/components/tasks/task-create-modal";
import {
  getDefaultProject,
  getProjectColumns,
  getAgentTasksAcrossBoards,
  getUserProjectsWithMeta,
} from "@/lib/task-data";

async function AgentBoardContent() {
  const session = await auth();
  const agentId = session?.user?.agentId;
  if (!agentId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Not logged in as an agent.</p>
      </div>
    );
  }

  // Get all boards agent is a member of
  const projects = await getUserProjectsWithMeta(agentId);
  const project = projects.length > 0 ? projects[0] : await getDefaultProject();

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold">No boards assigned</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact your admin to be added to a board.
          </p>
        </div>
      </div>
    );
  }

  // Get tasks assigned to this agent across all their boards
  const allTasks = await getAgentTasksAcrossBoards(agentId);
  const columns = await getProjectColumns(project.id);

  // For the board view, filter to current board's tasks
  const boardTasks = allTasks.filter((t) => t.project_id === project.id);

  const totalAcrossBoards = allTasks.length;
  const boardCount = projects.length;

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">My Tasks</h2>
          <span className="text-xs text-muted-foreground">
            {totalAcrossBoards} task{totalAcrossBoards !== 1 ? "s" : ""} across {boardCount} board{boardCount !== 1 ? "s" : ""}
          </span>
        </div>
        <TaskCreateModal projectId={project.id} columns={columns} />
      </div>
      <BoardView columns={columns} tasks={boardTasks} />
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
