/**
 * Server-side datetime pre-processing.
 * Injected before the Claude agent prompt so it knows the current date/time.
 * Uses Intl.DateTimeFormat for timezone-aware formatting — no external date libs.
 */

import type { Clock } from "./deps.js";

const LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const SHORT_ABBR_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZoneName: "short",
};

const EVENT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/**
 * Build a datetime context string for the Claude system prompt.
 * Example: "Current date and time: Tuesday, March 10, 2026 at 2:30 PM (Pacific/Auckland, NZDT). Day of week: Tuesday."
 */
export function buildDateTimeContext(clock: Clock, timezone: string): string {
  const now = clock.now();
  const dateStr = formatLongDate(now, timezone);
  const abbr = getTimezoneAbbr(now, timezone);
  const dayOfWeek = getDayOfWeek(now, timezone);

  return `Current date and time: ${dateStr} (${timezone}, ${abbr}). Day of week: ${dayOfWeek}.`;
}

/**
 * Format an ISO datetime string for human reading in the given timezone.
 * Example: "Tuesday, March 10, 2026 at 2:30 PM"
 */
export function formatEventTime(dateTime: string, timezone: string): string {
  const date = new Date(dateTime);
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    ...EVENT_TIME_OPTIONS,
    timeZone: timezone,
  });
  return formatter.format(date);
}

function formatLongDate(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    ...LONG_DATE_OPTIONS,
    timeZone: timezone,
  });
  return formatter.format(date);
}

function getTimezoneAbbr(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    ...SHORT_ABBR_OPTIONS,
    timeZone: timezone,
  });
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  return tzPart?.value ?? timezone;
}

function getDayOfWeek(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    weekday: "long",
    timeZone: timezone,
  });
  return formatter.format(date);
}
