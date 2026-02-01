/**
 * Shared TUI hooks for data fetching
 */

import { useState, useEffect, useCallback } from "react";
import { getClient, StatusResponse, Repository, Worker, MetricsResponse, Message } from "../api/client.js";

export function useStatus(refreshInterval = 5000) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { status, loading, error, refresh };
}

export function useRepositories(refreshInterval = 10000) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getRepositories();
      setRepositories(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  const addRepo = useCallback(async (url: string) => {
    await getClient().addRepository(url);
    await refresh();
  }, [refresh]);

  const deleteRepo = useCallback(async (name: string) => {
    await getClient().deleteRepository(name);
    await refresh();
  }, [refresh]);

  const repairRepo = useCallback(async (name: string) => {
    await getClient().repairRepository(name);
    await refresh();
  }, [refresh]);

  return { repositories, loading, error, refresh, addRepo, deleteRepo, repairRepo };
}

export function useRepository(name: string) {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getRepository(name);
      setRepository(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { repository, loading, error, refresh };
}

export function useWorkers(repoName?: string) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getWorkers(repoName);
      setWorkers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repoName]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const spawnWorker = useCallback(async (task: string, options?: { branch?: string; model?: string }) => {
    if (!repoName) throw new Error("repoName required to spawn worker");
    await getClient().spawnWorker(repoName, task, options);
    await refresh();
  }, [repoName, refresh]);

  const stopWorker = useCallback(async (workerName: string) => {
    await getClient().stopWorker(workerName);
    await refresh();
  }, [refresh]);

  return { workers, loading, error, refresh, spawnWorker, stopWorker };
}

export function useWorker(repoName: string, workerName: string) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getWorker(repoName, workerName);
      setWorker(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repoName, workerName]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { worker, loading, error, refresh };
}

export function useWorkerMessages(repoName: string, workerName: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getWorkerMessages(repoName, workerName);
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repoName, workerName]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { messages, loading, error, refresh };
}

export function useMetrics() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getMetrics();
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { metrics, loading, error, refresh };
}

export function useStreaming(workerName?: string) {
  const [output, setOutput] = useState<string[]>([]);

  useEffect(() => {
    if (!workerName) return;

    const client = getClient();
    client.onWorkerOutput(({ worker, output: line }) => {
      if (worker === workerName) {
        setOutput((prev) => [...prev.slice(-500), line]); // Keep last 500 lines
      }
    });

    return () => {
      client.disconnect();
    };
  }, [workerName]);

  const clear = useCallback(() => setOutput([]), []);

  return { output, clear };
}
