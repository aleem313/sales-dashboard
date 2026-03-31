"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  createComment,
  toggleChecklistItem,
  createChecklistItem,
  deleteChecklistItem,
  setTaskAssignees,
  setTaskTags,
} from "@/lib/task-data";

function revalidateBoard() {
  revalidatePath("/tasks");
  revalidatePath("/my-tasks");
}

export async function createTaskAction(data: {
  project_id: string;
  column_id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  assignee_ids?: string[];
  tag_ids?: string[];
  custom_fields?: Record<string, unknown>;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const task = await createTask({
    ...data,
    creator_id: session.user.agentId ?? null,
  });

  revalidateBoard();
  return task;
}

export async function updateTaskAction(
  taskId: string,
  fields: {
    title?: string;
    description?: string | null;
    priority?: string | null;
    due_date?: string | null;
    start_date?: string | null;
    custom_fields?: Record<string, unknown>;
  }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const task = await updateTask(taskId, fields, session.user.agentId ?? null);
  revalidateBoard();
  return task;
}

export async function moveTaskAction(
  taskId: string,
  columnId: string,
  position?: number
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const task = await moveTask(taskId, columnId, position, session.user.agentId ?? null);
  revalidateBoard();
  return task;
}

export async function deleteTaskAction(taskId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  await deleteTask(taskId, session.user.agentId ?? null);
  revalidateBoard();
}

export async function createCommentAction(
  taskId: string,
  body: string,
  parentId?: string | null
) {
  const session = await auth();
  if (!session?.user?.agentId) throw new Error("Unauthorized");

  const comment = await createComment(taskId, session.user.agentId, body, parentId);
  revalidateBoard();
  return comment;
}

export async function toggleChecklistItemAction(itemId: string, isChecked: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const item = await toggleChecklistItem(itemId, isChecked);
  revalidateBoard();
  return item;
}

export async function addChecklistItemAction(taskId: string, title: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const item = await createChecklistItem(taskId, title);
  revalidateBoard();
  return item;
}

export async function deleteChecklistItemAction(itemId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await deleteChecklistItem(itemId);
  revalidateBoard();
}

export async function setTaskAssigneesAction(taskId: string, agentIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await setTaskAssignees(taskId, agentIds, session.user.agentId ?? null);
  revalidateBoard();
}

export async function setTaskTagsAction(taskId: string, tagIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await setTaskTags(taskId, tagIds);
  revalidateBoard();
}
