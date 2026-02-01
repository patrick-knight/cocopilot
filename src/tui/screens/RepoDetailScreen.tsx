// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Repository Detail Screen
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { useRepository, useWorkers } from "../hooks/index.js";
import { Header, StatusIndicator } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols, getStatusColor } from "../utils/colors.js";

interface RepoDetailScreenProps {
  repoName: string;
}

type Mode = "view" | "spawn";

export function RepoDetailScreen({ repoName }: RepoDetailScreenProps): React.ReactElement {
  const { repository, loading: repoLoading, error: repoError } = useRepository(repoName);
  const { workers, spawnWorker, stopWorker, refresh } = useWorkers(repoName);
  const { navigate } = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [spawnTask, setSpawnTask] = useState("");
  const [spawnBranch, setSpawnBranch] = useState("");
  const [spawnStep, setSpawnStep] = useState<"task" | "branch">("task");
  const [actionError, setActionError] = useState<string | null>(null);

  useInput((input, key) => {
    if (mode !== "view") {
      if (key.escape) {
        setMode("view");
        setSpawnTask("");
        setSpawnBranch("");
        setSpawnStep("task");
      }
      return;
    }

    if (input === "n" || input === "s") {
      setMode("spawn");
      setSpawnStep("task");
    } else if (input === "r") {
      refresh();
    } else if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(workers.length - 1, prev + 1));
    } else if (key.return && workers[selectedIndex]) {
      navigate({
        type: "worker-detail",
        repoName,
        workerName: workers[selectedIndex].name,
      });
    } else if (input === "x" && workers[selectedIndex]) {
      handleStopWorker(workers[selectedIndex].name);
    }
  });

  const handleSpawnSubmit = async (value: string) => {
    if (spawnStep === "task") {
      if (!value.trim()) {
        setMode("view");
        return;
      }
      setSpawnTask(value);
      setSpawnStep("branch");
    } else {
      try {
        setActionError(null);
        await spawnWorker(spawnTask, { branch: value || undefined });
        setMode("view");
        setSpawnTask("");
        setSpawnBranch("");
        setSpawnStep("task");
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleStopWorker = async (name: string) => {
    try {
      setActionError(null);
      await stopWorker(name);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (repoLoading && !repository) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading repository...
        </Text>
      </Box>
    );
  }

  if (repoError) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="red">{symbols.error} Error: {repoError.message}</Text>
      </Box>
    );
  }

  if (!repository) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="yellow">{symbols.warning} Repository not found</Text>
      </Box>
    );
  }

  // Spawn worker mode
  if (mode === "spawn") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Spawn Worker</Text>
        {actionError && <Text color="red">{symbols.error} {actionError}</Text>}
        <Box marginTop={1}>
          {spawnStep === "task" ? (
            <>
              <Text>Task: </Text>
              <TextInput
                value={spawnTask}
                onChange={setSpawnTask}
                onSubmit={handleSpawnSubmit}
                placeholder="Describe the task..."
              />
            </>
          ) : (
            <>
              <Text>Branch (optional): </Text>
              <TextInput
                value={spawnBranch}
                onChange={setSpawnBranch}
                onSubmit={handleSpawnSubmit}
                placeholder={repository.defaultBranch}
              />
            </>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter to continue, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // View mode
  const agents = Object.values(repository.agents ?? {});

  return (
    <Box flexDirection="column">
      <Header />

      {/* Repo info */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold>{repository.name}</Text>
        <Text dimColor>{repository.url}</Text>
        <Text>Mode: <Text color="cyan">{repository.mode}</Text> | Branch: <Text color="cyan">{repository.defaultBranch}</Text></Text>
      </Box>

      {/* Agents */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold underline>Agents</Text>
        {agents.length === 0 ? (
          <Text dimColor>No agents running</Text>
        ) : (
          agents.map((agent) => (
            <Box key={agent.name}>
              <Text>
                <StatusIndicator status={agent.status} />
                <Text> {agent.name}</Text>
                <Text dimColor> ({agent.type})</Text>
              </Text>
            </Box>
          ))
        )}
      </Box>

      {/* Workers */}
      <Box flexDirection="column">
        <Text bold underline>Workers ({workers.length})</Text>
        {workers.length === 0 ? (
          <Text dimColor>No workers. Press 'n' to spawn one.</Text>
        ) : (
          workers.map((worker, index) => {
            const isSelected = index === selectedIndex;

            return (
              <Box key={worker.name}>
                <Text
                  backgroundColor={isSelected ? "blue" : undefined}
                  color={isSelected ? "white" : undefined}
                >
                  {isSelected ? `${symbols.pointer} ` : "  "}
                  <StatusIndicator status={worker.status} showSymbol={false} label={worker.status.padEnd(10)} />
                  <Text bold> {worker.name}</Text>
                  {worker.branch && <Text dimColor> [{worker.branch}]</Text>}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {actionError && (
        <Box marginTop={1}>
          <Text color="red">{symbols.error} {actionError}</Text>
        </Box>
      )}

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓: navigate | Enter: inspect | n: spawn | x: stop | r: refresh
        </Text>
      </Box>
    </Box>
  );
}
