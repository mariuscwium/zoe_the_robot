/**
 * Eval scenarios — each tests a specific agent behavior against real Claude.
 */

import type { EvalScenario } from "./eval-harness.js";

export const SCENARIOS: EvalScenario[] = [
  {
    name: "identity",
    description: "Zoe identifies as Zoe, not Claude",
    userMessage: "What's your name?",
    calendarConnected: true,
    assertions: [
      { type: "response_contains", text: "Zoe" },
      { type: "response_not_contains", text: "Claude" },
      { type: "no_markdown" },
    ],
  },

  {
    name: "single-event-creation",
    description: "Single create_event actually calls the tool",
    userMessage: "Create a calendar event called Dentist on March 15 2026 from 2pm to 3pm",
    calendarConnected: true,
    assertions: [
      { type: "tool_called", name: "create_event", minCount: 1 },
      {
        type: "custom",
        name: "event appears in calendar",
        fn: (ctx) => ctx.calendarEvents.some((e) => e.toLowerCase().includes("dentist")),
      },
    ],
  },

  {
    name: "bulk-event-creation",
    description: "Multiple events each get a real tool call",
    userMessage: "Create three calendar events: Team standup on March 16 2026 9am-9:15am, Lunch with Sarah on March 16 2026 12pm-1pm, and Gym on March 16 2026 5pm-6pm. Create all three now please.",
    calendarConnected: true,
    assertions: [
      { type: "tool_called", name: "create_event", minCount: 3 },
      {
        type: "custom",
        name: "all 3 events appear in calendar",
        fn: (ctx) => ctx.calendarEvents.length >= 3,
      },
    ],
  },

  {
    name: "calendar-not-connected",
    description: "Returns auth link when calendar is not connected",
    userMessage: "What's on my calendar this week?",
    calendarConnected: false,
    assertions: [
      { type: "tool_called", name: "list_events" },
      { type: "response_contains", text: "oauth" },
      { type: "no_markdown" },
    ],
  },

  {
    name: "memory-read-write",
    description: "Uses tools to write and read memory",
    userMessage: "Remember that my daughter's school is Elmwood. Then read back what you just saved to confirm.",
    calendarConnected: true,
    assertions: [
      { type: "tool_called", name: "write_memory" },
      { type: "tool_called", name: "read_memory" },
    ],
  },

  {
    name: "plain-text-only",
    description: "Response has no markdown formatting",
    userMessage: "Give me a summary of what you can help me with.",
    calendarConnected: true,
    assertions: [
      { type: "no_markdown" },
    ],
  },
];
