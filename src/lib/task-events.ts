import { EventEmitter } from "events";

/**
 * In-process event bus for real-time task notifications (SSE).
 *
 * The dashboard runs as a SINGLE Next.js / Node process on Contabo, so the
 * webhook handler that creates a card and the SSE route that streams to agents
 * share one process — a plain EventEmitter is all we need (no Redis/broker).
 * If this is ever scaled to multiple instances, replace the emitter with a
 * Redis pub/sub fan-out so an event reaches whichever instance holds the
 * agent's connection.
 */

export type TaskCreatedEvent = {
  taskId: string;
  title: string;
  projectId: string;
  /** Agent ids the task is assigned to; empty when assignment is unknown. */
  assigneeIds: string[];
};

// Stash the emitter on globalThis so Next.js module re-evaluation (dev
// hot-reload, separate route bundles) reuses a single bus per process.
const globalForEvents = globalThis as unknown as { __taskEmitter?: EventEmitter };

function getEmitter(): EventEmitter {
  if (!globalForEvents.__taskEmitter) {
    const e = new EventEmitter();
    e.setMaxListeners(0); // one listener per connected SSE client — don't cap
    globalForEvents.__taskEmitter = e;
  }
  return globalForEvents.__taskEmitter;
}

export function emitTaskCreated(evt: TaskCreatedEvent): void {
  getEmitter().emit("task-created", evt);
}

/** Subscribe to task-created events. Returns an unsubscribe function. */
export function onTaskCreated(listener: (evt: TaskCreatedEvent) => void): () => void {
  const e = getEmitter();
  e.on("task-created", listener);
  return () => {
    e.off("task-created", listener);
  };
}
