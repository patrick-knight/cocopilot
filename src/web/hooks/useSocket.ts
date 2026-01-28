/**
 * Custom React hooks for Socket.IO real-time communication.
 *
 * Provides hooks that manage Socket.IO connections and subscriptions
 * for the Tempering Station page components.
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
// useSocket – singleton connection
// ---------------------------------------------------------------------------

let sharedSocket: TypedSocket | null = null;

/**
 * Returns a shared Socket.IO client instance.
 * Lazily connects on first use and disconnects when all consumers unmount.
 */
export function useSocket(): TypedSocket | null {
  const [socket, setSocket] = useState<TypedSocket | null>(sharedSocket);
  const refCount = useRef(0);

  useEffect(() => {
    refCount.current += 1;

    if (!sharedSocket) {
      sharedSocket = io(window.location.origin, {
        transports: ["websocket", "polling"],
        autoConnect: true,
      }) as TypedSocket;
    }

    setSocket(sharedSocket);

    return () => {
      refCount.current -= 1;
      if (refCount.current === 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        setSocket(null);
      }
    };
  }, []);

  return socket;
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
  const socket = useSocket();
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

    socket.on("connect_error", () => {
      setError("Connection lost. Reconnecting...");
    });

    return () => {
      socket.emit("repo:unsubscribe", repoName);
      socket.off("repo:state", handleRepoState);
      socket.off("agent:update", handleAgentUpdate);
      socket.off("worker:update", handleWorkerUpdate);
      socket.off("worker:removed", handleWorkerRemoved);
    };
  }, [socket, repoName]);

  return { repo, agents, workers, loading, error };
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
  const socket = useSocket();
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
  const socket = useSocket();
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
  const socket = useSocket();
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
