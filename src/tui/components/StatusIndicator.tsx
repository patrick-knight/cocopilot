/**
 * TUI Status indicator component
 */

import React from "react";
import { Text } from "ink";
import { getStatusColor, getStatusSymbol } from "../utils/colors.js";

interface StatusIndicatorProps {
  status: string;
  label?: string;
  showSymbol?: boolean;
}

export function StatusIndicator({ status, label, showSymbol = true }: StatusIndicatorProps): React.ReactElement {
  const colorFn = getStatusColor(status);
  const symbol = getStatusSymbol(status);

  return (
    <Text>
      {showSymbol && <Text>{symbol} </Text>}
      <Text color={undefined}>
        {colorFn ? colorFn(label ?? status) : (label ?? status)}
      </Text>
    </Text>
  );
}

interface StatusCardProps {
  title: string;
  status: string;
  details?: string;
}

export function StatusCard({ title, status, details }: StatusCardProps): React.ReactElement {
  return (
    <Text>
      <Text bold>{title}: </Text>
      <StatusIndicator status={status} />
      {details && <Text dimColor> ({details})</Text>}
    </Text>
  );
}
