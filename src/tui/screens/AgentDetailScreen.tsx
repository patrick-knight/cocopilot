// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Agent Detail Screen - View agent output and status
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { Header, StatusIndicator, LogPane } from "../components/index.js";
import { useRouter } from "../router.js";
import { symbols } from "../utils/colors.js";
import { getClient } from "../api/client.js";

interface AgentDetailScreenProps {
  repoName: string;
  agentName: string;
}

export function AgentDetailScreen({ repoName, agentName }: AgentDetailScreenProps): React.ReactElement {
  const [agent, setAgent] = useState<{ name: string; type: string; status: string } | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch agent data
  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const repo = await getClient().getRepository(repoName);
        const agentData = repo?.agents?.[agentName];
        if (agentData) {
          setAgent(agentData);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    };

    fetchAgent();
    const interval = setInterval(fetchAgent, 5000);
    return () => clearInterval(interval);
  }, [repoName, agentName]);

  // Subscribe to agent output
  useEffect(() => {
    const client = getClient();
    const handler = ({ agent: outputAgent, output: line }: { agent: string; output: string }) => {
      if (outputAgent === agentName) {
        setOutput((prev) => [...prev.slice(-500), line]);
      }
    };

    const unsubscribe = client.onAgentOutput?.(handler) ?? (() => {});
    return unsubscribe;
  }, [agentName]);

  useInput((input) => {
    if (input === "c") {
      setOutput([]);
    }
  });

  if (loading && !agent) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading agent...
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

  if (!agent) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text color="yellow">{symbols.warning} Agent not found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header />

      {/* Agent header */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold>{agent.name}</Text>
          <Text> </Text>
          <StatusIndicator status={agent.status} />
        </Box>
        <Text dimColor>Type: {agent.type}</Text>
      </Box>

      {/* Live output */}
      <Box flexGrow={1} flexDirection="column">
        <LogPane
          lines={output.length > 0 ? output : ["Waiting for output from agent..."]}
          title="Agent Output"
          height={18}
        />
      </Box>

      {/* Help - pinned to bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0}>
        <Text dimColor>
          c: clear output | r: refresh | Esc: back
        </Text>
      </Box>
    </Box>
  );
}
