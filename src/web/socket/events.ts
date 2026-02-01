/**
 * Socket.IO event names used for real-time communication.
 * Centralizing these prevents typos and makes refactoring easier.
 */

export const SOCKET_EVENTS = {
  // Client -> Server events
  WORKER_JOIN: "worker:join",
  WORKER_LEAVE: "worker:leave",
  REPO_JOIN: "repo:join",
  REPO_LEAVE: "repo:leave",
  REPO_SUBSCRIBE: "repo:subscribe",
  
  // Server -> Client events
  WORKER_OUTPUT: "worker:output",
  WORKER_STATUS: "worker:status",
  WORKER_COMPLETED: "worker:completed",
  WORKER_FAILED: "worker:failed",
  
  // Batched events (Server -> Client)
  BATCH_WORKER_OUTPUT: "batch:worker:output",
  BATCH_WORKER_STATUS: "batch:worker:status",
  BATCH_WORKER_COMPLETED: "batch:worker:completed",
  BATCH_WORKER_FAILED: "batch:worker:failed",
} as const;

export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
