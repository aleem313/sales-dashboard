import { auth } from "@/lib/auth";
import { onTaskCreated } from "@/lib/task-events";

// Long-lived SSE stream — never statically optimized, must run on the Node
// runtime (EventEmitter + streaming response).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/events/tasks — Server-Sent Events stream of new-task notifications
 * for the authenticated agent. The browser opens one EventSource and the server
 * pushes a `task-created` event the instant n8n creates a card, so the bell
 * fires immediately regardless of tab focus (no polling required).
 */
export async function GET(request: Request) {
  const session = await auth();
  const agentId = session?.user?.agentId;
  if (!agentId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Comment line opens the stream so proxies flush headers immediately.
      send(": connected\n\n");

      const unsubscribe = onTaskCreated((evt) => {
        // Forward only this agent's tasks; fail open when assignment is unknown
        // (the client's own board view + dedup decide whether to actually beep).
        if (evt.assigneeIds.length === 0 || evt.assigneeIds.includes(agentId)) {
          send(
            `event: task-created\ndata: ${JSON.stringify({ id: evt.taskId, title: evt.title })}\n\n`
          );
        }
      });

      // Heartbeat keeps the connection alive through idle-timeout proxies.
      const heartbeat = setInterval(() => send(": ping\n\n"), 25000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Fires when the client disconnects (tab closed / navigated away).
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy/nginx response buffering so events flush in real time.
      "X-Accel-Buffering": "no",
    },
  });
}
