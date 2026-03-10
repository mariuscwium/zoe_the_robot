/**
 * Domain types shared across the application.
 */

export interface FamilyMember {
  id: string;
  name: string;
  chatId: number;
  timezone: string;
  role: string;
  isAdmin: boolean;
  preferences?: string;
}

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

export interface PendingConfirm {
  memberId: string;
  description: string;
  toolCalls: ToolCallRecord[];
  createdAt: number;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
