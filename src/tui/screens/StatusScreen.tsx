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

  const allHealthy =
    status.daemon.status === "healthy" &&
    status.redis.status === "healthy" &&
    status.github.status === "healthy";

  return (
    <Box flexDirection="column">
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
          status={status.daemon.status}
          details={status.daemon.uptime ? `uptime: ${Math.floor(status.daemon.uptime / 60)}m` : undefined}
        />
        <StatusCard
          title="Redis"
          status={status.redis.status}
          details={status.redis.connected ? "connected" : "disconnected"}
        />
        <StatusCard
          title="GitHub"
          status={status.github.status}
          details={status.github.authenticated ? "authenticated" : "not authenticated"}
        />
        <StatusCard
          title="Copilot CLI"
          status={status.copilotCli.status}
          details={status.copilotCli.installed ? "installed" : "not found"}
        />
      </Box>

      {/* Worker stats */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Workers</Text>
        <Text>Total: {status.workers.total}</Text>
        {Object.entries(status.workers.byStatus).map(([stat, count]) => (
          <Text key={stat}>
            {"  "}{stat}: <Text color={stat === "failed" || stat === "stuck" ? "red" : undefined}>{count}</Text>
          </Text>
        ))}
      </Box>

      {/* Repositories */}
      <Box>
        <Text bold>Repositories: </Text>
        <Text>{status.repositories}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Auto-refreshing every 5s</Text>
      </Box>
    </Box>
  );
}
