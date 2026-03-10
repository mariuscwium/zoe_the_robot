/**
 * Basic RRULE expansion for the Calendar digital twin.
 * Supports FREQ=DAILY, FREQ=WEEKLY, FREQ=MONTHLY, FREQ=YEARLY
 * with optional COUNT and UNTIL.
 */

import type { CalendarEvent } from "../lib/deps.js";

interface RRuleParts {
  freq: string;
  count?: number;
  until?: Date;
  interval: number;
}

function parseRRule(rrule: string): RRuleParts | null {
  const cleaned = rrule.replace(/^RRULE:/, "");
  const parts = cleaned.split(";");
  let freq = "";
  let count: number | undefined;
  let until: Date | undefined;
  let interval = 1;

  for (const part of parts) {
    const [key, value] = part.split("=") as [string, string | undefined];
    if (value === undefined) continue;
    if (key === "FREQ") freq = value;
    if (key === "COUNT") count = parseInt(value, 10);
    if (key === "UNTIL") until = parseUntilDate(value);
    if (key === "INTERVAL") interval = parseInt(value, 10);
  }

  if (freq === "") return null;
  return { freq, count, until, interval };
}

function parseUntilDate(value: string): Date {
  // Format: 20260315T235959Z or 20260315
  if (value.length >= 15) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    const h = value.slice(9, 11);
    const min = value.slice(11, 13);
    const s = value.slice(13, 15);
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
  }
  const y = value.slice(0, 4);
  const m = value.slice(4, 6);
  const d = value.slice(6, 8);
  return new Date(`${y}-${m}-${d}T23:59:59Z`);
}

function advanceDate(date: Date, freq: string, interval: number): Date {
  const next = new Date(date);
  if (freq === "DAILY") next.setDate(next.getDate() + interval);
  if (freq === "WEEKLY") next.setDate(next.getDate() + 7 * interval);
  if (freq === "MONTHLY") next.setMonth(next.getMonth() + interval);
  if (freq === "YEARLY") next.setFullYear(next.getFullYear() + interval);
  return next;
}

function computeDurationMs(event: CalendarEvent): number {
  const startStr = event.start.dateTime ?? event.start.date ?? "";
  const endStr = event.end.dateTime ?? event.end.date ?? "";
  return new Date(endStr).getTime() - new Date(startStr).getTime();
}

function buildInstanceDateTime(
  original: Date,
  sourceEvent: CalendarEvent,
  isStart: boolean,
): { dateTime?: string; date?: string; timeZone?: string } {
  const ref = isStart ? sourceEvent.start : sourceEvent.end;
  if (ref.dateTime !== undefined) {
    return { dateTime: original.toISOString(), timeZone: ref.timeZone };
  }
  const iso = original.toISOString().slice(0, 10);
  return { date: iso, timeZone: ref.timeZone };
}

const DEFAULT_MAX_INSTANCES = 365;

export function expandRecurringEvent(
  event: CalendarEvent,
  timeMin: Date,
  timeMax: Date,
): CalendarEvent[] {
  const rule = extractRule(event);
  if (rule === null) return [];

  const startStr = event.start.dateTime ?? event.start.date ?? "";
  const baseStart = new Date(startStr);
  const durationMs = computeDurationMs(event);

  return generateInstances(event, rule, { baseStart, durationMs, timeMin, timeMax });
}

function extractRule(event: CalendarEvent): RRuleParts | null {
  const recurrence = event.recurrence;
  if (recurrence === undefined || recurrence.length === 0) return null;
  const rruleStr =
    recurrence.find((r) => r.startsWith("RRULE:")) ?? recurrence[0];
  if (rruleStr === undefined) return null;
  return parseRRule(rruleStr);
}

interface ExpansionWindow {
  baseStart: Date;
  durationMs: number;
  timeMin: Date;
  timeMax: Date;
}

function generateInstances(
  event: CalendarEvent,
  rule: RRuleParts,
  window: ExpansionWindow,
): CalendarEvent[] {
  const { timeMin, timeMax } = window;
  const instances: CalendarEvent[] = [];
  let current = new Date(window.baseStart);
  const limit = rule.count ?? DEFAULT_MAX_INSTANCES;

  for (let i = 0; i < limit; i++) {
    if (rule.until !== undefined && current > rule.until) break;
    if (current >= timeMax) break;
    const instanceEnd = new Date(current.getTime() + window.durationMs);
    if (instanceEnd > timeMin) {
      instances.push(buildInstance(event, current, instanceEnd, i));
    }
    current = advanceDate(current, rule.freq, rule.interval);
  }
  return instances;
}

function buildInstance(
  event: CalendarEvent,
  start: Date,
  end: Date,
  index: number,
): CalendarEvent {
  return {
    ...event,
    id: `${event.id}_instance_${String(index)}`,
    start: buildInstanceDateTime(start, event, true),
    end: buildInstanceDateTime(end, event, false),
    recurrence: undefined,
  };
}
