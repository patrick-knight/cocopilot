/**
 * TUI Log Pane - scrollable output viewer
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

interface LogPaneProps {
  lines: string[];
  height?: number;
  title?: string;
  autoScroll?: boolean;
  focused?: boolean;
}

export function LogPane({ lines, height = 15, title, autoScroll = true, focused = true }: LogPaneProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isAutoScroll, setIsAutoScroll] = useState(autoScroll);

  const maxOffset = Math.max(0, lines.length - height);
  const visibleLines = lines.slice(scrollOffset, scrollOffset + height);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (isAutoScroll) {
      setScrollOffset(maxOffset);
    }
  }, [lines.length, maxOffset, isAutoScroll]);

  useInput((input, key) => {
    if (!focused) return;
    
    if (key.upArrow || input === "k") {
      setIsAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setScrollOffset((prev) => {
        const newOffset = Math.min(maxOffset, prev + 1);
        if (newOffset === maxOffset) setIsAutoScroll(true);
        return newOffset;
      });
    } else if (input === "g") {
      setIsAutoScroll(false);
      setScrollOffset(0);
    } else if (input === "G") {
      setIsAutoScroll(true);
      setScrollOffset(maxOffset);
    } else if (key.pageUp) {
      setIsAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - height));
    } else if (key.pageDown) {
      setScrollOffset((prev) => {
        const newOffset = Math.min(maxOffset, prev + height);
        if (newOffset === maxOffset) setIsAutoScroll(true);
        return newOffset;
      });
    }
  });

  const scrollIndicator = lines.length > height
    ? ` [${scrollOffset + 1}-${Math.min(scrollOffset + height, lines.length)}/${lines.length}]`
    : "";

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      {title && (
        <Box>
          <Text bold color="cyan">{title}</Text>
          <Text dimColor>{scrollIndicator}</Text>
          {isAutoScroll && <Text color="green"> [AUTO]</Text>}
        </Box>
      )}
      <Box flexDirection="column" height={height}>
        {visibleLines.map((line, i) => (
          <Text key={scrollOffset + i} wrap="truncate">
            {line}
          </Text>
        ))}
        {visibleLines.length < height &&
          Array(height - visibleLines.length)
            .fill(null)
            .map((_, i) => <Text key={`empty-${i}`}> </Text>)}
      </Box>
      <Text dimColor>↑/↓ or j/k: scroll | g/G: top/bottom | PgUp/PgDn</Text>
    </Box>
  );
}
