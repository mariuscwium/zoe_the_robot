/**
 * Calendar tool implementations.
 * Each function returns Promise<ToolResult> and is called by Claude's tool loop.
 */

import type { CalendarClient, CalendarEvent, Clock } from "./deps.js";
import type { ToolResult } from "./types.js";
import { formatEventTime } from "./datetime.js";

interface CalendarDeps {
  calendar: CalendarClient;
  clock: Clock;
}

interface ListParams {
  daysAhead?: number;
  query?: string;
  timezone: string;
}

interface CreateParams {
  summary: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  timezone: string;
  reminders?: { method: string; minutes: number }[];
}

interface CreateRecurringParams {
  summary: string;
  startTime: string;
  endTime: string;
  recurrence: string;
  description?: string;
  location?: string;
  timezone: string;
}

interface DeleteParams {
  eventId: string;
}

interface FindParams {
  query: string;
  daysAhead?: number;
  timezone: string;
}

const DEFAULT_DAYS_AHEAD = 7;
const MS_PER_DAY = 86_400_000;

export async function listUpcomingEvents(
  deps: CalendarDeps,
  params: ListParams,
): Promise<ToolResult> {
  try {
    const { timeMin, timeMax } = buildTimeRange(deps.clock, params.daysAhead);
    const result = await deps.calendar.listEvents({
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      q: params.query,
    });
    const formatted = result.items.map((e) => formatEvent(e, params.timezone));
    return { success: true, data: formatted };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function createEvent(
  deps: CalendarDeps,
  params: CreateParams,
): Promise<ToolResult> {
  try {
    const event = await deps.calendar.insertEvent({
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: { dateTime: params.startTime, timeZone: params.timezone },
      end: { dateTime: params.endTime, timeZone: params.timezone },
      reminders: buildReminders(params.reminders),
    });
    return {
      success: true,
      data: formatEvent(event, params.timezone),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function createRecurringEvent(
  deps: CalendarDeps,
  params: CreateRecurringParams,
): Promise<ToolResult> {
  try {
    const event = await deps.calendar.insertEvent({
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: { dateTime: params.startTime, timeZone: params.timezone },
      end: { dateTime: params.endTime, timeZone: params.timezone },
      recurrence: [params.recurrence],
    });
    return {
      success: true,
      data: formatEvent(event, params.timezone),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function deleteEvent(
  deps: CalendarDeps,
  params: DeleteParams,
): Promise<ToolResult> {
  try {
    await deps.calendar.deleteEvent(params.eventId);
    return { success: true, data: "Event deleted." };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function findEvents(
  deps: CalendarDeps,
  params: FindParams,
): Promise<ToolResult> {
  return listUpcomingEvents(deps, {
    daysAhead: params.daysAhead,
    query: params.query,
    timezone: params.timezone,
  });
}

// --- Helpers ---

function buildTimeRange(
  clock: Clock,
  daysAhead?: number,
): { timeMin: string; timeMax: string } {
  const now = clock.now();
  const days = daysAhead ?? DEFAULT_DAYS_AHEAD;
  const max = new Date(now.getTime() + days * MS_PER_DAY);
  return { timeMin: now.toISOString(), timeMax: max.toISOString() };
}

function buildReminders(
  reminders?: { method: string; minutes: number }[],
): { useDefault: boolean; overrides?: { method: string; minutes: number }[] } | undefined {
  if (reminders === undefined || reminders.length === 0) return undefined;
  return { useDefault: false, overrides: reminders };
}

function formatEvent(event: CalendarEvent, timezone: string): string {
  const parts: string[] = [event.summary];
  const startStr = event.start.dateTime ?? event.start.date;
  if (startStr !== undefined) {
    parts.push(formatEventTime(startStr, timezone));
  }
  if (event.location !== undefined) {
    parts.push(event.location);
  }
  parts.push(`(ID: ${event.id})`);
  return parts.join(" | ");
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
