/**
 * TUI Header component with CoCoPilot banner and breadcrumbs
 */

import React from "react";
import { Box, Text } from "ink";
import { useRouter, getBreadcrumbs } from "../router.js";
import { symbols } from "../utils/colors.js";

// ASCII art banner for CoCoPilot
const LOGO_LINES = [
  "┌─────────────────────────────────────────────┐",
  "│   🍫 CoCoPilot - AI Worker Orchestration    │",
  "└─────────────────────────────────────────────┘",
];

export function Header({ showBanner = false }: { showBanner?: boolean }): React.ReactElement {
  const { screen, canGoBack } = useRouter();
  const breadcrumbs = getBreadcrumbs(screen);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {showBanner && (
        <Box flexDirection="column" marginBottom={1}>
          {LOGO_LINES.map((line, i) => (
            <Text key={i} color="cyan">{line}</Text>
          ))}
        </Box>
      )}
      <Box>
        <Text bold color="cyan">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Text color="gray"> {symbols.arrow} </Text>}
              <Text color={i === breadcrumbs.length - 1 ? "white" : "gray"}>{crumb}</Text>
            </React.Fragment>
          ))}
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          {canGoBack ? "Esc: Back | " : ""}q: Quit | ?: Help | ^S: Status | ^M: Metrics | r: Refresh
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>{"─".repeat(60)}</Text>
      </Box>
    </Box>
  );
}
