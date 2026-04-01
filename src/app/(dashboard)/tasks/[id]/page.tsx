import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { TaskFullView } from "@/components/tasks/task-full-view";
import { getDefaultProject, getProjectColumns, getTaskProjectId } from "@/lib/task-data";
import type { BoardColumn } from "@/lib/task-data";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: Props) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
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
    <>
      <Header title="Task Detail" />
      <main className="flex-1 overflow-hidden flex flex-col">
        <TaskFullView
          taskId={taskId}
          columns={columns}
          isAdmin={isAdmin}
          agentId={agentId}
          backUrl="/tasks"
        />
      </main>
    </>
  );
}
