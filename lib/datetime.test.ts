import { describe, it, expect } from "vitest";
import type { Clock } from "./deps.js";
import { buildDateTimeContext, formatEventTime } from "./datetime.js";

const FIXED_DATE = "2026-03-10T01:30:00Z"; // 2:30 PM NZDT (UTC+13)
const TIMEZONE = "Pacific/Auckland";

function makeClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

describe("buildDateTimeContext", () => {
  it("includes the timezone name and abbreviation", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toContain("Pacific/Auckland");
    expect(result).toContain("NZDT");
  });

  it("includes the day of week", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toContain("Tuesday");
  });

  it("includes the date components", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toContain("March");
    expect(result).toContain("2026");
    expect(result).toContain("10");
  });

  it("includes time components", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toContain("2:30");
    expect(result).toContain("pm");
  });

  it("starts with 'Current date and time:'", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toMatch(/^Current date and time:/);
  });

  it("ends with a period", () => {
    const clock = makeClock(FIXED_DATE);
    const result = buildDateTimeContext(clock, TIMEZONE);

    expect(result).toMatch(/\.$/);
  });

  it("works with a different timezone", () => {
    const clock = makeClock("2026-03-10T12:00:00Z");
    const result = buildDateTimeContext(clock, "America/New_York");

    expect(result).toContain("America/New_York");
    expect(result).toContain("Tuesday");
  });
});

describe("formatEventTime", () => {
  it("formats an ISO datetime for NZDT reading", () => {
    const result = formatEventTime("2026-03-10T01:30:00Z", TIMEZONE);

    expect(result).toContain("Tuesday");
    expect(result).toContain("March");
    expect(result).toContain("2026");
    expect(result).toContain("2:30");
  });

  it("formats a date-only ISO string", () => {
    const result = formatEventTime("2026-03-15", TIMEZONE);

    expect(result).toContain("Sunday");
    expect(result).toContain("March");
    expect(result).toContain("15");
  });

  it("respects the provided timezone", () => {
    // Midnight UTC = 8pm previous day in New York (EDT)
    const result = formatEventTime("2026-03-10T00:00:00Z", "America/New_York");

    expect(result).toContain("Monday");
  });
});
