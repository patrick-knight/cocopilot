/**
 * Custom React hooks for Socket.IO real-time communication.
 *
 * Provides hooks that manage Socket.IO connections and subscriptions
 * for the Tempering Station page components.
 *
 * Includes error state tracking, auto-reconnect with exponential backoff,
 * and an offline indicator for connection status awareness.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import type {
  AgentOutputLine,
  AgentState,
  ClientToServerEvents,
  MessageEntry,
  PRPipelineEntry,
  RepoState,
  ServerToClientEvents,
  WorkerState,
} from "../types.js";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------------------------------------------------------------------------
// Reconnect constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// useSocket – singleton connection with auto-reconnect
// ---------------------------------------------------------------------------

let sharedSocket: TypedSocket | null = null;
let refCount = 0;

export interface UseSocketResult {
  socket: TypedSocket | null;
  error: string | null;
  offline: boolean;
}

/**
 * Returns a shared Socket.IO client instance with connection error state
 * and an offline indicator. Automatically reconnects with exponential backoff
 * (1 s → 2 s → 4 s → … → 30 s cap) when the connection drops.
 */
export function useSocket(): UseSocketResult {
  const [socket, setSocket] = useState<TypedSocket | null>(sharedSocket);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refCount += 1;

    if (!sharedSocket) {
      sharedSocket = io(window.location.origin, {
        transports: ["websocket", "polling"],
        autoConnect: true,
        reconnection: false, // we handle reconnection ourselves
      }) as TypedSocket;
    }

    const s = sharedSocket;
    setSocket(s);

    const scheduleReconnect = () => {
      if (timerRef.current) return; // already scheduled
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (s.disconnected) {
          s.connect();
        }
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      }, backoffRef.current);
    };

    const onConnect = () => {
      setError(null);
      setOffline(false);
      backoffRef.current = INITIAL_BACKOFF_MS;
    };

    const onDisconnect = (reason: string) => {
      // "io server disconnect" means the server intentionally closed;
      // everything else warrants an auto-reconnect attempt.
      if (reason !== "io server disconnect") {
        setError("Connection lost. Reconnecting...");
        scheduleReconnect();
      }
    };

    const onConnectError = () => {
      setError("Unable to connect to server. Retrying...");
      scheduleReconnect();
    };

    // Track browser online/offline
    const onOnline = () => {
      setOffline(false);
      if (s.disconnected) {
        backoffRef.current = INITIAL_BACKOFF_MS;
        s.connect();
      }
    };
    const onOffline = () => setOffline(true);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      refCount -= 1;
      if (refCount === 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        setSocket(null);
      }
    };
  }, []);

  return { socket, error, offline };
}

// ---------------------------------------------------------------------------
// useRepoState – subscribe to repo-level state updates
// ---------------------------------------------------------------------------

export interface UseRepoStateResult {
  repo: RepoState | null;
  agents: AgentState[];
  workers: WorkerState[];
  loading: boolean;
  error: string | null;
}

/**
 * Subscribes to a repository's state and provides live agent/worker updates.
 */
export function useRepoState(repoName: string): UseRepoStateResult {
  const { socket, error: socketError } = useSocket();
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derive agents and workers from repo state
  const agents = repo ? Object.values(repo.agents) : [];
  const workers = repo ? Object.values(repo.workers) : [];

  useEffect(() => {
    if (!socket || !repoName) return;

    socket.emit("repo:subscribe", repoName);

    const handleRepoState = (state: RepoState) => {
      setRepo(state);
      setLoading(false);
      setError(null);
    };

    const handleAgentUpdate = (agent: AgentState) => {
      setRepo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          agents: { ...prev.agents, [agent.name]: agent },
          updatedAt: new Date().toISOString(),
        };
      });
    };

    const handleWorkerUpdate = (worker: WorkerState) => {
      setRepo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          workers: { ...prev.workers, [worker.name]: worker },
          updatedAt: new Date().toISOString(),
        };
      });
    };

    const handleWorkerRemoved = (workerName: string) => {
      setRepo((prev) => {
        if (!prev) return prev;
        const { [workerName]: _, ...remaining } = prev.workers;
        return { ...prev, workers: remaining, updatedAt: new Date().toISOString() };
      });
    };

    socket.on("repo:state", handleRepoState);
    socket.on("agent:update", handleAgentUpdate);
    socket.on("worker:update", handleWorkerUpdate);
    socket.on("worker:removed", handleWorkerRemoved);

    return () => {
      socket.emit("repo:unsubscribe", repoName);
      socket.off("repo:state", handleRepoState);
      socket.off("agent:update", handleAgentUpdate);
      socket.off("worker:update", handleWorkerUpdate);
      socket.off("worker:removed", handleWorkerRemoved);
    };
  }, [socket, repoName]);

  return { repo, agents, workers, loading, error: error ?? socketError };
}

// ---------------------------------------------------------------------------
// useAgentStream – subscribe to a single agent's output
// ---------------------------------------------------------------------------

export interface UseAgentStreamResult {
  lines: AgentOutputLine[];
  clear: () => void;
}

/**
 * Subscribes to live streaming output from a specific agent.
 * Maintains a buffer of recent lines (capped at `maxLines`).
 */
export function useAgentStream(agentName: string | null, maxLines = 500): UseAgentStreamResult {
  const { socket } = useSocket();
  const [lines, setLines] = useState<AgentOutputLine[]>([]);

  const clear = useCallback(() => setLines([]), []);

  useEffect(() => {
    if (!socket || !agentName) {
      setLines([]);
      return;
    }

    socket.emit("agent:stream:subscribe", agentName);

    const handleOutput = (line: AgentOutputLine) => {
      if (line.agent !== agentName) return;
      setLines((prev) => {
        const next = [...prev, line];
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    };

    socket.on("agent:output", handleOutput);

    return () => {
      socket.emit("agent:stream:unsubscribe", agentName);
      socket.off("agent:output", handleOutput);
    };
  }, [socket, agentName, maxLines]);

  return { lines, clear };
}

// ---------------------------------------------------------------------------
// usePRPipeline – subscribe to PR pipeline updates
// ---------------------------------------------------------------------------

export function usePRPipeline(): PRPipelineEntry[] {
  const { socket } = useSocket();
  const [prs, setPrs] = useState<PRPipelineEntry[]>([]);

  useEffect(() => {
    if (!socket) return;

    const handlePRUpdate = (pr: PRPipelineEntry) => {
      setPrs((prev) => {
        const idx = prev.findIndex((p) => p.number === pr.number);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = pr;
          return next;
        }
        return [...prev, pr];
      });
    };

    socket.on("pr:update", handlePRUpdate);
    return () => {
      socket.off("pr:update", handlePRUpdate);
    };
  }, [socket]);

  return prs;
}

// ---------------------------------------------------------------------------
// useMessageQueue – subscribe to message queue updates
// ---------------------------------------------------------------------------

export function useMessageQueue(): MessageEntry[] {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<MessageEntry[]>([]);

  useEffect(() => {
    if (!socket) return;

    const handleNew = (msg: MessageEntry) => {
      setMessages((prev) => [msg, ...prev].slice(0, 100));
    };

    const handleAck = (id: string) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, acked: true } : m)));
    };

    socket.on("message:new", handleNew);
    socket.on("message:ack", handleAck);

    return () => {
      socket.off("message:new", handleNew);
      socket.off("message:ack", handleAck);
    };
  }, [socket]);

  return messages;
}
