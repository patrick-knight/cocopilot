// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Worker Detail Screen
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useWorker, useStreaming } from "../hooks/index.js";
import { Header, StatusIndicator, LogPane } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols, getStatusColor } from "../utils/colors.js";
import { getClient } from "../api/client.js";

interface WorkerDetailScreenProps {
  repoName: string;
  workerName: string;
}

export function WorkerDetailScreen({ repoName, workerName }: WorkerDetailScreenProps): React.ReactElement {
  const { worker, loading, error, refresh } = useWorker(repoName, workerName);
  const { output } = useStreaming(workerName);
  const [actionError, setActionError] = React.useState<string | null>(null);

  useInput((input, key) => {
    if (input === "r") {
      refresh();
    } else if (input === "p") {
      handlePauseResume();
    } else if (input === "x" || key.return) {
      handleStop();
    }
  });

  const handleStop = async () => {
    try {
      setActionError(null);
      await getClient().stopWorker(workerName);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePauseResume = async () => {
    if (!worker) return;
    try {
      setActionError(null);
      if (worker.status === "paused") {
        await getClient().resumeWorker(workerName);
      } else if (worker.status === "working") {
        await getClient().pauseWorker(workerName);
      }
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !worker) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading worker...
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="red">{symbols.error} Error: {error.message}</Text>
      </Box>
    );
  }

  if (!worker) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="yellow">{symbols.warning} Worker not found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header />

      {/* Worker header */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>{worker.name}</Text>
          <Text> </Text>
          <StatusIndicator status={worker.status} />
        </Box>
        <Text dimColor>Task: {worker.task}</Text>
        {worker.branch && <Text dimColor>Branch: {worker.branch}</Text>}
        {worker.prUrl && (
          <Text>
            PR: <Text color="blue" underline>{worker.prUrl}</Text>
          </Text>
        )}
        {worker.model && <Text dimColor>Model: {worker.model}</Text>}
        {worker.startedAt && (
          <Text dimColor>Started: {new Date(worker.startedAt).toLocaleString()}</Text>
        )}
      </Box>

      {actionError && (
        <Box marginBottom={1}>
          <Text color="red">{symbols.error} {actionError}</Text>
        </Box>
      )}

      {/* Live output */}
      <LogPane
        lines={output.length > 0 ? output : ["Waiting for output..."]}
        title="Live Output"
        height={15}
      />

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          p: {worker.status === "paused" ? "resume" : "pause"} | x: stop worker | r: refresh | Esc: back
        </Text>
      </Box>
    </Box>
  );
}
