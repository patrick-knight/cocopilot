/**
 * TUI Confirm Dialog component
 */

import React from "react";
import { Box, Text, useInput } from "ink";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Yes",
  cancelLabel = "No",
}: ConfirmDialogProps): React.ReactElement {
  const [selected, setSelected] = React.useState(false);

  useInput((input, key) => {
    if (input === "y" || input === "Y") {
      onConfirm();
    } else if (input === "n" || input === "N" || key.escape) {
      onCancel();
    } else if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected((prev) => !prev);
    } else if (key.return) {
      if (selected) {
        onConfirm();
      } else {
        onCancel();
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Text>{message}</Text>
      <Box marginTop={1} gap={2}>
        <Text
          backgroundColor={!selected ? "gray" : undefined}
          color={!selected ? "black" : undefined}
        >
          [{cancelLabel}]
        </Text>
        <Text
          backgroundColor={selected ? "red" : undefined}
          color={selected ? "white" : undefined}
        >
          [{confirmLabel}]
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>y/n or ←/→ to select, Enter to confirm</Text>
      </Box>
    </Box>
  );
}
