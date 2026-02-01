// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Repositories Screen - Main dashboard
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { useRepositories } from "../hooks/index.js";
import { Header, ConfirmDialog } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols } from "../utils/colors.js";
import type { Repository } from "../api/client.js";

type Mode = "list" | "add" | "delete" | "repair";

export function RepositoriesScreen(): React.ReactElement {
  const { repositories, loading, error, addRepo, deleteRepo, repairRepo, refresh } = useRepositories();
  const { navigate } = useRouter();
  const [mode, setMode] = useState<Mode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [actionTarget, setActionTarget] = useState<Repository | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isFiltering, setIsFiltering] = useState(false);

  const filteredRepos = filter
    ? repositories.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
    : repositories;

  useInput((input, key) => {
    if (mode !== "list") return;

    if (isFiltering) {
      if (key.escape) {
        setIsFiltering(false);
        setFilter("");
      }
      return;
    }

    if (input === "/" || input === "f") {
      setIsFiltering(true);
    } else if (input === "n" || input === "a") {
      setMode("add");
    } else if (input === "d" && filteredRepos[selectedIndex]) {
      setActionTarget(filteredRepos[selectedIndex]);
      setMode("delete");
    } else if (input === "x" && filteredRepos[selectedIndex]) {
      setActionTarget(filteredRepos[selectedIndex]);
      setMode("repair");
    } else if (input === "r") {
      refresh();
    } else if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(filteredRepos.length - 1, prev + 1));
    } else if (key.return && filteredRepos[selectedIndex]) {
      navigate({ type: "repo-detail", repoName: filteredRepos[selectedIndex].name });
    }
  });

  const handleAddRepo = async () => {
    if (!newRepoUrl.trim()) {
      setMode("list");
      return;
    }
    try {
      setActionError(null);
      await addRepo(newRepoUrl.trim());
      setNewRepoUrl("");
      setMode("list");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!actionTarget) return;
    try {
      setActionError(null);
      await deleteRepo(actionTarget.name);
      setActionTarget(null);
      setMode("list");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRepair = async () => {
    if (!actionTarget) return;
    try {
      setActionError(null);
      await repairRepo(actionTarget.name);
      setActionTarget(null);
      setMode("list");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && repositories.length === 0) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading repositories...
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

  // Add repo mode
  if (mode === "add") {
    return (
      <Box flexDirection="column">
        <Header />
        <Text bold>Add Repository</Text>
        <Box marginTop={1}>
          <Text>URL: </Text>
          <TextInput
            value={newRepoUrl}
            onChange={setNewRepoUrl}
            onSubmit={handleAddRepo}
            placeholder="https://github.com/owner/repo"
          />
        </Box>
        {actionError && <Text color="red">{symbols.error} {actionError}</Text>}
        <Box marginTop={1}>
          <Text dimColor>Enter to submit, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === "delete" && actionTarget) {
    return (
      <Box flexDirection="column">
        <Header />
        {actionError && <Text color="red">{symbols.error} {actionError}</Text>}
        <ConfirmDialog
          message={`Delete repository "${actionTarget.name}"? This will remove all workers.`}
          onConfirm={handleDelete}
          onCancel={() => { setMode("list"); setActionTarget(null); }}
          confirmLabel="Delete"
        />
      </Box>
    );
  }

  // Repair confirmation
  if (mode === "repair" && actionTarget) {
    return (
      <Box flexDirection="column">
        <Header />
        {actionError && <Text color="red">{symbols.error} {actionError}</Text>}
        <ConfirmDialog
          message={`Repair repository "${actionTarget.name}"? This will clean up orphaned workers.`}
          onConfirm={handleRepair}
          onCancel={() => { setMode("list"); setActionTarget(null); }}
          confirmLabel="Repair"
        />
      </Box>
    );
  }

  // List mode
  const workerCount = (repo: Repository) => Object.keys(repo.workers ?? {}).length;

  return (
    <Box flexDirection="column">
      <Header />

      {/* Filter input */}
      {isFiltering && (
        <Box marginBottom={1}>
          <Text>Filter: </Text>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder="type to filter..."
          />
        </Box>
      )}

      {/* Repository list */}
      {filteredRepos.length === 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">{symbols.warning} No repositories found</Text>
          <Text dimColor>Press 'n' to add a repository</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>
              {filteredRepos.length} {filteredRepos.length === 1 ? "repository" : "repositories"}
              {filter && ` (filtered)`}
            </Text>
          </Box>

          {filteredRepos.map((repo, index) => {
            const isSelected = index === selectedIndex;
            const workers = workerCount(repo);

            return (
              <Box key={repo.name}>
                <Text
                  backgroundColor={isSelected ? "blue" : undefined}
                  color={isSelected ? "white" : undefined}
                >
                  {isSelected ? `${symbols.arrow} ` : "  "}
                  <Text bold>{repo.name}</Text>
                  <Text dimColor> ({repo.mode})</Text>
                  <Text> - {workers} worker{workers !== 1 ? "s" : ""}</Text>
                  <Text dimColor> [{repo.defaultBranch}]</Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Help */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑/↓ or j/k: navigate | Enter: open | n: add | d: delete | x: repair | /: filter | r: refresh
        </Text>
      </Box>
    </Box>
  );
}
