import { redirect } from "next/navigation";
import { getTaskProjectId } from "@/lib/task-data";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: Props) {
  const { id: taskId } = await params;
  const projectId = await getTaskProjectId(taskId);
  const boardParam = projectId ? `board=${projectId}&` : "";
  redirect(`/tasks?${boardParam}task=${taskId}`);
}
