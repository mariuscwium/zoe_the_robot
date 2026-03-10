/**
 * Digital twin: Google Calendar Events API.
 * Stateful in-memory behavioral clone for testing.
 */

import type {
  CalendarClient,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventList,
  ListEventsParams,
} from "../lib/deps.js";
import { expandRecurringEvent } from "./calendar-rrule.js";

const EVENT_KIND = "calendar#events";
const EVENT_STATUS = "confirmed";
const HTML_LINK_PREFIX = "https://calendar.google.com/calendar/event?eid=";

export class CalendarTwin implements CalendarClient {
  private events = new Map<string, CalendarEvent>();
  private nextId = 1;

  listEvents(params: ListEventsParams): Promise<CalendarEventList> {
    let items = this.collectItems(params);
    items = applyTimeFilter(items, params);
    items = applySearchFilter(items, params.q);
    items = applySort(items, params.orderBy);

    if (params.maxResults !== undefined) {
      items = items.slice(0, params.maxResults);
    }

    return Promise.resolve({ kind: EVENT_KIND, items });
  }

  insertEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const id = `evt_${String(this.nextId++)}`;
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      ...input,
      id,
      status: EVENT_STATUS,
      htmlLink: `${HTML_LINK_PREFIX}${id}`,
      created: now,
      updated: now,
    };
    this.events.set(id, event);
    return Promise.resolve(event);
  }

  getEvent(eventId: string): Promise<CalendarEvent> {
    const event = this.events.get(eventId);
    if (event === undefined) {
      return Promise.reject(new Error(`Event not found: ${eventId}`));
    }
    return Promise.resolve(event);
  }

  deleteEvent(eventId: string): Promise<void> {
    if (!this.events.has(eventId)) {
      return Promise.reject(new Error(`Event not found: ${eventId}`));
    }
    this.events.delete(eventId);
    return Promise.resolve();
  }

  /** Reset all state — call between tests. */
  reset(): void {
    this.events.clear();
    this.nextId = 1;
  }

  private collectItems(params: ListEventsParams): CalendarEvent[] {
    if (params.singleEvents === true) {
      return this.expandAllRecurring(params);
    }
    return [...this.events.values()];
  }

  private expandAllRecurring(params: ListEventsParams): CalendarEvent[] {
    const timeMin = new Date(params.timeMin ?? "1970-01-01T00:00:00Z");
    const timeMax = new Date(params.timeMax ?? "2100-01-01T00:00:00Z");
    const result: CalendarEvent[] = [];

    for (const event of this.events.values()) {
      if (isRecurring(event)) {
        result.push(...expandRecurringEvent(event, timeMin, timeMax));
      } else {
        result.push(event);
      }
    }
    return result;
  }
}

function isRecurring(event: CalendarEvent): boolean {
  return event.recurrence !== undefined && event.recurrence.length > 0;
}

function getStartMs(event: CalendarEvent): number {
  const str = event.start.dateTime ?? event.start.date ?? "";
  return new Date(str).getTime();
}

function getEndMs(event: CalendarEvent): number {
  const str = event.end.dateTime ?? event.end.date ?? "";
  return new Date(str).getTime();
}

function applyTimeFilter(
  items: CalendarEvent[],
  params: ListEventsParams,
): CalendarEvent[] {
  const minMs =
    params.timeMin !== undefined
      ? new Date(params.timeMin).getTime()
      : undefined;
  const maxMs =
    params.timeMax !== undefined
      ? new Date(params.timeMax).getTime()
      : undefined;

  return items.filter((e) => {
    if (minMs !== undefined && getEndMs(e) <= minMs) return false;
    if (maxMs !== undefined && getStartMs(e) >= maxMs) return false;
    return true;
  });
}

function applySearchFilter(
  items: CalendarEvent[],
  q: string | undefined,
): CalendarEvent[] {
  if (q === undefined || q === "") return items;
  const lower = q.toLowerCase();
  return items.filter((e) => {
    const summary = e.summary.toLowerCase();
    const desc = (e.description ?? "").toLowerCase();
    return summary.includes(lower) || desc.includes(lower);
  });
}

function applySort(
  items: CalendarEvent[],
  orderBy: string | undefined,
): CalendarEvent[] {
  if (orderBy !== "startTime") return items;
  return [...items].sort((a, b) => getStartMs(a) - getStartMs(b));
}
