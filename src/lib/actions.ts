"use server";

import { revalidatePath } from "next/cache";
import {
  toggleAgentActive,
  createAgent,
  getAgentByEmailExists,
  toggleProfileActive,
  updateProfileAgent,
  createProfile,
  dismissAlert,
  markJobAsSent,
  getAllProfiles,
} from "./data";
import { updateTaskStatus } from "./clickup";

// Generate a PBKDF2-SHA256 hash with 16-byte salt, 64-byte key (128 hex chars)
async function hashPassword(password: string): Promise<string> {
  const { randomBytes, pbkdf2Sync } = await import("crypto");
  const salt = randomBytes(16).toString("hex"); // 32 hex chars
  const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 64, "sha256").toString("hex"); // 128 hex chars
  return `${salt}:${hash}`;
}

// Generate a random 12-char password with mixed case, digits, and symbols
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

export async function toggleAgentActiveAction(id: string, active: boolean) {
  await toggleAgentActive(id, active);
  revalidatePath("/settings");
  revalidatePath("/agents");
}

export async function createAgentAction(data: {
  name: string;
  email: string;
}) {
  // Check if email already exists
  const exists = await getAgentByEmailExists(data.email);
  if (exists) {
    throw new Error("An agent with this email already exists");
  }

  // Generate password and hash it
  const plainPassword = generatePassword();
  const password_hash = await hashPassword(plainPassword);

  const agent = await createAgent({
    name: data.name,
    email: data.email,
    password_hash,
  });

  revalidatePath("/settings");
  revalidatePath("/agents");

  // Return credentials (shown once in UI, never stored as plain text)
  return { agent, credentials: { email: data.email, password: plainPassword } };
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
  // Enforce: one profile can only belong to one agent
  if (agentId) {
    const profiles = await getAllProfiles();
    const target = profiles.find((p) => p.id === id);
    if (target && target.agent_id && target.agent_id !== agentId) {
      // Profile is being reassigned — this is allowed, just remove from previous
    }
  }
  await updateProfileAgent(id, agentId);
  revalidatePath("/settings");
  revalidatePath("/profiles");
  revalidatePath("/agents");
}

export async function assignProfilesToAgentAction(
  agentId: string,
  profileIds: string[]
) {
  const profiles = await getAllProfiles();

  // Unassign all profiles currently assigned to this agent that aren't in the new list
  for (const p of profiles) {
    if (p.agent_id === agentId && !profileIds.includes(p.id)) {
      await updateProfileAgent(p.id, null);
    }
  }

  // Assign selected profiles to this agent (removing from previous agent if needed)
  for (const pid of profileIds) {
    await updateProfileAgent(pid, agentId);
  }

  revalidatePath("/settings");
  revalidatePath("/profiles");
  revalidatePath("/agents");
}

export async function createProfileAction(data: {
  profile_id: string;
  profile_name: string;
  platform?: string | null;
  stack?: string | null;
  vollna_filter_tag?: string | null;
  agent_id?: string | null;
  clickup_list_id?: string | null;
}) {
  const profile = await createProfile(data);
  revalidatePath("/settings");
  revalidatePath("/profiles");
  revalidatePath("/agents");
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

export async function triggerClickUpFullSync() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/sync/clickup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
    },
  });

  const result = await res.json();
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/pipeline");
  revalidatePath("/jobs");
  return result;
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
