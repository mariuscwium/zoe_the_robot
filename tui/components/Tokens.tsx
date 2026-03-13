import React from "react";
import { Box, Text } from "ink";
import type { TokenLogEntry } from "../lib/types.js";

interface Props {
  tokenLog: TokenLogEntry[];
}

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

interface AgentTotals {
  calls: number;
  input: number;
  output: number;
}

function sumByAgent(entries: TokenLogEntry[]): { zoe: AgentTotals; inference: AgentTotals } {
  const zoe: AgentTotals = { calls: 0, input: 0, output: 0 };
  const inference: AgentTotals = { calls: 0, input: 0, output: 0 };
  for (const e of entries) {
    const target = e.agent === "zoe" ? zoe : inference;
    target.calls++;
    target.input += e.input_tokens;
    target.output += e.output_tokens;
  }
  return { zoe, inference };
}

function renderTotals(label: string, totals: AgentTotals, color: string): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={color}> {label}</Text>
      <Text> Calls: {totals.calls}</Text>
      <Text> Input: {totals.input.toLocaleString()} tokens</Text>
      <Text> Output: {totals.output.toLocaleString()} tokens</Text>
      <Text> Total: {(totals.input + totals.output).toLocaleString()} tokens</Text>
    </Box>
  );
}

export function Tokens({ tokenLog }: Props): React.ReactElement {
  const totals = sumByAgent(tokenLog);
  const recent = tokenLog.slice(0, 20);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={4} marginBottom={1}>
        {renderTotals("Zoe (main)", totals.zoe, "cyan")}
        {renderTotals("Inference", totals.inference, "magenta")}
      </Box>
      <Text bold color="white"> Recent Calls</Text>
      {recent.length === 0 && <Text color="gray"> No token data yet</Text>}
      {recent.map((entry, i) => (
        <Text key={i} color={entry.agent === "zoe" ? "cyan" : "magenta"}>
          {formatTime(entry.timestamp)} {entry.agent.padEnd(10)} in:{entry.input_tokens} out:{entry.output_tokens}
        </Text>
      ))}
    </Box>
  );
}
