export interface IncomingLogEntry {
  timestamp: string;
  memberId: string;
  messageType: string;
  text: string;
}

export interface AuditEntry {
  timestamp: string;
  memberId: string;
  action: string;
  detail: string;
}

export interface InferenceLogEntry {
  timestamp: string;
  memberId: string;
  keysLoaded: string[];
  writes: { key: string; contentLength: number }[];
  skipped: boolean;
}

export interface TokenLogEntry {
  timestamp: string;
  agent: "zoe" | "inference";
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export interface UnifiedLogEntry {
  timestamp: string;
  kind: "incoming" | "audit" | "inference";
  data: IncomingLogEntry | AuditEntry | InferenceLogEntry;
}

export interface DashboardData {
  logs: UnifiedLogEntry[];
  memoryKeys: string[];
  tokenLog: TokenLogEntry[];
  connected: boolean;
  lastPoll: string;
}
