/**
 * TUI Help Screen
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { Header } from "../components/index.js";
import { useRouter } from "../router.js";

export function HelpScreen(): React.ReactElement {
  const { goBack } = useRouter();

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "?") {
      goBack();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Header />

      <Box flexDirection="column" flexGrow={1}>
        <Text bold underline>Keyboard Shortcuts</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Global</Text>
          <Text>  q, Ctrl+C    Quit</Text>
          <Text>  ?            Toggle help</Text>
          <Text>  Esc          Go back / Cancel</Text>
          <Text>  s            Status screen</Text>
          <Text>  m            Metrics screen</Text>
          <Text>  r            Refresh current view</Text>
          <Text>  /            Search / Filter</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Navigation</Text>
          <Text>  ↑, k         Move up</Text>
          <Text>  ↓, j         Move down</Text>
          <Text>  g            Go to top</Text>
          <Text>  G            Go to bottom</Text>
          <Text>  Enter        Select / Open</Text>
          <Text>  Tab          Next field</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Actions</Text>
          <Text>  n, a         New (add repo, spawn worker)</Text>
          <Text>  d            Delete</Text>
          <Text>  x            Stop / Repair</Text>
          <Text>  p            Pause / Resume worker</Text>
          <Text>  y            Confirm</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Log Pane</Text>
          <Text>  PgUp/PgDn    Scroll page</Text>
          <Text>  g/G          Top / Bottom</Text>
        </Box>
      </Box>

      {/* Help - pinned to bottom */}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0}>
        <Text dimColor>Press Esc or ? to close help</Text>
      </Box>
    </Box>
  );
}
