import { auth } from "@/lib/auth";
import { TaskFullView } from "@/components/tasks/task-full-view";
import { getDefaultProject, getProjectColumns, getTaskProjectId } from "@/lib/task-data";
import type { BoardColumn } from "@/lib/task-data";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AgentTaskDetailPage({ params }: Props) {
  const session = await auth();
  const agentId = session?.user?.agentId;
  const { id: taskId } = await params;

  const projectId = await getTaskProjectId(taskId);
  let columns: BoardColumn[] = [];
  if (projectId) {
    columns = await getProjectColumns(projectId);
  } else {
    const project = await getDefaultProject();
    if (project) columns = await getProjectColumns(project.id);
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center border-b px-6 py-3 bg-card/50">
        <h1 className="text-lg font-semibold">Task Detail</h1>
      </div>
      <TaskFullView
        taskId={taskId}
        columns={columns}
        isAdmin={false}
        agentId={agentId}
        backUrl={projectId ? `/my-tasks?board=${projectId}` : "/my-tasks"}
      />
    </div>
  );
}
