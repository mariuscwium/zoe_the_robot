/**
 * Tool dispatch — maps Claude tool names to implementation functions.
 * Separated from agent.ts to stay within line limits.
 */

import type { RedisClient, CalendarClient, CalendarProvider, Clock } from "./deps.js";
import type { FamilyMember, ToolResult } from "./types.js";
import {
  readMemory,
  writeMemory,
  deleteMemory,
  listMemoryKeys,
  appendToMemory,
} from "./memory.js";
import {
  listUpcomingEvents,
  createEvent,
  createRecurringEvent,
  deleteEvent,
  findEvents,
} from "./calendar.js";
import { appendAudit } from "./audit.js";

export interface DispatchDeps {
  redis: RedisClient;
  calendar: CalendarProvider;
  clock: Clock;
}

type ToolInput = Record<string, unknown>;

const MUTATING_TOOLS = new Set([
  "write_memory",
  "delete_memory",
  "append_memory",
  "create_event",
  "create_recurring_event",
  "delete_calendar_event",
]);

export async function dispatchTool(
  deps: DispatchDeps,
  member: FamilyMember,
  name: string,
  input: ToolInput,
): Promise<ToolResult> {
  const result = await executeToolCall(deps, member, name, input);
  if (MUTATING_TOOLS.has(name)) {
    await auditMutation(deps, member, name, input);
  }
  return result;
}

async function executeToolCall(
  deps: DispatchDeps,
  member: FamilyMember,
  name: string,
  input: ToolInput,
): Promise<ToolResult> {
  try {
    return await routeToolCall(deps, member, name, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

function str(input: ToolInput, key: string): string {
  const val = input[key];
  if (typeof val !== "string") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return val;
}

function optStr(input: ToolInput, key: string): string | undefined {
  const val = input[key];
  return typeof val === "string" ? val : undefined;
}

function optNum(input: ToolInput, key: string): number | undefined {
  const val = input[key];
  return typeof val === "number" ? val : undefined;
}

async function routeToolCall(
  deps: DispatchDeps,
  member: FamilyMember,
  name: string,
  input: ToolInput,
): Promise<ToolResult> {
  const memoryResult = await routeMemoryTool(deps, name, input);
  if (memoryResult !== null) return memoryResult;

  const calendarResult = await routeCalendarTool(deps, member, name, input);
  if (calendarResult !== null) return calendarResult;

  if (name === "confirm_action") {
    return { success: true, data: "Confirmed" };
  }
  return { success: false, error: `Unknown tool: ${name}` };
}

async function routeMemoryTool(
  deps: DispatchDeps,
  name: string,
  input: ToolInput,
): Promise<ToolResult | null> {
  switch (name) {
    case "read_memory": {
      const content = await readMemory(deps, str(input, "key"));
      return { success: true, data: content ?? "No document found at this key." };
    }
    case "write_memory":
      await writeMemory(deps, str(input, "key"), str(input, "content"));
      return { success: true, data: "Memory document saved." };
    case "delete_memory":
      await deleteMemory(deps, str(input, "key"));
      return { success: true, data: "Memory document deleted." };
    case "list_memory_keys": {
      const keys = await listMemoryKeys(deps, str(input, "pattern"));
      return { success: true, data: keys };
    }
    case "append_memory":
      await appendToMemory(deps, str(input, "key"), str(input, "content"));
      return { success: true, data: "Content appended." };
    default:
      return null;
  }
}

const CALENDAR_TOOLS = new Set([
  "list_events", "create_event", "create_recurring_event",
  "delete_calendar_event", "find_events",
]);

async function routeCalendarTool(
  deps: DispatchDeps, member: FamilyMember, name: string, input: ToolInput,
): Promise<ToolResult | null> {
  if (!CALENDAR_TOOLS.has(name)) return null;
  const client = await deps.calendar.getClient(member.id);
  if (client === null) {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.WEBHOOK_URL ?? "").replace(/\/api\/telegram$/, "");
    return { success: false, error: "calendar_not_connected", data: { authUrl: `${base}/api/oauth/google?member=${member.id}` } };
  }
  const cd = { calendar: client, clock: deps.clock };
  const tz = member.timezone;
  switch (name) {
    case "list_events":
      return listUpcomingEvents(cd, { daysAhead: optNum(input, "days_ahead"), query: optStr(input, "query"), timezone: tz });
    case "create_event":
      return createEventFromInput(cd, input, tz);
    case "create_recurring_event":
      return createRecurringEvent(cd, {
        summary: str(input, "summary"), startTime: str(input, "start_time"),
        endTime: str(input, "end_time"), recurrence: str(input, "recurrence"),
        description: optStr(input, "description"), location: optStr(input, "location"), timezone: tz,
      });
    case "delete_calendar_event":
      return deleteEvent(cd, { eventId: str(input, "event_id") });
    case "find_events":
      return findEvents(cd, { query: str(input, "query"), daysAhead: optNum(input, "days_ahead"), timezone: tz });
    default:
      return null;
  }
}

async function createEventFromInput(
  deps: { calendar: CalendarClient; clock: Clock }, input: ToolInput, tz: string,
): Promise<ToolResult> {
  const reminders = Array.isArray(input.reminders)
    ? (input.reminders as { method: string; minutes: number }[]) : undefined;
  return createEvent(deps, {
    summary: str(input, "summary"), startTime: str(input, "start_time"),
    endTime: str(input, "end_time"), description: optStr(input, "description"),
    location: optStr(input, "location"), timezone: tz, reminders,
  });
}

async function auditMutation(
  deps: DispatchDeps,
  member: FamilyMember,
  name: string,
  input: ToolInput,
): Promise<void> {
  const detail = JSON.stringify(input);
  await appendAudit(deps, {
    timestamp: new Date().toISOString(),
    memberId: member.id,
    action: name,
    detail,
  });
}
