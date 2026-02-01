/**
 * TUI Header component with breadcrumbs
 */

import React from "react";
import { Box, Text } from "ink";
import { useRouter, getBreadcrumbs } from "../router.js";
import { symbols } from "../utils/colors.js";

export function Header(): React.ReactElement {
  const { screen, canGoBack } = useRouter();
  const breadcrumbs = getBreadcrumbs(screen);

  return (
    <Box flexDirection="column" marginBottom={1}>
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
          {canGoBack ? "Esc: Back" : ""} | q: Quit | ?: Help | s: Status | r: Refresh
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text dimColor>{"─".repeat(60)}</Text>
      </Box>
    </Box>
  );
}
