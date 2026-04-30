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
  syncJobStatusFromTask,
  syncAllJobsInColumn,
  createProject,
  updateProject,
  deleteProject,
  addProjectMembers,
  updateMemberRole,
  removeProjectMember,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  createTag,
  findConflictingTag,
  getProjectTags,
  getCustomFieldDefinitions, createCustomFieldDefinition, updateCustomFieldDefinition,
  archiveCustomFieldDefinition, restoreCustomFieldDefinition, reorderCustomFieldDefinitions,
  getSavedViews, createSavedView, deleteSavedView,
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
  position?: number | null
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Get old column name before move (for reversal detection)
  const { sql } = await import("@/lib/db");
  const oldCol = await sql`
    SELECT c.name FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ${taskId}
  `;
  const oldColumnName = oldCol.rows[0]?.name as string | undefined;

  const task = await moveTask(taskId, columnId, position, session.user.agentId ?? null);

  // Sync linked job status when column changes
  if (task && oldColumnName) {
    const newCol = await sql`SELECT name FROM columns WHERE id = ${columnId}`;
    const newColumnName = newCol.rows[0]?.name as string;
    if (oldColumnName !== newColumnName) {
      await syncJobStatusFromTask(taskId, newColumnName, oldColumnName);
    }
  }

  revalidateBoard();
  return task;
}

export async function deleteTaskAction(taskId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const deleted = await deleteTask(taskId, session.user.agentId ?? null);
  if (!deleted) throw new Error("Task not found or already deleted");
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

// ============================================================
// BOARD (PROJECT) ACTIONS
// ============================================================

export async function createBoardAction(data: { name: string; description?: string | null }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  // Find a creator agent ID
  let creatorId = session.user.agentId;
  if (!creatorId) {
    const { sql } = await import("@/lib/db");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) throw new Error("No active agents");
    creatorId = agent.rows[0].id as string;
  }

  const project = await createProject({ ...data, creator_id: creatorId });
  revalidateBoard();
  return project;
}

export async function updateBoardAction(projectId: string, fields: { name?: string; description?: string | null }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const project = await updateProject(projectId, fields);
  revalidateBoard();
  return project;
}

export async function deleteBoardAction(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const deleted = await deleteProject(projectId);
  if (!deleted) throw new Error("Board not found or already deleted");
  revalidateBoard();
}

export async function addBoardMembersAction(projectId: string, agentIds: string[], role?: "admin" | "member") {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const added = await addProjectMembers(projectId, agentIds, role ?? "member");
  revalidateBoard();
  return added;
}

export async function updateMemberRoleAction(projectId: string, agentId: string, role: "admin" | "member") {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const result = await updateMemberRole(projectId, agentId, role);
  if (!result.success) throw new Error(result.error);
  revalidateBoard();
}

export async function removeBoardMemberAction(projectId: string, agentId: string, unassignTasks: boolean = false) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const result = await removeProjectMember(projectId, agentId, unassignTasks);
  if (!result.success) throw new Error(result.error);
  revalidateBoard();
}

// ============================================================
// COLUMN ACTIONS
// ============================================================

export async function createColumnAction(projectId: string, name: string, color?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const col = await createColumn(projectId, name, color);
  revalidateBoard();
  return col;
}

export async function updateColumnAction(
  columnId: string,
  fields: { name?: string; color?: string; is_done?: boolean; wip_limit?: number | null }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const col = await updateColumn(columnId, fields);

  // When column renamed, update all linked jobs to the new name
  if (fields.name && col) {
    await syncAllJobsInColumn(columnId, fields.name);
  }

  revalidateBoard();
  return col;
}

export async function deleteColumnAction(columnId: string, moveTasksTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  // If moveTasksTo is set, bulk-move tasks before deleting and sync linked jobs
  if (moveTasksTo) {
    const { sql } = await import("@/lib/db");
    // Get target column name for job sync
    const targetCol = await sql`SELECT name FROM columns WHERE id = ${moveTasksTo}`;
    const targetName = targetCol.rows[0]?.name as string;

    // Sync linked jobs to target column name before moving tasks
    await syncAllJobsInColumn(columnId, targetName);

    await sql`UPDATE tasks SET column_id = ${moveTasksTo} WHERE column_id = ${columnId}`;
  }

  const result = await deleteColumn(columnId);
  if (!result.deleted) throw new Error(result.error ?? `Column has ${result.taskCount} tasks`);
  revalidateBoard();
}

export async function reorderColumnsAction(projectId: string, orderedIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  await reorderColumns(projectId, orderedIds);
  revalidateBoard();
}

// ============================================================
// TAG ACTIONS
// ============================================================

export async function createTagAction(projectId: string, name: string, color?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const tag = await createTag(projectId, name, color);
  revalidateBoard();
  return tag;
}

export async function updateTagAction(tagId: string, fields: { name?: string; color?: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const { sql } = await import("@/lib/db");

  if (typeof fields.name === "string" && fields.name.trim()) {
    const existing = await sql`SELECT project_id FROM task_tags WHERE id = ${tagId}`;
    if (existing.rows.length === 0) throw new Error("Tag not found");
    const conflict = await findConflictingTag(
      existing.rows[0].project_id as string,
      fields.name.trim(),
      tagId
    );
    if (conflict) {
      throw new Error(
        `Tag "${conflict.name}" already exists with the same first name. ` +
          `Reuse the existing tag instead of creating a duplicate.`
      );
    }
  }

  const result = await sql`
    UPDATE task_tags SET
      name = COALESCE(${fields.name ?? null}, name),
      color = COALESCE(${fields.color ?? null}, color)
    WHERE id = ${tagId}
    RETURNING *
  `;
  if (result.rows.length === 0) throw new Error("Tag not found");
  revalidateBoard();
  return result.rows[0];
}

export async function deleteTagAction(tagId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const { sql } = await import("@/lib/db");
  // CASCADE on task_tag_map handles removing from tasks
  await sql`DELETE FROM task_tags WHERE id = ${tagId}`;
  revalidateBoard();
}

export async function getProjectTagsAction(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  return await getProjectTags(projectId);
}

// ============================================================
// CUSTOM FIELD ACTIONS
// ============================================================

export async function getCustomFieldDefinitionsAction(projectId: string, includeArchived = false) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return await getCustomFieldDefinitions(projectId, includeArchived);
}

export async function createCustomFieldAction(
  projectId: string,
  data: {
    name: string;
    field_type: "text" | "number" | "dropdown" | "multi_select" | "date" | "boolean";
    options?: string[] | null;
    required?: boolean;
    show_on_card?: boolean;
  }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  if (!data.name?.trim()) throw new Error("Name is required");
  const field = await createCustomFieldDefinition(projectId, { ...data, name: data.name.trim() });
  revalidateBoard();
  return field;
}

export async function updateCustomFieldAction(
  fieldId: string,
  fields: { name?: string; options?: string[] | null; required?: boolean; show_on_card?: boolean; }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  const field = await updateCustomFieldDefinition(fieldId, fields);
  if (!field) throw new Error("Field not found");
  revalidateBoard();
  return field;
}

export async function archiveCustomFieldAction(fieldId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  const archived = await archiveCustomFieldDefinition(fieldId);
  if (!archived) throw new Error("Field not found");
  revalidateBoard();
}

export async function restoreCustomFieldAction(fieldId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  const restored = await restoreCustomFieldDefinition(fieldId);
  if (!restored) throw new Error("Field not found");
  revalidateBoard();
}

export async function reorderCustomFieldsAction(projectId: string, orderedIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  await reorderCustomFieldDefinitions(projectId, orderedIds);
  revalidateBoard();
}

// ============================================================
// SAVED VIEW ACTIONS
// ============================================================

export async function getSavedViewsAction(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return await getSavedViews(projectId);
}

export async function createSavedViewAction(data: {
  project_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  if (!data.name?.trim()) throw new Error("Name is required");
  let ownerId = session.user.agentId;
  if (!ownerId) {
    const { sql } = await import("@/lib/db");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) throw new Error("No active agents");
    ownerId = agent.rows[0].id as string;
  }
  const view = await createSavedView({ ...data, name: data.name.trim(), owner_id: ownerId });
  revalidateBoard();
  return view;
}

export async function deleteSavedViewAction(viewId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");
  const deleted = await deleteSavedView(viewId);
  if (!deleted) throw new Error("View not found");
  revalidateBoard();
}
