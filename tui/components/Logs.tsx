import React from "react";
import { Box, Text } from "ink";
import type { UnifiedLogEntry, IncomingLogEntry, AuditEntry, InferenceLogEntry } from "../lib/types.js";

interface Props {
  logs: UnifiedLogEntry[];
}

function formatTime(ts: string): string {
  return ts.split("T")[1]?.split(".")[0] ?? ts;
}

function colorForKind(kind: UnifiedLogEntry["kind"]): string {
  if (kind === "incoming") return "cyan";
  if (kind === "inference") return "magenta";
  return "yellow";
}

function renderIncoming(entry: IncomingLogEntry): string {
  const preview = entry.text.length > 60 ? entry.text.slice(0, 60) + "..." : entry.text;
  return `[${entry.messageType}] ${entry.memberId}: ${preview}`;
}

function renderAudit(entry: AuditEntry): string {
  const detail = entry.detail.length > 60 ? entry.detail.slice(0, 60) + "..." : entry.detail;
  return `${entry.action} (${entry.memberId}) ${detail}`;
}

function renderInference(entry: InferenceLogEntry): string {
  if (entry.skipped) return `inference skipped (${entry.memberId})`;
  const keys = entry.writes.map((w) => w.key).join(", ");
  return `inference wrote: ${keys} (${entry.memberId})`;
}

function renderEntry(entry: UnifiedLogEntry): string {
  if (entry.kind === "incoming") return renderIncoming(entry.data as IncomingLogEntry);
  if (entry.kind === "inference") return renderInference(entry.data as InferenceLogEntry);
  return renderAudit(entry.data as AuditEntry);
}

export function Logs({ logs }: Props): React.ReactElement {
  const visible = logs.slice(0, 30);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="white"> Unified Logs (newest first)</Text>
      <Box flexDirection="column" paddingX={1}>
        {visible.length === 0 && <Text color="gray">No log entries yet</Text>}
        {visible.map((entry, i) => (
          <Text key={i} color={entry.kind === "audit" && (entry.data as AuditEntry).action === "processing_error" ? "red" : colorForKind(entry.kind)}>
            {formatTime(entry.timestamp)} {renderEntry(entry)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
