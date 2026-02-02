/**
 * Shared TUI hooks for data fetching
 */

import { useState, useEffect, useCallback } from "react";
import { getClient, StatusResponse, Repository, Worker, MetricsResponse, PRPipelineEntry } from "../api/client.js";

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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getStatus();
        if (mounted) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, refreshInterval);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshInterval]);

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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getRepositories();
        if (mounted) {
          setRepositories(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, refreshInterval);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshInterval]);

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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getRepository(name);
        if (mounted) {
          setRepository(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, 5000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [name]);

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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getWorkers(repoName);
        if (mounted) {
          setWorkers(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, 5000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [repoName]);

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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getWorker(repoName, workerName);
        if (mounted) {
          setWorker(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, 3000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [repoName, workerName]);

  return { worker, loading, error, refresh };
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
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getMetrics();
        if (mounted) {
          setMetrics(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, 30000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return { metrics, loading, error, refresh };
}

export function useStreaming(workerName?: string) {
  const [output, setOutput] = useState<string[]>([]);

  useEffect(() => {
    if (!workerName) return;

    const client = getClient();
    client.joinWorker(workerName);
    const handler = ({ workerName: outputWorker, line }: { workerName: string; line: string }) => {
      if (outputWorker === workerName) {
        setOutput((prev) => [...prev.slice(-500), line]); // Keep last 500 lines
      }
    };

    const unsubscribe = client.onWorkerOutput(handler);
    const unsubscribeActivity = client.onWorkerActivity((event) => {
      if (event.workerName !== workerName) return;
      const label = event.eventType ? `activity:${event.eventType}` : "activity";
      setOutput((prev) => [
        ...prev.slice(-500),
        `[${new Date(event.timestamp).toLocaleTimeString()}] ${label}`,
      ]);
    });

    return () => {
      unsubscribe();
      unsubscribeActivity();
      client.leaveWorker(workerName);
    };
  }, [workerName]);

  const clear = useCallback(() => setOutput([]), []);

  return { output, clear };
}

export function usePRs(repoName: string) {
  const [prs, setPrs] = useState<PRPipelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getClient().getPRs(repoName);
      setPrs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repoName]);

  useEffect(() => {
    let mounted = true;
    
    const refreshIfMounted = async () => {
      if (!mounted) return;
      try {
        const data = await getClient().getPRs(repoName);
        if (mounted) {
          setPrs(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    refreshIfMounted();
    const interval = setInterval(refreshIfMounted, 10000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [repoName]);

  return { prs, loading, error, refresh };
}
