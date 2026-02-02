// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Metrics Screen - ASCII charts
 */

import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useMetrics } from "../hooks/index.js";
import { Header } from "../components/index.js";
import { symbols, noColor } from "../utils/colors.js";

export function MetricsScreen(): React.ReactElement {
  const { metrics, loading, error, refresh } = useMetrics();

  // Handle manual refresh with 'r' key
  useInput(useCallback((input: string) => {
    if (input === "r") {
      refresh();
    }
  }, [refresh]));

  if (loading && !metrics) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading metrics...
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

  if (!metrics) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="yellow">{symbols.warning} No metrics available</Text>
      </Box>
    );
  }

  // Safely access nested properties with defaults
  const throughput = metrics.throughput ?? [];
  const ciSuccess = metrics.ciSuccess ?? { passed: 0, failed: 0 };
  const tokenUsage = metrics.tokenUsage ?? [];
  const cycleTime = metrics.cycleTime ?? [];

  // ASCII bar chart helper
  const barChart = (value: number, max: number, width: number = 20): string => {
    const filled = Math.round((value / max) * width);
    const filledChar = noColor ? "#" : "█";
    const emptyChar = noColor ? "-" : "░";
    return filledChar.repeat(filled) + emptyChar.repeat(width - filled);
  };

  // Find max for throughput
  const maxThroughput = Math.max(...throughput.map((t) => t.count), 1);

  // CI success rate
  const totalCI = ciSuccess.passed + ciSuccess.failed;
  const successRate = totalCI > 0 ? (ciSuccess.passed / totalCI) * 100 : null;

  // Max tokens
  const maxTokens = Math.max(...tokenUsage.map((t) => t.tokens), 1);

  return (
    <Box flexDirection="column" height="100%">
      <Header />

      {/* Throughput */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Worker Throughput (last 24h)</Text>
        {throughput.length === 0 ? (
          <Text dimColor>No throughput data available</Text>
        ) : (
          throughput.slice(-8).map((item) => (
            <Box key={item.hour}>
              <Text>{item.hour.padEnd(6)} </Text>
              <Text color="cyan">{barChart(item.count, maxThroughput, 30)}</Text>
              <Text> {item.count}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Cycle Time */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>PR Cycle Time (avg hours)</Text>
        {cycleTime.length === 0 ? (
          <Text dimColor>No cycle time data available</Text>
        ) : (
          cycleTime.slice(-5).map((item) => (
            <Box key={item.date}>
              <Text>{item.date} </Text>
              <Text color="green">{item.avgHours.toFixed(1)}h</Text>
            </Box>
          ))
        )}
      </Box>

      {/* CI Success Rate */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>CI Success Rate</Text>
        {totalCI === 0 ? (
          <Text dimColor>No CI data available</Text>
        ) : (
          <>
            <Box>
              <Text color="green">{barChart(ciSuccess.passed, totalCI, 30)}</Text>
              <Text color="red">{barChart(ciSuccess.failed, totalCI, 10)}</Text>
            </Box>
            <Text>
              <Text color="green">{symbols.success} {ciSuccess.passed} passed</Text>
              <Text> | </Text>
              <Text color="red">{symbols.error} {ciSuccess.failed} failed</Text>
              <Text> ({successRate !== null ? `${successRate.toFixed(1)}%` : "N/A"})</Text>
            </Text>
          </>
        )}
      </Box>

      {/* Token Usage */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold underline>Token Usage by Model</Text>
        {tokenUsage.length === 0 ? (
          <Text dimColor>No token usage data available</Text>
        ) : (
          tokenUsage.map((item) => (
            <Box key={item.model}>
              <Text>{item.model.padEnd(20)} </Text>
              <Text color="magenta">{barChart(item.tokens, maxTokens, 25)}</Text>
              <Text> {item.tokens.toLocaleString()}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Help - pinned to bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0}>
        <Text dimColor>Auto-refreshing every 30s | r: refresh now | Esc: back</Text>
      </Box>
    </Box>
  );
}
