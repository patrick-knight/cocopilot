// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Status Screen - System health overview
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useStatus } from "../hooks/index.js";
import { Header, StatusCard } from "../components/index.js";
import { symbols } from "../utils/colors.js";

// Default status for missing fields
const defaultComponentStatus = { status: "unknown" as const };

export function StatusScreen(): React.ReactElement {
  const { status, loading, error } = useStatus();

  if (loading && !status) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading status...
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="red">{symbols.error} Error: {error.message}</Text>
        <Text dimColor>Is the daemon running? Try: coco daemon start</Text>
      </Box>
    );
  }

  if (!status) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="yellow">{symbols.warning} No status data available</Text>
      </Box>
    );
  }

  // Safely access nested properties with defaults
  const daemon = status.daemon ?? defaultComponentStatus;
  const redis = status.redis ?? defaultComponentStatus;
  const github = status.github ?? defaultComponentStatus;
  const copilotCli = status.copilotCli ?? defaultComponentStatus;
  const workers = status.workers ?? { total: 0, byStatus: {} };

  // Daemon reports "running" instead of "healthy"
  const daemonHealthy = daemon.status === "healthy" || daemon.status === "running";
  const allHealthy =
    daemonHealthy &&
    redis.status === "healthy" &&
    github.status === "healthy";

  return (
    <Box flexDirection="column" height="100%">
      <Header />

      {/* Overall status */}
      <Box marginBottom={1}>
        {allHealthy ? (
          <Text color="green" bold>{symbols.success} All Systems Operational</Text>
        ) : (
          <Text color="yellow" bold>{symbols.warning} Some Issues Detected</Text>
        )}
      </Box>

      {/* Component status */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Components</Text>
        <StatusCard
          title="Daemon"
          status={daemon.status}
          details={daemon.uptime ? `uptime: ${Math.floor(daemon.uptime / 60)}m` : undefined}
        />
        <StatusCard
          title="Redis"
          status={redis.status}
          details={redis.connected ? "connected" : "disconnected"}
        />
        <StatusCard
          title="GitHub"
          status={github.status}
          details={github.authenticated ? "authenticated" : "not authenticated"}
        />
        <StatusCard
          title="Copilot CLI"
          status={copilotCli.status}
          details={copilotCli.installed ? "installed" : "not found"}
        />
      </Box>

      {/* Worker stats */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Workers</Text>
        <Text>Total: {workers.total}</Text>
        {Object.entries(workers.byStatus).map(([stat, count]) => (
          <Text key={stat}>
            {"  "}{stat}: <Text color={stat === "failed" || stat === "stuck" ? "red" : undefined}>{count}</Text>
          </Text>
        ))}
      </Box>

      {/* Repositories */}
      <Box flexGrow={1}>
        <Text bold>Repositories: </Text>
        <Text>{status.repositories ?? 0}</Text>
      </Box>

      {/* Help - pinned to bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0}>
        <Text dimColor>Auto-refreshing every 5s | r: refresh | Esc: back</Text>
      </Box>
    </Box>
  );
}
