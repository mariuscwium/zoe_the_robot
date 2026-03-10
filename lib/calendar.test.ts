import { describe, it, expect, beforeEach } from "vitest";
import { CalendarTwin } from "../twins/calendar.js";
import type { Clock } from "./deps.js";
import {
  listUpcomingEvents,
  createEvent,
  createRecurringEvent,
  deleteEvent,
  findEvents,
} from "./calendar.js";

const TIMEZONE = "Pacific/Auckland";
const NOW = "2026-03-10T12:00:00Z";

function makeDeps(calendar: CalendarTwin) {
  const clock: Clock = { now: () => new Date(NOW) };
  return { calendar, clock };
}

describe("listUpcomingEvents", () => {
  let calendar: CalendarTwin;

  beforeEach(() => {
    calendar = new CalendarTwin();
  });

  it("returns empty list when no events exist", async () => {
    const deps = makeDeps(calendar);
    const result = await listUpcomingEvents(deps, { timezone: TIMEZONE });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("returns events within the default 7-day range", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Dentist",
      start: { dateTime: "2026-03-12T02:00:00Z" },
      end: { dateTime: "2026-03-12T03:00:00Z" },
    });

    const result = await listUpcomingEvents(deps, { timezone: TIMEZONE });

    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("Dentist");
  });

  it("excludes events outside the daysAhead range", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Far Away",
      start: { dateTime: "2026-04-01T02:00:00Z" },
      end: { dateTime: "2026-04-01T03:00:00Z" },
    });

    const result = await listUpcomingEvents(deps, {
      daysAhead: 3,
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("filters by query string", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Soccer Practice",
      start: { dateTime: "2026-03-11T06:00:00Z" },
      end: { dateTime: "2026-03-11T07:00:00Z" },
    });
    await calendar.insertEvent({
      summary: "Dentist",
      start: { dateTime: "2026-03-11T09:00:00Z" },
      end: { dateTime: "2026-03-11T10:00:00Z" },
    });

    const result = await listUpcomingEvents(deps, {
      query: "soccer",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("Soccer Practice");
  });
});

describe("createEvent", () => {
  let calendar: CalendarTwin;

  beforeEach(() => {
    calendar = new CalendarTwin();
  });

  it("creates an event and returns formatted data", async () => {
    const deps = makeDeps(calendar);
    const result = await createEvent(deps, {
      summary: "Team Meeting",
      startTime: "2026-03-11T02:00:00Z",
      endTime: "2026-03-11T03:00:00Z",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string;
    expect(data).toContain("Team Meeting");
    expect(data).toContain("ID:");
  });

  it("creates an event with reminders", async () => {
    const deps = makeDeps(calendar);
    const result = await createEvent(deps, {
      summary: "Call Accountant",
      startTime: "2026-03-11T02:00:00Z",
      endTime: "2026-03-11T02:30:00Z",
      timezone: TIMEZONE,
      reminders: [{ method: "popup", minutes: 0 }],
    });

    expect(result.success).toBe(true);

    // Verify reminders stored in twin
    const events = await calendar.listEvents({
      timeMin: "2026-03-11T00:00:00Z",
      timeMax: "2026-03-12T00:00:00Z",
    });
    const event = events.items[0];
    expect(event?.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 0 }],
    });
  });

  it("creates an event with location and description", async () => {
    const deps = makeDeps(calendar);
    const result = await createEvent(deps, {
      summary: "Birthday Party",
      startTime: "2026-03-14T03:00:00Z",
      endTime: "2026-03-14T06:00:00Z",
      description: "Bring a gift",
      location: "42 Oak St",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string;
    expect(data).toContain("Birthday Party");
    expect(data).toContain("42 Oak St");
  });
});

describe("createRecurringEvent", () => {
  let calendar: CalendarTwin;

  beforeEach(() => {
    calendar = new CalendarTwin();
  });

  it("creates a recurring event with RRULE", async () => {
    const deps = makeDeps(calendar);
    const result = await createRecurringEvent(deps, {
      summary: "Daily Medication",
      startTime: "2026-03-10T19:00:00Z",
      endTime: "2026-03-10T19:15:00Z",
      recurrence: "RRULE:FREQ=DAILY",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string;
    expect(data).toContain("Daily Medication");
  });

  it("recurring event expands with singleEvents=true", async () => {
    const deps = makeDeps(calendar);
    await createRecurringEvent(deps, {
      summary: "Daily Standup",
      startTime: "2026-03-10T21:00:00Z",
      endTime: "2026-03-10T21:30:00Z",
      recurrence: "RRULE:FREQ=DAILY;COUNT=3",
      timezone: TIMEZONE,
    });

    const listResult = await listUpcomingEvents(deps, {
      daysAhead: 7,
      timezone: TIMEZONE,
    });

    expect(listResult.success).toBe(true);
    const data = listResult.data as string[];
    expect(data).toHaveLength(3);
  });
});

describe("deleteEvent", () => {
  let calendar: CalendarTwin;

  beforeEach(() => {
    calendar = new CalendarTwin();
  });

  it("deletes an existing event", async () => {
    const deps = makeDeps(calendar);
    const event = await calendar.insertEvent({
      summary: "To Delete",
      start: { dateTime: "2026-03-11T02:00:00Z" },
      end: { dateTime: "2026-03-11T03:00:00Z" },
    });

    const result = await deleteEvent(deps, { eventId: event.id });

    expect(result.success).toBe(true);
    expect(result.data).toBe("Event deleted.");
  });

  it("returns error for non-existent event", async () => {
    const deps = makeDeps(calendar);
    const result = await deleteEvent(deps, { eventId: "nonexistent" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("deletes a recurring event series", async () => {
    const deps = makeDeps(calendar);
    const event = await calendar.insertEvent({
      summary: "Daily Medication",
      start: { dateTime: "2026-03-10T19:00:00Z" },
      end: { dateTime: "2026-03-10T19:15:00Z" },
      recurrence: ["RRULE:FREQ=DAILY"],
    });

    const result = await deleteEvent(deps, { eventId: event.id });

    expect(result.success).toBe(true);

    const listResult = await listUpcomingEvents(deps, { timezone: TIMEZONE });
    expect((listResult.data as string[]).length).toBe(0);
  });
});

describe("findEvents", () => {
  let calendar: CalendarTwin;

  beforeEach(() => {
    calendar = new CalendarTwin();
  });

  it("finds events matching query", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Soccer Practice",
      start: { dateTime: "2026-03-11T06:00:00Z" },
      end: { dateTime: "2026-03-11T07:00:00Z" },
    });
    await calendar.insertEvent({
      summary: "Piano Lesson",
      start: { dateTime: "2026-03-11T08:00:00Z" },
      end: { dateTime: "2026-03-11T09:00:00Z" },
    });

    const result = await findEvents(deps, {
      query: "piano",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("Piano Lesson");
  });

  it("returns empty list when no events match", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Soccer Practice",
      start: { dateTime: "2026-03-11T06:00:00Z" },
      end: { dateTime: "2026-03-11T07:00:00Z" },
    });

    const result = await findEvents(deps, {
      query: "dentist",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("searches within custom daysAhead range", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Far Dentist",
      start: { dateTime: "2026-04-10T02:00:00Z" },
      end: { dateTime: "2026-04-10T03:00:00Z" },
    });

    const result = await findEvents(deps, {
      query: "dentist",
      daysAhead: 60,
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("Far Dentist");
  });

  it("matches events by description", async () => {
    const deps = makeDeps(calendar);
    await calendar.insertEvent({
      summary: "Appointment",
      description: "See Dr. Smith about knee",
      start: { dateTime: "2026-03-12T02:00:00Z" },
      end: { dateTime: "2026-03-12T03:00:00Z" },
    });

    const result = await findEvents(deps, {
      query: "knee",
      timezone: TIMEZONE,
    });

    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(1);
    expect(data[0]).toContain("Appointment");
  });
});
