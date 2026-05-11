"use server";

import { revalidatePath, updateTag } from "next/cache";
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
  createConnectsPurchase,
  deleteConnectsPurchase,
  getProfileAgentId,
} from "./data";
import { auth } from "./auth";

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

// Sync a new profile to n8n by creating webhook + respond nodes
const N8N_WORKFLOW_ID = process.env.N8N_WORKFLOW_ID || "EWnZg3svZWwcIRs4";

async function syncProfileToN8n(profileName: string): Promise<{ success: boolean; webhookUrl: string; error: string; alreadyExists?: boolean }> {
  const n8nUrl = process.env.N8N_API_URL;
  const n8nKey = process.env.N8N_API_KEY;

  if (!n8nUrl || !n8nKey) {
    return { success: false, webhookUrl: "", error: "N8N_API_URL or N8N_API_KEY not configured" };
  }

  const webhookPath = profileName.toLowerCase().replace(/\s+/g, "-") + "-profile-webhook";
  const webhookNodeName = `Webhook - ${profileName}`;
  const respondNodeName = `Respond - ${profileName}`;
  const webhookUrl = `https://ikonicdev.app.n8n.cloud/webhook/${webhookPath}`;

  const headers = { "Content-Type": "application/json", "X-N8N-API-KEY": n8nKey };

  // 1. Get current workflow
  const wfRes = await fetch(`${n8nUrl}/api/v1/workflows/${N8N_WORKFLOW_ID}`, { headers });
  if (!wfRes.ok) throw new Error(`n8n GET failed: ${wfRes.status}`);
  const workflow = await wfRes.json();

  // 2. Check if nodes already exist
  if (workflow.nodes.some((n: { name: string }) => n.name === webhookNodeName)) {
    return { success: true, webhookUrl, error: "", alreadyExists: true };
  }

  // 3. Position below last webhook node
  const webhookNodes = workflow.nodes.filter((n: { type: string }) => n.type === "n8n-nodes-base.webhook");
  const maxY = webhookNodes.reduce((max: number, n: { position: number[] }) => Math.max(max, n.position[1]), 0);
  const newY = maxY + 224;

  // 4. Add nodes
  workflow.nodes.push(
    { name: webhookNodeName, type: "n8n-nodes-base.webhook", typeVersion: 2, position: [-1408, newY], parameters: { httpMethod: "POST", path: webhookPath, responseMode: "responseNode", options: {} }, onError: "continueRegularOutput" },
    { name: respondNodeName, type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [-1216, newY], parameters: { options: {} } }
  );

  // 5. Add connections
  workflow.connections[webhookNodeName] = { main: [[{ node: respondNodeName, type: "main", index: 0 }]] };

  // Find next Merge input index
  const mergeInputs = Object.values(workflow.connections)
    .flatMap((conn: any) => conn.main?.flat() || [])
    .filter((c: any) => c.node === "Merge All Webhooks")
    .map((c: any) => c.index);
  const nextIndex = mergeInputs.length > 0 ? Math.max(...mergeInputs as number[]) + 1 : 0;

  workflow.connections[respondNodeName] = { main: [[{ node: "Merge All Webhooks", type: "main", index: nextIndex }]] };

  // 6. Update Merge numberInputs
  const mergeNode = workflow.nodes.find((n: { name: string }) => n.name === "Merge All Webhooks");
  if (mergeNode) {
    mergeNode.parameters.numberInputs = Math.max(mergeNode.parameters.numberInputs || 0, nextIndex + 1);
  }

  // 7. Save workflow
  const putRes = await fetch(`${n8nUrl}/api/v1/workflows/${N8N_WORKFLOW_ID}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }),
  });
  if (!putRes.ok) throw new Error(`n8n PUT failed: ${putRes.status}`);

  // 8. Re-activate
  if (workflow.active) {
    await fetch(`${n8nUrl}/api/v1/workflows/${N8N_WORKFLOW_ID}/activate`, { method: "POST", headers });
  }

  return { success: true, webhookUrl, error: "", alreadyExists: false };
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
}) {
  const profile = await createProfile(data);

  // Auto-provision webhook nodes in n8n (best-effort, don't block profile creation)
  let n8nSync: { success: boolean; webhookUrl: string; error: string; alreadyExists?: boolean } = { success: false, webhookUrl: "", error: "" };
  try {
    n8nSync = await syncProfileToN8n(data.profile_name);
  } catch (err) {
    // n8n sync is best-effort — profile is already created in DB
    n8nSync.error = err instanceof Error ? err.message : "Unknown n8n sync error";
    console.error("n8n sync failed:", n8nSync.error);
  }

  revalidatePath("/settings");
  revalidatePath("/profiles");
  revalidatePath("/agents");
  return { profile, n8nSync };
}

export async function dismissAlertAction(id: string) {
  await dismissAlert(id);
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function markProposalSentAction(jobId: string) {
  await markJobAsSent(jobId);
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

function revalidateConnectsPaths() {
  revalidatePath("/connects");
  revalidatePath("/my-connects");
}

export async function addConnectsPurchaseAction(input: {
  profileId: string;
  purchasedOn: string; // YYYY-MM-DD
  connectsCount: number;
  amountSpent: number;
  notes?: string;
}): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (!input.profileId) throw new Error("profileId is required");
  if (!input.purchasedOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) {
    throw new Error("purchasedOn must be a YYYY-MM-DD date");
  }
  if (!Number.isFinite(input.connectsCount) || input.connectsCount <= 0) {
    throw new Error("connectsCount must be a positive number");
  }
  if (!Number.isFinite(input.amountSpent) || input.amountSpent < 0) {
    throw new Error("amountSpent must be a non-negative number");
  }

  if (session.user.role !== "admin") {
    const profileAgentId = await getProfileAgentId(input.profileId);
    if (!profileAgentId || profileAgentId !== session.user.agentId) {
      throw new Error("Not authorized for this profile");
    }
  }

  const created = await createConnectsPurchase({
    profileId: input.profileId,
    purchasedOn: input.purchasedOn,
    connectsCount: Math.floor(input.connectsCount),
    amountSpent: input.amountSpent,
    notes: input.notes?.trim() || null,
    createdBy: session.user.agentId ?? null,
  });

  // Bust stats cache so connects bars / tiles recompute on next read.
  const { sql } = await import("./db");
  await sql`DELETE FROM stats_cache`;

  revalidateConnectsPaths();
  return created;
}

export async function deleteConnectsPurchaseAction(purchaseId: string): Promise<{ ok: true } | { ok: false; reason: "forbidden" | "not_found" }> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "forbidden" };
  if (session.user.role !== "admin") return { ok: false, reason: "forbidden" };

  const deleted = await deleteConnectsPurchase(purchaseId);
  if (!deleted) return { ok: false, reason: "not_found" };

  const { sql } = await import("./db");
  await sql`DELETE FROM stats_cache`;

  revalidateConnectsPaths();
  return { ok: true };
}

// ============================================================
// UPWORK PROFILE SNAPSHOTS (migration 017)
// ============================================================

// Saves a new snapshot for the given profile. Auth-gated wrapper around
// saveUpworkProfileSnapshot in data.ts: admins can save any profile, agents can only save
// their own assigned profiles. The actual SQL atomicity (demote + insert in one CTE) lives
// in the data-layer function so the import script can reuse it without going through auth.
export async function saveUpworkProfileSnapshotAction(
  profileId: string,
  json: unknown
): Promise<{ id: string; replaced: boolean }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (!profileId || typeof profileId !== "string") {
    throw new Error("profileId is required");
  }

  if (session.user.role !== "admin") {
    const profileAgentId = await getProfileAgentId(profileId);
    if (!profileAgentId || profileAgentId !== session.user.agentId) {
      throw new Error("Not authorized for this profile");
    }
  }

  const { saveUpworkProfileSnapshot } = await import("./data");
  const result = await saveUpworkProfileSnapshot(profileId, json);

  const { sql } = await import("./db");
  await sql`DELETE FROM stats_cache`;
  revalidatePath("/settings");
  revalidatePath("/profiles");
  revalidatePath("/my-dashboard");

  // Phase 3 (plan v3.3 §5.4 + §11.4): bust the classifier's profile-context cache
  // so the next score reads the fresh snapshot. "Latest snapshot wins" semantics.
  // updateTag (vs revalidateTag) gives read-your-own-writes from within this Server Action.
  updateTag(`profile-context-${profileId}`);

  return result;
}
