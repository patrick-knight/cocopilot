// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Repository Detail Screen
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { useRepository, useWorkers, usePRs } from "../hooks/index.js";
import { Header, StatusIndicator, PRPipeline } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols, getStatusColor } from "../utils/colors.js";

interface RepoDetailScreenProps {
  repoName: string;
}

type Mode = "view" | "spawn";
type Tab = "workers" | "agents" | "prs";

export function RepoDetailScreen({ repoName }: RepoDetailScreenProps): React.ReactElement {
  const { repository, loading: repoLoading, error: repoError } = useRepository(repoName);
  const { workers, spawnWorker, stopWorker, refresh } = useWorkers(repoName);
  const { prs } = usePRs(repoName);
  const { navigate } = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [tab, setTab] = useState<Tab>("workers");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [spawnTask, setSpawnTask] = useState("");
  const [spawnBranch, setSpawnBranch] = useState("");
  const [spawnStep, setSpawnStep] = useState<"task" | "branch">("task");
  const [actionError, setActionError] = useState<string | null>(null);

  const agents = Object.values(repository?.agents ?? {});
  const currentList = tab === "workers" ? workers : tab === "agents" ? agents : [];

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
    } else if (input === "l") {
      // Navigate to messages
      navigate({ type: "messages", repoName });
    } else if (input === "p") {
      // Switch to PRs tab
      setTab("prs");
    } else if (key.tab || input === "t") {
      // Cycle through tabs
      setTab((prev) => {
        if (prev === "workers") return "agents";
        if (prev === "agents") return "prs";
        return "workers";
      });
      setSelectedIndex(0);
    } else if (tab !== "prs") {
      // Navigation only for workers/agents tabs
      if (key.upArrow || input === "k") {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === "j") {
        setSelectedIndex((prev) => Math.min(currentList.length - 1, prev + 1));
      } else if (key.return && currentList[selectedIndex]) {
        if (tab === "workers") {
          navigate({
            type: "worker-detail",
            repoName,
            workerName: (currentList[selectedIndex] as typeof workers[0]).name,
          });
        } else {
          navigate({
            type: "agent-detail",
            repoName,
            agentName: (currentList[selectedIndex] as typeof agents[0]).name,
          });
        }
      } else if (input === "x" && tab === "workers" && workers[selectedIndex]) {
        handleStopWorker(workers[selectedIndex].name);
      }
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
  return (
    <Box flexDirection="column" height="100%">
      <Header />

      {/* Repo info */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold>{repository.name}</Text>
        <Text dimColor>{repository.url}</Text>
        <Text>Mode: <Text color="cyan">{repository.mode}</Text> | Branch: <Text color="cyan">{repository.defaultBranch}</Text></Text>
      </Box>

      {/* Tab selector */}
      <Box marginBottom={1}>
        <Text
          backgroundColor={tab === "workers" ? "blue" : undefined}
          color={tab === "workers" ? "white" : "gray"}
        >
          {" "}Workers ({workers.length}) {" "}
        </Text>
        <Text> | </Text>
        <Text
          backgroundColor={tab === "agents" ? "blue" : undefined}
          color={tab === "agents" ? "white" : "gray"}
        >
          {" "}Agents ({agents.length}) {" "}
        </Text>
        <Text> | </Text>
        <Text
          backgroundColor={tab === "prs" ? "blue" : undefined}
          color={tab === "prs" ? "white" : "gray"}
        >
          {" "}PR Pipeline ({prs.length}) {" "}
        </Text>
      </Box>

      {/* Content based on tab */}
      <Box flexDirection="column" flexGrow={1}>
        {tab === "workers" ? (
          <>
            <Text bold underline>Workers</Text>
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
          </>
        ) : tab === "agents" ? (
          <>
            <Text bold underline>Agents</Text>
            {agents.length === 0 ? (
              <Text dimColor>No agents running</Text>
            ) : (
              agents.map((agent, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <Box key={agent.name}>
                    <Text
                      backgroundColor={isSelected ? "blue" : undefined}
                      color={isSelected ? "white" : undefined}
                    >
                      {isSelected ? `${symbols.pointer} ` : "  "}
                      <StatusIndicator status={agent.status} />
                      <Text> {agent.name}</Text>
                      <Text dimColor> ({agent.type})</Text>
                    </Text>
                  </Box>
                );
              })
            )}
          </>
        ) : (
          <>
            <Text bold underline>PR Pipeline</Text>
            {prs.length === 0 ? (
              <Text dimColor>No PRs tracked. Workers will create PRs when they push changes.</Text>
            ) : (
              <PRPipeline
                prs={prs.map(pr => ({
                  number: pr.number,
                  title: pr.title,
                  branch: pr.branch,
                  stage: pr.stage,
                  workerName: pr.workerName,
                }))}
              />
            )}
          </>
        )}
      </Box>

      {actionError && (
        <Box marginTop={1}>
          <Text color="red">{symbols.error} {actionError}</Text>
        </Box>
      )}

      {/* Help - pinned to bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0}>
        <Text dimColor>
          Tab/t: cycle tabs | p: PRs | ↑/↓: navigate | Enter: inspect | l: messages | n: spawn | x: stop | r: refresh
        </Text>
      </Box>
    </Box>
  );
}
