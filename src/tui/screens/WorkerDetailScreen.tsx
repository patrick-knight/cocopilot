/**
 * TUI Worker Detail Screen
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useWorker, useStreaming, useWorkerMessages } from "../hooks/index.js";
import { Header, StatusIndicator, LogPane } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols, getStatusColor } from "../utils/colors.js";
import { getClient } from "../api/client.js";

interface WorkerDetailScreenProps {
  repoName: string;
  workerName: string;
}

function formatMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb.toFixed(0)} MB`;
}

function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

function progressBar(percent: number, width: number = 20): string {
  const filled = Math.round((Math.min(percent, 100) / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function WorkerDetailScreen({ repoName, workerName }: WorkerDetailScreenProps): React.ReactElement {
  const { worker, loading, error, refresh } = useWorker(repoName, workerName);
  const { messages } = useWorkerMessages(repoName, workerName);
  const { output } = useStreaming(workerName);
  const { goBack } = useRouter();
  const [actionError, setActionError] = React.useState<string | null>(null);

  useInput((input, key) => {
    if (input === "r") {
      refresh();
    } else if (input === "x") {
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

  const colorFn = getStatusColor(worker.status);

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
        {(worker.startedAt || worker.createdAt) && (
          <Text dimColor>Started: {new Date(worker.startedAt ?? worker.createdAt!).toLocaleString()}</Text>
        )}
      </Box>

      {actionError && (
        <Box marginBottom={1}>
          <Text color="red">{symbols.error} {actionError}</Text>
        </Box>
      )}

      {/* Container Resources */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold underline>Container Resources</Text>
        <Text>
          Status: <StatusIndicator status={worker.containerStatus ?? "unknown"} />
        </Text>
        {worker.resources ? (
          <>
            <Box>
              <Text>Memory: </Text>
              <Text color="cyan">{progressBar((worker.resources.memoryUsageMb / worker.resources.memoryLimitMb) * 100, 15)}</Text>
              <Text> {formatMb(worker.resources.memoryUsageMb)} / {formatMb(worker.resources.memoryLimitMb)}</Text>
            </Box>
            <Box>
              <Text>CPU:    </Text>
              <Text color="green">{progressBar(worker.resources.cpuPercent, 15)}</Text>
              <Text> {formatPercent(worker.resources.cpuPercent)}</Text>
            </Box>
          </>
        ) : (
          <Text dimColor>Resource data unavailable (container may not be running)</Text>
        )}
      </Box>

      {/* Messages */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold underline>Messages ({messages.length})</Text>
        {messages.length === 0 ? (
          <Text dimColor>No messages</Text>
        ) : (
          messages.slice(-5).map((msg) => (
            <Box key={msg.id}>
              <Text dimColor>{new Date(msg.timestamp).toLocaleTimeString()} </Text>
              <Text color="cyan">{msg.type}</Text>
              <Text dimColor> {msg.from} → {msg.to}</Text>
              {msg.acknowledged && <Text color="green"> ✓</Text>}
            </Box>
          ))
        )}
        {messages.length > 5 && (
          <Text dimColor>... and {messages.length - 5} more</Text>
        )}
      </Box>

      {/* Live output */}
      <LogPane
        lines={output.length > 0 ? output : ["Waiting for output..."]}
        title="Live Output"
        height={10}
      />

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          x: stop worker | r: refresh | Esc: back
        </Text>
      </Box>
    </Box>
  );
}
