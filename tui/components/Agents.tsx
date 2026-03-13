import React from "react";
import { Box, Text } from "ink";
import type { AuditEntry, InferenceLogEntry, UnifiedLogEntry } from "../lib/types.js";

interface Props {
  logs: UnifiedLogEntry[];
}

const TOOL_NAMES = new Set([
  "read_memory", "write_memory", "delete_memory", "list_memory_keys",
  "append_memory", "list_events", "create_event", "create_recurring_event",
  "delete_calendar_event", "find_events", "confirm_action",
]);

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function Agents({ logs }: Props): React.ReactElement {
  const toolCalls = logs
    .filter((e) => e.kind === "audit" && TOOL_NAMES.has((e.data as AuditEntry).action))
    .slice(0, 20);

  const inferenceRuns = logs
    .filter((e) => e.kind === "inference")
    .slice(0, 20);

  return (
    <Box flexGrow={1} gap={1}>
      <Box flexDirection="column" width="50%">
        <Text bold color="white"> Zoe — Tool Calls</Text>
        {toolCalls.length === 0 && <Text color="gray"> No tool calls yet</Text>}
        {toolCalls.map((entry, i) => {
          const a = entry.data as AuditEntry;
          return (
            <Text key={i} color="yellow">
              {formatTime(entry.timestamp)} {a.action} {truncate(a.detail, 40)}
            </Text>
          );
        })}
      </Box>
      <Box flexDirection="column" width="50%">
        <Text bold color="white"> Inference — Runs</Text>
        {inferenceRuns.length === 0 && <Text color="gray"> No inference runs yet</Text>}
        {inferenceRuns.map((entry, i) => {
          const inf = entry.data as InferenceLogEntry;
          const writeSummary = inf.skipped
            ? "skipped"
            : inf.writes.map((w) => w.key).join(", ");
          return (
            <Text key={i} color={inf.skipped ? "gray" : "green"}>
              {formatTime(entry.timestamp)} {inf.memberId} → {truncate(writeSummary, 40)}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
