import { describe, it, expect, beforeEach } from "vitest";
import { CalendarTwin } from "./calendar.js";
import type { CalendarEventInput } from "../lib/deps.js";

function makeEvent(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    summary: "Test Event",
    start: { dateTime: "2026-03-15T10:00:00Z" },
    end: { dateTime: "2026-03-15T11:00:00Z" },
    ...overrides,
  };
}

describe("CalendarTwin", () => {
  let twin: CalendarTwin;

  beforeEach(() => {
    twin = new CalendarTwin();
  });

  describe("insertEvent", () => {
    it("returns event with all fields preserved", async () => {
      const input = makeEvent({
        summary: "Dentist",
        description: "Annual checkup",
        location: "123 Main St",
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 30 }],
        },
      });

      const event = await twin.insertEvent(input);

      expect(event.id).toBeDefined();
      expect(event.summary).toBe("Dentist");
      expect(event.description).toBe("Annual checkup");
      expect(event.location).toBe("123 Main St");
      expect(event.status).toBe("confirmed");
      expect(event.htmlLink).toContain(event.id);
      expect(event.created).toBeDefined();
      expect(event.updated).toBeDefined();
    });

    it("preserves reminders.overrides exactly", async () => {
      const overrides = [
        { method: "popup", minutes: 10 },
        { method: "email", minutes: 60 },
      ];
      const input = makeEvent({
        reminders: { useDefault: false, overrides },
      });

      const event = await twin.insertEvent(input);

      expect(event.reminders?.useDefault).toBe(false);
      expect(event.reminders?.overrides).toEqual(overrides);
    });
  });

  describe("listEvents", () => {
    it("returns inserted event", async () => {
      await twin.insertEvent(makeEvent({ summary: "My Event" }));

      const result = await twin.listEvents({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.summary).toBe("My Event");
      expect(result.kind).toBe("calendar#events");
    });

    it("filters by timeMin and timeMax", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Early",
        start: { dateTime: "2026-03-10T10:00:00Z" },
        end: { dateTime: "2026-03-10T11:00:00Z" },
      }));
      await twin.insertEvent(makeEvent({
        summary: "Middle",
        start: { dateTime: "2026-03-15T10:00:00Z" },
        end: { dateTime: "2026-03-15T11:00:00Z" },
      }));
      await twin.insertEvent(makeEvent({
        summary: "Late",
        start: { dateTime: "2026-03-20T10:00:00Z" },
        end: { dateTime: "2026-03-20T11:00:00Z" },
      }));

      const result = await twin.listEvents({
        timeMin: "2026-03-12T00:00:00Z",
        timeMax: "2026-03-18T00:00:00Z",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.summary).toBe("Middle");
    });

    it("q search matches summary", async () => {
      await twin.insertEvent(makeEvent({ summary: "Team standup" }));
      await twin.insertEvent(makeEvent({ summary: "Lunch break" }));

      const result = await twin.listEvents({ q: "standup" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.summary).toBe("Team standup");
    });

    it("q search matches description", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Meeting",
        description: "Discuss budget proposal",
      }));
      await twin.insertEvent(makeEvent({ summary: "Other" }));

      const result = await twin.listEvents({ q: "budget" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.summary).toBe("Meeting");
    });

    it("q search is case-insensitive", async () => {
      await twin.insertEvent(makeEvent({ summary: "IMPORTANT Meeting" }));

      const result = await twin.listEvents({ q: "important" });

      expect(result.items).toHaveLength(1);
    });

    it("orderBy=startTime sorts ascending", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Later",
        start: { dateTime: "2026-03-15T14:00:00Z" },
        end: { dateTime: "2026-03-15T15:00:00Z" },
      }));
      await twin.insertEvent(makeEvent({
        summary: "Earlier",
        start: { dateTime: "2026-03-15T09:00:00Z" },
        end: { dateTime: "2026-03-15T10:00:00Z" },
      }));

      const result = await twin.listEvents({ orderBy: "startTime" });

      expect(result.items[0]?.summary).toBe("Earlier");
      expect(result.items[1]?.summary).toBe("Later");
    });

    it("respects maxResults", async () => {
      await twin.insertEvent(makeEvent({ summary: "A" }));
      await twin.insertEvent(makeEvent({ summary: "B" }));
      await twin.insertEvent(makeEvent({ summary: "C" }));

      const result = await twin.listEvents({ maxResults: 2 });

      expect(result.items).toHaveLength(2);
    });
  });

  describe("recurring events", () => {
    it("singleEvents=true expands FREQ=DAILY into instances", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Daily standup",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T09:30:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-20T00:00:00Z",
      });

      expect(result.items).toHaveLength(5);
      expect(result.items[0]?.summary).toBe("Daily standup");
      expect(result.items[0]?.start.dateTime).toContain("2026-03-10");
      expect(result.items[4]?.start.dateTime).toContain("2026-03-14");
    });

    it("singleEvents=true with FREQ=WEEKLY", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Weekly sync",
        start: { dateTime: "2026-03-10T10:00:00Z" },
        end: { dateTime: "2026-03-10T11:00:00Z" },
        recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-01T00:00:00Z",
        timeMax: "2026-04-01T00:00:00Z",
      });

      expect(result.items).toHaveLength(3);
      // First instance: Mar 10, second: Mar 17, third: Mar 24
      expect(result.items[1]?.start.dateTime).toContain("2026-03-17");
      expect(result.items[2]?.start.dateTime).toContain("2026-03-24");
    });

    it("singleEvents=true respects timeMin/timeMax window", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Daily",
        start: { dateTime: "2026-03-01T09:00:00Z" },
        end: { dateTime: "2026-03-01T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=30"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-13T00:00:00Z",
      });

      // Mar 10, 11, 12 = 3 instances
      expect(result.items).toHaveLength(3);
    });

    it("expanded instances have unique IDs", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Daily",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-20T00:00:00Z",
      });

      const ids = result.items.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it("singleEvents=false returns raw recurring event", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Daily",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
      }));

      const result = await twin.listEvents({ singleEvents: false });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.recurrence).toEqual(["RRULE:FREQ=DAILY;COUNT=5"]);
    });

    it("expanded instances have no recurrence property", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Daily",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=2"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-20T00:00:00Z",
      });

      for (const item of result.items) {
        expect(item.recurrence).toBeUndefined();
      }
    });
  });

  describe("getEvent", () => {
    it("returns inserted event by ID", async () => {
      const inserted = await twin.insertEvent(makeEvent({ summary: "Found" }));

      const event = await twin.getEvent(inserted.id);

      expect(event.summary).toBe("Found");
      expect(event.id).toBe(inserted.id);
    });

    it("throws for unknown ID", async () => {
      await expect(twin.getEvent("nonexistent")).rejects.toThrow(
        "Event not found",
      );
    });
  });

  describe("deleteEvent", () => {
    it("removes event from store", async () => {
      const event = await twin.insertEvent(makeEvent({ summary: "Delete me" }));

      await twin.deleteEvent(event.id);

      const result = await twin.listEvents({});
      expect(result.items).toHaveLength(0);
    });

    it("throws for unknown ID", async () => {
      await expect(twin.deleteEvent("nonexistent")).rejects.toThrow(
        "Event not found",
      );
    });

    it("delete recurring series removes all instances from list", async () => {
      const event = await twin.insertEvent(makeEvent({
        summary: "Daily standup",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T09:30:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
      }));

      await twin.deleteEvent(event.id);

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-30T00:00:00Z",
      });
      expect(result.items).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("clears all state", async () => {
      await twin.insertEvent(makeEvent());
      twin.reset();

      const result = await twin.listEvents({});
      expect(result.items).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles all-day events with date instead of dateTime", async () => {
      await twin.insertEvent(makeEvent({
        summary: "All day",
        start: { date: "2026-03-15" },
        end: { date: "2026-03-16" },
      }));

      const result = await twin.listEvents({
        timeMin: "2026-03-14T00:00:00Z",
        timeMax: "2026-03-17T00:00:00Z",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.start.date).toBe("2026-03-15");
    });

    it("assigns unique IDs to each inserted event", async () => {
      const e1 = await twin.insertEvent(makeEvent());
      const e2 = await twin.insertEvent(makeEvent());

      expect(e1.id).not.toBe(e2.id);
    });

    it("preserves timeZone on start and end", async () => {
      const event = await twin.insertEvent(makeEvent({
        start: { dateTime: "2026-03-15T10:00:00", timeZone: "Pacific/Auckland" },
        end: { dateTime: "2026-03-15T11:00:00", timeZone: "Pacific/Auckland" },
      }));

      expect(event.start.timeZone).toBe("Pacific/Auckland");
      expect(event.end.timeZone).toBe("Pacific/Auckland");
    });

    it("handles RRULE with UNTIL", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Until event",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;UNTIL=20260312T235959Z"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-20T00:00:00Z",
      });

      // Mar 10, 11, 12
      expect(result.items).toHaveLength(3);
    });

    it("handles RRULE with INTERVAL", async () => {
      await twin.insertEvent(makeEvent({
        summary: "Every other day",
        start: { dateTime: "2026-03-10T09:00:00Z" },
        end: { dateTime: "2026-03-10T10:00:00Z" },
        recurrence: ["RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3"],
      }));

      const result = await twin.listEvents({
        singleEvents: true,
        timeMin: "2026-03-10T00:00:00Z",
        timeMax: "2026-03-20T00:00:00Z",
      });

      expect(result.items).toHaveLength(3);
      // Mar 10, 12, 14
      expect(result.items[1]?.start.dateTime).toContain("2026-03-12");
      expect(result.items[2]?.start.dateTime).toContain("2026-03-14");
    });
  });
});
