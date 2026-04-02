import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Auto-provision webhook + respond nodes in n8n for a new profile.
// Requires N8N_API_URL and N8N_API_KEY env vars.
// Workflow ID is set via N8N_WORKFLOW_ID (defaults to "EWnZg3svZWwcIRs4").

const N8N_WORKFLOW_ID = process.env.N8N_WORKFLOW_ID || "EWnZg3svZWwcIRs4";

interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  webhookId?: string;
}

interface N8nWorkflow {
  id: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, Record<string, Array<Array<{ node: string; type: string; index: number }>>>>;
  settings?: Record<string, unknown>;
  active?: boolean;
}

async function n8nFetch(path: string, options: RequestInit = {}) {
  const baseUrl = process.env.N8N_API_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("N8N_API_URL and N8N_API_KEY environment variables are required");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n API error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileName } = (await request.json()) as { profileName: string };

  if (!profileName) {
    return NextResponse.json({ error: "profileName is required" }, { status: 400 });
  }

  const webhookPath = profileName.toLowerCase().replace(/\s+/g, "-") + "-profile-webhook";
  const webhookNodeName = `Webhook - ${profileName}`;
  const respondNodeName = `Respond - ${profileName}`;

  try {
    // 1. Get current workflow
    const workflow: N8nWorkflow = await n8nFetch(`/api/v1/workflows/${N8N_WORKFLOW_ID}`);

    // 2. Check if nodes already exist
    const existingWebhook = workflow.nodes.find((n) => n.name === webhookNodeName);
    if (existingWebhook) {
      return NextResponse.json({
        success: true,
        message: `Webhook node "${webhookNodeName}" already exists`,
        webhookUrl: `https://ikonicdev.app.n8n.cloud/webhook/${webhookPath}`,
        alreadyExists: true,
      });
    }

    // 3. Calculate position (below the last webhook node)
    const webhookNodes = workflow.nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
    const maxY = webhookNodes.reduce((max, n) => Math.max(max, n.position[1]), 0);
    const newY = maxY + 224;

    // 4. Add webhook node
    const newWebhookNode: N8nNode = {
      name: webhookNodeName,
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-1408, newY],
      parameters: {
        httpMethod: "POST",
        path: webhookPath,
        responseMode: "responseNode",
        options: {},
      },
    };

    // 5. Add respond node
    const newRespondNode: N8nNode = {
      name: respondNodeName,
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [-1216, newY],
      parameters: { options: {} },
    };

    workflow.nodes.push(newWebhookNode, newRespondNode);

    // 6. Add connections: Webhook → Respond → Merge All Webhooks
    if (!workflow.connections[webhookNodeName]) {
      workflow.connections[webhookNodeName] = { main: [] };
    }
    workflow.connections[webhookNodeName].main = [
      [{ node: respondNodeName, type: "main", index: 0 }],
    ];

    // Find the next available Merge input index
    const mergeInputs = Object.values(workflow.connections)
      .flatMap((conn) => conn.main?.flat() || [])
      .filter((c) => c.node === "Merge All Webhooks")
      .map((c) => c.index);
    const nextIndex = mergeInputs.length > 0 ? Math.max(...mergeInputs) + 1 : 0;

    if (!workflow.connections[respondNodeName]) {
      workflow.connections[respondNodeName] = { main: [] };
    }
    workflow.connections[respondNodeName].main = [
      [{ node: "Merge All Webhooks", type: "main", index: nextIndex }],
    ];

    // 7. Save workflow back to n8n
    await n8nFetch(`/api/v1/workflows/${N8N_WORKFLOW_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings,
      }),
    });

    // 8. Re-activate if it was active
    if (workflow.active) {
      await n8nFetch(`/api/v1/workflows/${N8N_WORKFLOW_ID}/activate`, {
        method: "POST",
      });
    }

    return NextResponse.json({
      success: true,
      message: `Created webhook nodes for "${profileName}"`,
      webhookUrl: `https://ikonicdev.app.n8n.cloud/webhook/${webhookPath}`,
      alreadyExists: false,
    });
  } catch (error) {
    console.error("n8n sync error:", error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
