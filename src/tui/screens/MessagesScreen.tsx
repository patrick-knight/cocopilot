// @ts-nocheck - ink components have incompatible types with React 19
/**
 * TUI Messages Screen - View inter-agent messages
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { Header, LogPane } from "../components/index.js";
import { symbols } from "../utils/colors.js";
import { getClient } from "../api/client.js";

interface MessagesScreenProps {
  repoName: string;
}

interface Message {
  id: string;
  type: string;
  from: string;
  to: string;
  payload: unknown;
  timestamp: number;
}

const MESSAGE_TYPE_COLORS: Record<string, string> = {
  BROADCAST: "cyan",
  NUDGE: "yellow",
  TASK_ASSIGNED: "green",
  TASK_COMPLETE: "green",
  TASK_FAILED: "red",
  STATUS_REQUEST: "blue",
  STATUS_RESPONSE: "blue",
  PR_CREATED: "magenta",
  SECURITY_REVIEW_REQUEST: "yellow",
  SECURITY_REVIEW_PASSED: "green",
  SECURITY_REVIEW_FAILED: "red",
  CODE_REVIEW_REQUEST: "yellow",
  REVIEW_COMPLETE: "green",
  WORKER_ACTIVITY: "cyan",
};

const MESSAGE_TYPE_ICONS: Record<string, string> = {
  BROADCAST: "📢",
  NUDGE: "💡",
  TASK_ASSIGNED: "📋",
  TASK_COMPLETE: "✅",
  TASK_FAILED: "❌",
  STATUS_REQUEST: "❓",
  STATUS_RESPONSE: "📊",
  PR_CREATED: "🔀",
  SECURITY_REVIEW_REQUEST: "🔒",
  SECURITY_REVIEW_PASSED: "✅",
  SECURITY_REVIEW_FAILED: "🚫",
  CODE_REVIEW_REQUEST: "👀",
  REVIEW_COMPLETE: "✔️",
  WORKER_ACTIVITY: "⚙️",
};

function formatMessage(msg: Message): string {
  const icon = MESSAGE_TYPE_ICONS[msg.type] || "📨";
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const payload = msg.payload as Record<string, unknown>;
  
  let content = "";
  if (typeof payload === "string") {
    content = payload;
  } else if (payload?.message) {
    content = String(payload.message);
  } else if (payload?.task) {
    content = `Task: ${payload.task}`;
  } else if (payload?.summary) {
    content = String(payload.summary);
  } else if (payload?.prNumber) {
    content = `PR #${payload.prNumber}`;
  }
  
  return `${time} ${icon} [${msg.type}] ${msg.from} → ${msg.to}: ${content.slice(0, 60)}`;
}

export function MessagesScreen({ repoName }: MessagesScreenProps): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const data = await getClient().getMessages?.(repoName) ?? [];
        setMessages(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [repoName]);

  // Subscribe to new messages
  useEffect(() => {
    const client = getClient();
    const handler = (msg: Message) => {
      setMessages((prev) => [...prev.slice(-200), msg]);
    };

    const unsubscribe = client.onMessage?.(handler) ?? (() => {});
    return unsubscribe;
  }, []);

  useInput((input) => {
    if (input === "c") {
      setMessages([]);
    } else if (input === "f") {
      // Cycle through filters: all -> BROADCAST -> TASK_* -> REVIEW -> all
      if (!filter) {
        setFilter("BROADCAST");
      } else if (filter === "BROADCAST") {
        setFilter("TASK");
      } else if (filter === "TASK") {
        setFilter("REVIEW");
      } else {
        setFilter(null);
      }
    }
  });

  if (loading && messages.length === 0) {
    return (
      <Box flexDirection="column">
        <Header />
        <Text>
          <Spinner type="dots" /> Loading messages...
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

  // Apply filter
  const filteredMessages = filter
    ? messages.filter((m) => m.type.includes(filter))
    : messages;

  const lines = filteredMessages.length > 0
    ? filteredMessages.map(formatMessage)
    : ["No messages yet. Messages appear when agents communicate."];

  return (
    <Box flexDirection="column">
      <Header />

      {/* Filter indicator */}
      <Box marginBottom={1}>
        <Text bold>Messages</Text>
        <Text dimColor> ({filteredMessages.length} shown)</Text>
        {filter && (
          <Text color="yellow"> [Filter: {filter}]</Text>
        )}
      </Box>

      {/* Message list */}
      <LogPane
        lines={lines}
        title="Message Queue"
        height={18}
      />

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          f: toggle filter | c: clear | r: refresh | Esc: back
        </Text>
      </Box>
    </Box>
  );
}
