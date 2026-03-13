import React from "react";
import { Box, Text } from "ink";

interface Props {
  activeTab: number;
  connected: boolean;
  lastPoll: string;
}

const TABS = ["Logs", "Memory", "Agents", "Tokens"];

export function StatusBar({ activeTab, connected, lastPoll }: Props): React.ReactElement {
  const time = lastPoll ? lastPoll.split("T")[1]?.split(".")[0] ?? "" : "---";
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        {TABS.map((tab, i) => (
          <Text key={tab} color={i === activeTab ? "green" : "gray"} bold={i === activeTab}>
            [{i + 1}] {tab}
          </Text>
        ))}
      </Box>
      <Box gap={2}>
        <Text color={connected ? "green" : "red"}>● {connected ? "connected" : "disconnected"}</Text>
        <Text color="gray">{time}</Text>
        <Text color="gray">q quit</Text>
      </Box>
    </Box>
  );
}
