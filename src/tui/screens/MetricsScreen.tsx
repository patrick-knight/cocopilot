// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Metrics Screen - ASCII charts
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useMetrics } from "../hooks/index.js";
import { Header } from "../components/index.js";
import { symbols, noColor } from "../utils/colors.js";

export function MetricsScreen(): React.ReactElement {
  const { metrics, loading, error } = useMetrics();

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

  // ASCII bar chart helper
  const barChart = (value: number, max: number, width: number = 20): string => {
    const filled = Math.round((value / max) * width);
    const filledChar = noColor ? "#" : "█";
    const emptyChar = noColor ? "-" : "░";
    return filledChar.repeat(filled) + emptyChar.repeat(width - filled);
  };

  // Find max for throughput
  const maxThroughput = Math.max(...metrics.throughput.map((t) => t.count), 1);

  // CI success rate
  const totalCI = metrics.ciSuccess.passed + metrics.ciSuccess.failed;
  const successRate = totalCI > 0 ? (metrics.ciSuccess.passed / totalCI) * 100 : null;

  // Max tokens
  const maxTokens = Math.max(...metrics.tokenUsage.map((t) => t.tokens), 1);

  return (
    <Box flexDirection="column">
      <Header />

      {/* Throughput */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Worker Throughput (last 24h)</Text>
        {metrics.throughput.slice(-8).map((item) => (
          <Box key={item.hour}>
            <Text>{item.hour.padEnd(6)} </Text>
            <Text color="cyan">{barChart(item.count, maxThroughput, 30)}</Text>
            <Text> {item.count}</Text>
          </Box>
        ))}
      </Box>

      {/* Cycle Time */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>PR Cycle Time (avg hours)</Text>
        {metrics.cycleTime.slice(-5).map((item) => (
          <Box key={item.date}>
            <Text>{item.date} </Text>
            <Text color="green">{item.avgHours.toFixed(1)}h</Text>
          </Box>
        ))}
      </Box>

      {/* CI Success Rate */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>CI Success Rate</Text>
        <Box>
          <Text color="green">{barChart(metrics.ciSuccess.passed, totalCI, 30)}</Text>
          <Text color="red">{barChart(metrics.ciSuccess.failed, totalCI, 10)}</Text>
        </Box>
        <Text>
          <Text color="green">{symbols.success} {metrics.ciSuccess.passed} passed</Text>
          <Text> | </Text>
          <Text color="red">{symbols.error} {metrics.ciSuccess.failed} failed</Text>
          <Text> ({successRate !== null ? `${successRate.toFixed(1)}%` : "N/A"})</Text>
        </Text>
      </Box>

      {/* Token Usage */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Token Usage by Model</Text>
        {metrics.tokenUsage.map((item) => (
          <Box key={item.model}>
            <Text>{item.model.padEnd(20)} </Text>
            <Text color="magenta">{barChart(item.tokens, maxTokens, 25)}</Text>
            <Text> {item.tokens.toLocaleString()}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Auto-refreshing every 30s | r: refresh now</Text>
      </Box>
    </Box>
  );
}
