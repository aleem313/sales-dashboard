"use server";

import { revalidatePath } from "next/cache";
import {
  toggleAgentActive,
  createAgent,
  toggleProfileActive,
  updateProfileAgent,
  createProfile,
  dismissAlert,
  markJobAsSent,
} from "./data";
import { updateTaskStatus } from "./clickup";

export async function toggleAgentActiveAction(id: string, active: boolean) {
  await toggleAgentActive(id, active);
  revalidatePath("/settings");
  revalidatePath("/agents");
}

export async function createAgentAction(data: {
  name: string;
  email?: string | null;
  clickup_user_id: string;
}) {
  const agent = await createAgent(data);
  revalidatePath("/settings");
  revalidatePath("/agents");
  return agent;
}

export async function toggleProfileActiveAction(id: string, active: boolean) {
  await toggleProfileActive(id, active);
  revalidatePath("/settings");
  revalidatePath("/profiles");
}

export async function updateProfileAgentAction(
  id: string,
  agentId: string | null
) {
  await updateProfileAgent(id, agentId);
  revalidatePath("/settings");
  revalidatePath("/profiles");
}

export async function createProfileAction(data: {
  profile_id: string;
  profile_name: string;
  stack?: string | null;
  vollna_filter_tag?: string | null;
  agent_id?: string | null;
  clickup_list_id?: string | null;
}) {
  const profile = await createProfile(data);
  revalidatePath("/settings");
  revalidatePath("/profiles");
  return profile;
}

export async function triggerClickUpSync() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/sync/clickup`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
    },
  });

  const result = await res.json();
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return result;
}

export async function dismissAlertAction(id: string) {
  await dismissAlert(id);
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function markProposalSentAction(jobId: string, clickupTaskId?: string | null) {
  await markJobAsSent(jobId);
  if (clickupTaskId) {
    try {
      await updateTaskStatus(clickupTaskId, "Sent");
    } catch (err) {
      console.error("Failed to update ClickUp status:", err);
    }
  }
  revalidatePath("/my-jobs");
  revalidatePath("/my-dashboard");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function triggerSheetsSync() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/sync/sheets`, {
    method: "POST",
  });

  const result = await res.json();
  revalidatePath("/settings");
  return result;
}
