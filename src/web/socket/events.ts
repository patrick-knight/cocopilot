/**
 * Socket.IO event names used for real-time communication.
 * Centralizing these prevents typos and makes refactoring easier.
 */

// Client -> Server events
export const SOCKET_EVENTS = {
  // Worker events
  WORKER_JOIN: "worker:join",
  WORKER_LEAVE: "worker:leave",
  
  // Repository events  
  REPO_JOIN: "repo:join",
  REPO_LEAVE: "repo:leave",
  REPO_SUBSCRIBE: "repo:subscribe",
  
  // Worker output events (Server -> Client)
  WORKER_OUTPUT: "worker:output",
  WORKER_STATUS: "worker:status",
  WORKER_COMPLETED: "worker:completed",
  WORKER_FAILED: "worker:failed",
  
  // Batched events (Server -> Client)
  BATCH_WORKER_OUTPUT: "batch:worker:output",
  BATCH_WORKER_STATUS: "batch:worker:status",
  BATCH_WORKER_COMPLETED: "batch:worker:completed",
} as const;

export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
